import type { Space, SpaceKind, SpacePartition, TabRecord } from '@aether/shared';
import { inTransaction, type DatabaseHandle } from './database.js';

/*
 * Spaces and tabs across restarts (plan 3.1, section 11.2): metadata only,
 * about 300 bytes a tab. Page content, heaps and images are never stored.
 * Every tab restores asleep, except the active tab of the Human Space.
 */

export interface StoredSpace {
  id: string;
  name: string;
  kind: SpaceKind;
  partition: SpacePartition;
  createdAt: number;
  archived: boolean;
  activeTab?: string;
}

export type StoredTab = Omit<TabRecord, 'state'> & { position: number };

const MAX_URL = 4096;
const MAX_TITLE = 300;
/** A favicon is stored only as a short URL; data: icons can be large and are dropped. */
const MAX_FAVICON = 512;

export class SpaceStore {
  private readonly db: DatabaseHandle;

  public constructor(db: DatabaseHandle) {
    this.db = db;
  }

  public spaces(): StoredSpace[] {
    const rows = this.db.prepare('SELECT id, name, kind, partition, created_at, archived, active_tab FROM spaces ORDER BY created_at').all() as Array<{
      id: string;
      name: string;
      kind: SpaceKind;
      partition: SpacePartition;
      created_at: number;
      archived: number;
      active_tab: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      partition: row.partition,
      createdAt: row.created_at,
      archived: row.archived === 1,
      ...(row.active_tab ? { activeTab: row.active_tab } : {}),
    }));
  }

  public saveSpace(space: Pick<Space, 'id' | 'name' | 'kind' | 'partition' | 'createdAt' | 'archived'>): void {
    this.db
      .prepare(
        'INSERT INTO spaces (id, name, kind, partition, created_at, archived) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, archived = excluded.archived',
      )
      .run(space.id, space.name.slice(0, 60), space.kind, space.partition, space.createdAt, space.archived ? 1 : 0);
  }

  /** Remove a Space with its tabs and state. */
  public deleteSpace(id: string): void {
    this.db.prepare('DELETE FROM spaces WHERE id = ?').run(id);
  }

  public tabs(spaceId: string): StoredTab[] {
    const rows = this.db
      .prepare('SELECT id, space_id, position, url, title, favicon, scroll_y, last_viewed_at FROM tabs WHERE space_id = ? ORDER BY position')
      .all(spaceId) as Array<{ id: string; space_id: string; position: number; url: string; title: string; favicon: string | null; scroll_y: number; last_viewed_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      spaceId: row.space_id,
      position: row.position,
      url: row.url,
      title: row.title,
      ...(row.favicon ? { favicon: row.favicon } : {}),
      scrollY: row.scroll_y,
      lastViewedAt: row.last_viewed_at,
    }));
  }

  /** Replace a Space's tab list in one transaction, in order, and record the active tab. */
  public saveTabs(spaceId: string, tabs: ReadonlyArray<Omit<StoredTab, 'position' | 'spaceId'>>, activeTab?: string): void {
    inTransaction(this.db, () => {
      this.db.prepare('DELETE FROM tabs WHERE space_id = ?').run(spaceId);
      const insert = this.db.prepare('INSERT INTO tabs (id, space_id, position, url, title, favicon, scroll_y, last_viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      tabs.forEach((tab, position) => {
        const favicon = tab.favicon && tab.favicon.length <= MAX_FAVICON && !tab.favicon.startsWith('data:') ? tab.favicon : null;
        insert.run(tab.id, spaceId, position, tab.url.slice(0, MAX_URL), tab.title.slice(0, MAX_TITLE), favicon, Math.max(0, tab.scrollY), tab.lastViewedAt);
      });
      this.db.prepare('UPDATE spaces SET active_tab = ? WHERE id = ?').run(activeTab ?? null, spaceId);
    });
  }

  /** Bytes the tab rows of a Space take, for the "metadata only" check. */
  public tabBytes(spaceId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(id) + LENGTH(url) + LENGTH(title) + COALESCE(LENGTH(favicon), 0) + 40), 0) AS bytes FROM tabs WHERE space_id = ?')
      .get(spaceId) as { bytes: number };
    return row.bytes;
  }
}
