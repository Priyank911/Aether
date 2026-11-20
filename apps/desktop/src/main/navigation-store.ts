import type { DatabaseHandle } from '@aether/memory';
import { NavigationEntrySchema, NavigationSeedSchema, type NavigationEntry, type NavigationSeed } from '@aether/shared';

export type NavigationMatch = Pick<NavigationSeed, 'kind' | 'url' | 'title'>;

/** Aether's own local metadata, isolated by Space even when tabs share a cookie partition. */
export class NavigationStore {
  public constructor(private readonly db: DatabaseHandle) {
    for (const table of ['navigation_history', 'navigation_bookmarks']) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
        space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        visited_at INTEGER NOT NULL,
        visits INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (space_id, url)
      )`);
    }
    db.exec('CREATE TABLE IF NOT EXISTS navigation_zoom (space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, origin TEXT NOT NULL, level REAL NOT NULL, PRIMARY KEY(space_id, origin))');
  }

  public list(spaceId: string, kind: 'history' | 'bookmark'): NavigationEntry[] {
    const table = kind === 'history' ? 'navigation_history' : 'navigation_bookmarks';
    return this.db.prepare(`SELECT url, title, visited_at AS at FROM ${table} WHERE space_id = ? ORDER BY visited_at DESC LIMIT 500`).all(spaceId).map((row) => NavigationEntrySchema.parse({ ...row, spaceId }));
  }

  public toggleBookmark(entry: NavigationEntry): boolean {
    const removed = this.db.prepare('DELETE FROM navigation_bookmarks WHERE space_id = ? AND url = ?').run(entry.spaceId, entry.url);
    if (Number(removed.changes) > 0) return false;
    this.bookmark(entry);
    return true;
  }

  public get bookmarksVisible(): boolean {
    return (this.db.prepare('SELECT value FROM settings WHERE key = ?').get('bookmarks_bar') as {value: string} | undefined)?.value === 'true';
  }

  public set bookmarksVisible(visible: boolean) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('bookmarks_bar', String(visible));
  }

  public zoom(spaceId: string, origin: string): number {
    return (this.db.prepare('SELECT level FROM navigation_zoom WHERE space_id = ? AND origin = ?').get(spaceId, origin) as {level: number} | undefined)?.level ?? 0;
  }

  public saveZoom(spaceId: string, origin: string, level: number): void {
    this.db.prepare('INSERT INTO navigation_zoom (space_id, origin, level) VALUES (?, ?, ?) ON CONFLICT(space_id, origin) DO UPDATE SET level = excluded.level').run(spaceId, origin, level);
  }

  public record(entry: NavigationEntry): void {
    this.save('history', entry);
  }

  /** Local bookmark storage; never a model-facing capability. */
  public bookmark(entry: NavigationEntry): void {
    this.save('bookmark', entry);
  }

  /** Merge imports without duplicating visits or replacing a person's newer entries. */
  public importEntries(kind: 'history' | 'bookmark', entries: ReadonlyArray<{ url: string; title: string; at: number; visits: number }>): number {
    const table = kind === 'history' ? 'navigation_history' : 'navigation_bookmarks';
    const statement = this.db.prepare(`INSERT INTO ${table} (space_id, url, title, visited_at, visits) VALUES ('personal', ?, ?, ?, ?)
      ON CONFLICT(space_id, url) ${kind === 'bookmark' ? 'DO NOTHING' : `DO UPDATE SET title = excluded.title, visited_at = excluded.visited_at, visits = MAX(${table}.visits, excluded.visits) WHERE excluded.visited_at > ${table}.visited_at`}`);
    let imported = 0;
    this.db.exec('BEGIN');
    try {
      for (const raw of entries) {
        const entry = NavigationEntrySchema.parse({ ...raw, spaceId: 'personal' });
        imported += Number(statement.run(entry.url, entry.title, entry.at ?? 0, raw.visits).changes);
      }
      this.db.exec('COMMIT');
      return imported;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  public get importOffer(): boolean {
    return !this.db.prepare('SELECT value FROM settings WHERE key = ?').get('import_offer_seen');
  }

  public dismissImportOffer(): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('import_offer_seen', 'true');
  }

  public updateTitle(spaceId: string, url: string, title: string): void {
    this.db.prepare('UPDATE navigation_history SET title = ? WHERE space_id = ? AND url = ?').run(title.slice(0, 512), spaceId, url);
  }

  public suggestions(spaceId: string, query: string): NavigationMatch[] {
    const needle = query.trim().toLowerCase();
    const rows = this.db.prepare(`
      SELECT kind, url, title FROM (
        SELECT 'bookmark' AS kind, url, title, visited_at, visits, 0 AS priority
        FROM navigation_bookmarks WHERE space_id = ?
        UNION ALL
        SELECT 'history' AS kind, url, title, visited_at, visits, 1 AS priority
        FROM navigation_history h WHERE space_id = ? AND NOT EXISTS (
          SELECT 1 FROM navigation_bookmarks b WHERE b.space_id = h.space_id AND b.url = h.url
        )
      ) WHERE instr(lower(url), ?) > 0 OR instr(lower(title), ?) > 0
      ORDER BY priority, visits DESC, visited_at DESC, url LIMIT 8
    `).all(spaceId, spaceId, needle, needle);
    return rows.map((row) => {
      const parsed = NavigationSeedSchema.parse({ ...row, spaceId });
      return { kind: parsed.kind, url: parsed.url, title: parsed.title };
    });
  }

  private save(kind: NavigationSeed['kind'], raw: NavigationEntry): void {
    const entry = NavigationEntrySchema.parse(raw);
    const table = kind === 'history' ? 'navigation_history' : 'navigation_bookmarks';
    this.db.prepare(`INSERT INTO ${table} (space_id, url, title, visited_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(space_id, url) DO UPDATE SET
        title = CASE WHEN excluded.title = '' THEN ${table}.title ELSE excluded.title END,
        visited_at = excluded.visited_at, visits = ${table}.visits + 1
    `).run(entry.spaceId, entry.url, entry.title, entry.at ?? Date.now());
  }
}
