import type Database from 'better-sqlite3';
import { isSecretText } from '@aether/shared';

/** After this many failures in a row a procedure is stale and no longer advertised. */
export const STALE_AFTER_FAILURES = 2;
const RECALL_CHAR_BUDGET = 1050;
const MAX_STEPS = 30;

export interface Fact {
  key: string;
  value: string;
  source: 'user' | 'agent';
  updatedAt: number;
}

export interface Note {
  id: number;
  site: string;
  text: string;
  createdAt: number;
}

export interface Procedure {
  id: number;
  site: string;
  goal: string;
  steps: string[];
  successes: number;
  failures: number;
  stale: boolean;
}

export interface Recall {
  /** Facts the person entered themselves; safe to show outside the untrusted wrapper. */
  trusted: string[];
  /** Agent-saved facts, notes and procedures, which may echo page text; shown inside the wrapper. */
  untrusted: string[];
}

export class MemoryRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MemoryRefusedError';
  }
}

/** Sites are stored by host, so www and paths do not split one site's memory. */
export function siteOf(urlOrHost: string): string {
  const text = urlOrHost.trim().toLowerCase();
  if (text.includes('://')) {
    try {
      return new URL(text).host.replace(/^www\./, '');
    } catch {
      // Treat it as a host below.
    }
  }
  return text.split('/')[0]?.replace(/^www\./, '') ?? '';
}

function refuseSecrets(...texts: string[]): void {
  for (const text of texts) {
    if (isSecretText(text)) throw new MemoryRefusedError('not stored: it looks like a password, code or card number, which Aether never keeps');
  }
}

/**
 * Local memory: profile facts, site notes and site procedures in SQLite.
 * Nothing here leaves the machine except what a tool result returns.
 */
export class MemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public get enabled(): boolean {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('memory_enabled') as { value: string } | undefined;
    return row?.value !== 'false';
  }

  public setEnabled(enabled: boolean): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run('memory_enabled', String(enabled));
  }

  public saveFact(key: string, value: string, source: Fact['source']): void {
    if (!this.enabled) throw new MemoryRefusedError('memory is off');
    refuseSecrets(key, value);
    this.db
      .prepare('INSERT INTO facts (key, value, source, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at')
      .run(key.trim().toLowerCase(), value.trim(), source, Date.now());
  }

  public saveNote(site: string, text: string): void {
    if (!this.enabled) throw new MemoryRefusedError('memory is off');
    refuseSecrets(text);
    this.db.prepare('INSERT INTO notes (site, text, created_at) VALUES (?, ?, ?)').run(siteOf(site), text.trim(), Date.now());
  }

  /** Record a route that worked. Steps are engine-written action lines, never page text. */
  public recordSuccess(site: string, goal: string, steps: string[]): void {
    if (!this.enabled || steps.length === 0) return;
    const kept = steps.slice(0, MAX_STEPS).filter((step) => !isSecretText(step));
    this.db
      .prepare(
        `INSERT INTO procedures (site, goal, steps, successes, failures, consecutive_failures, updated_at) VALUES (?, ?, ?, 1, 0, 0, ?)
         ON CONFLICT (site, goal) DO UPDATE SET steps = excluded.steps, successes = successes + 1, consecutive_failures = 0, updated_at = excluded.updated_at`,
      )
      .run(siteOf(site), goal.trim().slice(0, 120), JSON.stringify(kept), Date.now());
  }

  public recordFailure(site: string, goal: string): void {
    if (!this.enabled) return;
    this.db
      .prepare('UPDATE procedures SET failures = failures + 1, consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE site = ? AND goal = ?')
      .run(Date.now(), siteOf(site), goal.trim().slice(0, 120));
  }

  public facts(): Fact[] {
    return (this.db.prepare('SELECT key, value, source, updated_at FROM facts ORDER BY key').all() as Array<{ key: string; value: string; source: Fact['source']; updated_at: number }>).map(
      (row) => ({ key: row.key, value: row.value, source: row.source, updatedAt: row.updated_at }),
    );
  }

  public notes(site?: string): Note[] {
    const rows = (site
      ? this.db.prepare('SELECT id, site, text, created_at FROM notes WHERE site = ? ORDER BY created_at DESC').all(siteOf(site))
      : this.db.prepare('SELECT id, site, text, created_at FROM notes ORDER BY site, created_at DESC').all()) as Array<{ id: number; site: string; text: string; created_at: number }>;
    return rows.map((row) => ({ id: row.id, site: row.site, text: row.text, createdAt: row.created_at }));
  }

  public procedures(site?: string): Procedure[] {
    const rows = (site
      ? this.db.prepare('SELECT * FROM procedures WHERE site = ? ORDER BY successes DESC').all(siteOf(site))
      : this.db.prepare('SELECT * FROM procedures ORDER BY site, successes DESC').all()) as Array<{
      id: number;
      site: string;
      goal: string;
      steps: string;
      successes: number;
      failures: number;
      consecutive_failures: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      site: row.site,
      goal: row.goal,
      steps: JSON.parse(row.steps) as string[],
      successes: row.successes,
      failures: row.failures,
      stale: row.consecutive_failures >= STALE_AFTER_FAILURES,
    }));
  }

  public delete(kind: 'fact' | 'note' | 'procedure', id: string | number): void {
    if (kind === 'fact') this.db.prepare('DELETE FROM facts WHERE key = ?').run(String(id));
    else if (kind === 'note') this.db.prepare('DELETE FROM notes WHERE id = ?').run(Number(id));
    else this.db.prepare('DELETE FROM procedures WHERE id = ?').run(Number(id));
  }

  /** One line for the open result when the site has memory, or undefined. */
  public advert(siteOrUrl: string): string | undefined {
    if (!this.enabled) return undefined;
    const site = siteOf(siteOrUrl);
    const procedures = this.procedures(site).filter((procedure) => !procedure.stale).length;
    const notes = this.notes(site).length;
    if (procedures + notes === 0) return undefined;
    const parts = [procedures ? `${procedures} known route${procedures === 1 ? '' : 's'}` : '', notes ? `${notes} note${notes === 1 ? '' : 's'}` : ''].filter(Boolean);
    return `memory: ${parts.join(' and ')} for ${site}; call memory op=recall site=${site}`;
  }

  /** Matching memory, kept to roughly 300 tokens. */
  public recall(query: { site?: string; key?: string }): Recall {
    if (!this.enabled) return { trusted: [], untrusted: [] };
    const trusted: string[] = [];
    const untrusted: string[] = [];
    const key = query.key?.trim().toLowerCase();
    for (const fact of this.facts()) {
      if (key && !fact.key.includes(key)) continue;
      (fact.source === 'user' ? trusted : untrusted).push(`${fact.source === 'user' ? 'preference' : 'saved'}: ${fact.key} = ${fact.value}`);
    }
    if (query.site) {
      for (const procedure of this.procedures(query.site)) {
        if (procedure.stale) continue;
        untrusted.push(`route for "${procedure.goal}" (worked ${procedure.successes}x):`, ...procedure.steps.map((step, index) => `  ${index + 1}. ${step}`));
      }
      for (const note of this.notes(query.site)) untrusted.push(`note: ${note.text}`);
    }
    const fit = (lines: string[], budget: number): string[] => {
      const out: string[] = [];
      let used = 0;
      for (const line of lines) {
        if (used + line.length > budget) {
          out.push(`... ${lines.length - out.length} more lines`);
          break;
        }
        out.push(line);
        used += line.length + 1;
      }
      return out;
    };
    const trustedFit = fit(trusted, RECALL_CHAR_BUDGET / 3);
    return { trusted: trustedFit, untrusted: fit(untrusted, RECALL_CHAR_BUDGET - trustedFit.join('\n').length) };
  }
}
