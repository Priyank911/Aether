import { execFileSync } from 'node:child_process';
import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Vite 5 predates the prefix-only builtin; use the same loading pattern as memory/database.ts.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export function dpapi(mode: 'protect' | 'unprotect', bytes: Buffer): Buffer {
  if (process.platform !== 'win32') throw new Error('Windows DPAPI unavailable');
  // Keys travel over stdin/stdout, never command-line arguments or diagnostics.
  const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./dpapi.ps1', import.meta.url)), '-Mode', mode], {
    input: bytes.toString('base64'), encoding: 'utf8', timeout: 15000,
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  return Buffer.from(result.trim(), 'base64');
}

function readJson(file: string): unknown {
  if (statSync(file).size > 32 * 1024 * 1024) throw new Error('Profile JSON exceeds spike size limit');
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

function countBookmarks(value: unknown): number {
  const roots = z.object({ roots: z.record(z.string(), z.unknown()) }).parse(value).roots;
  const node = z.object({ type: z.string().optional(), url: z.string().optional(), children: z.array(z.unknown()).optional() });
  const queue = Object.values(roots).map(value => ({ value, depth: 0 }));
  let count = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (!current || index > 1000000 || current.depth > 64) throw new Error('Bookmark tree exceeds spike limits');
    const parsed = node.parse(current.value);
    if (parsed.type === 'url' && parsed.url) count++;
    for (const child of parsed.children ?? []) queue.push({ value: child, depth: current.depth + 1 });
  }
  return count;
}

function withDatabase<T>(file: string, body: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA quick_check').get();
    if (!integrity || Object.values(integrity)[0] !== 'ok') throw new Error('Profile copy failed integrity check');
    return body(db);
  } finally { db.close(); }
}

function copyClosedDatabase(source: string, destination: string): void {
  // Copying only the main DB while Chrome has an active WAL silently loses rows.
  for (const suffix of ['-wal', '-journal']) {
    if (existsSync(source + suffix) && statSync(source + suffix).size > 0) throw new Error('Close Chrome before probing a profile with an active journal');
  }
  const before = statSync(source);
  copyFileSync(source, destination);
  const after = statSync(source);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Profile changed during copy; close Chrome and retry');
  for (const suffix of ['-wal', '-journal']) {
    if (existsSync(source + suffix) && statSync(source + suffix).size > 0) throw new Error('Profile journal appeared during copy');
  }
}

export interface ProfileReport {
  bookmarks: number;
  historyUrls: number;
  cookies: { total: number; plaintext: number; v10Decrypted: number; v10Failed: number; v20Skipped: number; legacyDpapiDecrypted: number; unsupported: number };
  keyProbe: 'not-needed' | 'dpapi-unwrapped' | 'unavailable' | 'fixture-key';
  temporaryCopiesRemoved: boolean;
}

/** Read-only feasibility probe. No values, URLs, titles or credentials leave this function. */
export function inspectProfile(profile: string, options: { fixtureKey?: Buffer; tempRoot?: string } = {}): ProfileReport {
  const report: ProfileReport = {
    bookmarks: 0, historyUrls: 0,
    cookies: { total: 0, plaintext: 0, v10Decrypted: 0, v10Failed: 0, v20Skipped: 0, legacyDpapiDecrypted: 0, unsupported: 0 },
    keyProbe: 'not-needed', temporaryCopiesRemoved: false,
  };
  const temporary = mkdtempSync(path.join(options.tempRoot ?? os.tmpdir(), 'aether-s6-copy-'));
  let key: Buffer | undefined;
  try {
    report.bookmarks = countBookmarks(readJson(path.join(profile, 'Bookmarks')));
    const history = path.join(temporary, 'History');
    copyClosedDatabase(path.join(profile, 'History'), history);
    report.historyUrls = withDatabase(history, db => z.object({ count: z.number() }).parse(db.prepare('SELECT count(*) AS count FROM urls').get()).count);
    const source = existsSync(path.join(profile, 'Network', 'Cookies')) ? path.join(profile, 'Network', 'Cookies') : path.join(profile, 'Cookies');
    const cookies = path.join(temporary, 'Cookies');
    copyClosedDatabase(source, cookies);
    let attemptedKey = false;
    withDatabase(cookies, db => {
      const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value);
      if (!Number.isInteger(version) || version < 1) throw new Error('Unknown cookie database version');
      const rows = db.prepare('SELECT host_key, encrypted_value, length(value) AS plaintext_length FROM cookies');
      for (const row of rows.iterate()) {
        report.cookies.total++;
        const blob = row.encrypted_value;
        if (!(blob instanceof Uint8Array) || typeof row.host_key !== 'string' || typeof row.plaintext_length !== 'number') throw new Error('Unsupported cookie row');
        const bytes = Buffer.from(blob);
        const prefix = bytes.subarray(0, 3).toString('ascii');
        if (prefix === 'v20') { report.cookies.v20Skipped++; continue; }
        if (!bytes.length && row.plaintext_length > 0) { report.cookies.plaintext++; continue; }
        if (prefix !== 'v10') {
          if (bytes.length && process.platform === 'win32') {
            try { const plain = dpapi('unprotect', bytes); plain.fill(0); report.cookies.legacyDpapiDecrypted++; }
            catch { report.cookies.unsupported++; }
          } else report.cookies.unsupported++;
          continue;
        }
        if (!attemptedKey) {
          attemptedKey = true;
          try {
            if (options.fixtureKey) { key = Buffer.from(options.fixtureKey); report.keyProbe = 'fixture-key'; }
            else {
              const state = z.object({ os_crypt: z.object({ encrypted_key: z.string() }) }).parse(readJson(path.join(profile, '..', 'Local State')));
              const wrapped = Buffer.from(state.os_crypt.encrypted_key, 'base64');
              if (wrapped.subarray(0, 5).toString('ascii') !== 'DPAPI') throw new Error('Unsupported key format');
              key = dpapi('unprotect', wrapped.subarray(5));
              report.keyProbe = 'dpapi-unwrapped';
            }
            if (key.length !== 32) throw new Error('Unexpected AES key length');
          } catch { key?.fill(0); key = undefined; report.keyProbe = 'unavailable'; }
        }
        if (!key || bytes.length < 31) { report.cookies.v10Failed++; continue; }
        let plain: Buffer | undefined;
        try {
          const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(3, 15));
          cipher.setAuthTag(bytes.subarray(-16));
          plain = Buffer.concat([cipher.update(bytes.subarray(15, -16)), cipher.final()]);
          if (version >= 24) {
            const hostHash = createHash('sha256').update(row.host_key).digest();
            if (plain.length < 32 || !timingSafeEqual(plain.subarray(0, 32), hostHash)) throw new Error('Host binding mismatch');
          }
          report.cookies.v10Decrypted++;
        } catch { report.cookies.v10Failed++; }
        finally { plain?.fill(0); }
      }
    });
  } finally {
    key?.fill(0);
    rmSync(temporary, { recursive: true, force: true });
    report.temporaryCopiesRemoved = !existsSync(temporary);
  }
  return report;
}
