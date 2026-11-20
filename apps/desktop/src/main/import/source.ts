import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { NavigationEntrySchema, type ImportReason } from '@aether/shared';
import { z } from 'zod';
import { readable } from './profiles.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
export class ImportSourceError extends Error {
  public constructor(public readonly reason: ImportReason) { super(reason); }
}
export class ImportCleanupError extends Error {}
async function removeCopies(directory: string): Promise<void> {
  try { await rm(directory, { force: true, recursive: true }); }
  catch { throw new ImportCleanupError('Temporary profile copies could not be removed'); }
}
export async function readProfileJson(file: string): Promise<unknown> {
  if (!(await readable(file))) throw new ImportSourceError('missing-file');
  if ((await stat(file)).size > 32 * 1024 * 1024) throw new ImportSourceError('invalid-data');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

/** Only the two approved SQLite files are copied. All handles close before finally cleanup. */
export async function withProfileDatabase<T>(source: string, body: (db: InstanceType<typeof DatabaseSync>) => Promise<T>, tempRoot = tmpdir()): Promise<T> {
  if (!(await readable(source))) throw new ImportSourceError('missing-file');
  const temporary = await mkdtemp(path.join(tempRoot, 'aether-import-'));
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const hasJournal = async () => {
      for (const suffix of ['-wal', '-journal']) {
        try { if ((await stat(source + suffix)).size > 0) return true; }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      }
      return false;
    };
    if (await hasJournal()) throw new ImportSourceError('source-busy');
    const before = await stat(source);
    const file = path.join(temporary, path.basename(source));
    await copyFile(source, file);
    const after = await stat(source);
    if (await hasJournal() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new ImportSourceError('source-busy');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0] !== 'ok') throw new ImportSourceError('invalid-data');
      outcome = { ok: true, value: await body(db) };
    } finally { db.close(); }
  } catch (error) { outcome = { ok: false, error }; }
  finally { await removeCopies(temporary); }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export function chromeTime(value: unknown): number | undefined {
  const time = Number(value) / 1000 - 11644473600000;
  return Number.isFinite(time) && time >= 0 && time <= Date.now() + 86400000 ? Math.trunc(time) : undefined;
}

export interface ImportNavigation { url: string; title: string; at: number; visits: number }
export function navigationRow(url: unknown, title: unknown, at: unknown, visits = 1): ImportNavigation | undefined {
  const parsed = NavigationEntrySchema.safeParse({ spaceId: 'personal', url, title: typeof title === 'string' ? title.slice(0, 512) : '', at: chromeTime(at) ?? 0 });
  if (!parsed.success) return undefined;
  return { url: parsed.data.url, title: parsed.data.title, at: parsed.data.at ?? 0, visits: Number.isFinite(visits) ? Math.max(1, Math.min(2147483647, Math.trunc(visits))) : 1 };
}

export async function bookmarkRows(file: string): Promise<{ rows: ImportNavigation[]; invalid: number }> {
  const roots = z.object({ roots: z.record(z.string(), z.unknown()) }).parse(await readProfileJson(file)).roots;
  const node = z.object({ type: z.string().optional(), url: z.unknown().optional(), name: z.unknown().optional(), date_added: z.unknown().optional(), children: z.array(z.unknown()).optional() });
  const queue = Object.values(roots).map(value => ({ value, depth: 0 }));
  const rows: ImportNavigation[] = [];
  let invalid = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (!current || index > 1000000 || current.depth > 64) throw new ImportSourceError('invalid-data');
    const parsed = node.safeParse(current.value);
    if (!parsed.success) { invalid++; continue; }
    if (parsed.data.type === 'url') {
      const entry = navigationRow(parsed.data.url, parsed.data.name, parsed.data.date_added);
      if (entry) rows.push(entry); else invalid++;
    }
    for (const value of parsed.data.children ?? []) queue.push({ value, depth: current.depth + 1 });
    if (index % 500 === 0) await setImmediate();
  }
  return { rows, invalid };
}
