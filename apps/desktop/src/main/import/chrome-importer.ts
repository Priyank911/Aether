import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { CookiesSetDetails } from 'electron';
import { z } from 'zod';
import { ImportReportSchema, ImportSelectionSchema, type ImportKind, type ImportReason, type ImportReport, type ImportSelection } from '@aether/shared';
import type { NavigationStore } from '../navigation-store.js';
import { CookieCrypto } from './cookie-crypto.js';
import { readable } from './profiles.js';
import { bookmarkRows, ImportCleanupError, ImportSourceError, navigationRow, withProfileDatabase } from './source.js';

const cookieRow = z.object({ host_key: z.string().min(1).max(256), name: z.string().max(4096), path: z.string().startsWith('/').max(4096), value: z.string(), encrypted_value: z.instanceof(Uint8Array), expires_utc: z.union([z.number(), z.bigint()]), is_secure: z.union([z.number(), z.bigint()]), is_httponly: z.union([z.number(), z.bigint()]), samesite: z.union([z.number(), z.bigint()]), top_frame_site_key: z.string().optional() });
export interface ImportTarget {
  navigation: Pick<NavigationStore, 'importEntries'>;
  /** Return false rather than overwrite a cookie already present in the person's session. */
  cookie(details: CookiesSetDetails): Promise<boolean>;
  flush(): Promise<void>;
}

/** Explicit person-selected import. Neither the service nor Code Mode receives this capability. */
export async function importChromeProfile(profile: string, raw: ImportSelection, target: ImportTarget, options: { crypto?: CookieCrypto; tempRoot?: string } = {}): Promise<ImportReport> {
  const selection = ImportSelectionSchema.parse(raw);
  const report: ImportReport = { bookmarks: { imported: 0, skipped: 0 }, history: { imported: 0, skipped: 0 }, cookies: { imported: 0, skipped: 0 }, issues: [], temporaryCopiesRemoved: true };
  const note = (kind: ImportKind, reason: ImportReason, count = 1) => {
    if (!count) return;
    const existing = report.issues.find(issue => issue.kind === kind && issue.reason === reason);
    if (existing) existing.count += count; else report.issues.push({ kind, reason, count });
  };
  const skip = (kind: ImportKind, reason: ImportReason, count = 1) => { report[kind].skipped += count; note(kind, reason, count); };
  const guarded = async (kind: ImportKind, body: () => Promise<void>) => {
    try { await body(); }
    catch (error) {
      if (error instanceof ImportCleanupError) report.temporaryCopiesRemoved = false;
      note(kind, error instanceof ImportSourceError ? error.reason : 'read-failed');
    }
  };
  if (selection.bookmarks) await guarded('bookmarks', async () => {
    const result = await bookmarkRows(path.join(profile, 'Bookmarks'));
    skip('bookmarks', 'invalid-data', result.invalid);
    try {
      report.bookmarks.imported = target.navigation.importEntries('bookmark', result.rows);
      skip('bookmarks', 'already-present', result.rows.length - report.bookmarks.imported);
    } catch { note('bookmarks', 'write-failed'); }
  });
  if (selection.history) await guarded('history', async () => {
    await withProfileDatabase(path.join(profile, 'History'), async db => {
      let batch: NonNullable<ReturnType<typeof navigationRow>>[] = [];
      const flush = () => {
        let imported: number;
        try { imported = target.navigation.importEntries('history', batch); }
        catch { throw new ImportSourceError('write-failed'); }
        report.history.imported += imported;
        skip('history', 'already-present', batch.length - imported);
        batch = [];
      };
      const rows = db.prepare('SELECT url, title, last_visit_time, visit_count FROM urls');
      rows.setReadBigInts(true);
      for (const row of rows.iterate()) {
        const entry = navigationRow(row.url, row.title, row.last_visit_time, Number(row.visit_count));
        if (entry) batch.push(entry); else skip('history', 'invalid-data');
        if (batch.length >= 500) { flush(); await setImmediate(); }
      }
      flush();
    }, options.tempRoot);
  });
  const crypto = options.crypto ?? new CookieCrypto(profile);
  try {
    if (selection.cookies) await guarded('cookies', async () => {
      const modern = path.join(profile, 'Network', 'Cookies');
      await withProfileDatabase(await readable(modern) ? modern : path.join(profile, 'Cookies'), async db => {
        const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value);
        if (!Number.isInteger(version) || version < 1) throw new ImportSourceError('invalid-data');
        const rows = db.prepare('SELECT * FROM cookies');
        rows.setReadBigInts(true);
        for (const rawRow of rows.iterate()) {
          const row = cookieRow.safeParse(rawRow);
          if (!row.success) { skip('cookies', 'invalid-data'); continue; }
          const value = row.data;
          if (value.top_frame_site_key) { skip('cookies', 'partitioned-cookie'); continue; }
          const bytes = Buffer.from(value.encrypted_value);
          if (bytes.subarray(0, 3).toString('ascii') === 'v20') { skip('cookies', 'app-bound'); continue; }
          let decrypted: Buffer | undefined;
          try {
            let text = value.value;
            if (bytes.length) {
              decrypted = await crypto.decrypt(bytes, value.host_key, version);
              if (!decrypted) { skip('cookies', 'encryption-unavailable'); continue; }
              text = new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
            }
            const secure = Boolean(Number(value.is_secure));
            const host = value.host_key.replace(/^\./, '');
            const url = new URL(`${secure ? 'https' : 'http'}://${host}${value.path}`);
            if (url.hostname !== host || url.username || url.password || /[\s/@#?:]/.test(host)) { skip('cookies', 'invalid-data'); continue; }
            const expires = Number(value.expires_utc) / 1000000 - 11644473600;
            if (Number(value.expires_utc) && expires <= Date.now() / 1000) { skip('cookies', 'expired'); continue; }
            const sameSite = Number(value.samesite);
            const details: CookiesSetDetails = { url: url.href, name: value.name, value: text, path: value.path, secure, httpOnly: Boolean(Number(value.is_httponly)), ...(value.host_key.startsWith('.') ? { domain: value.host_key } : {}), ...(Number(value.expires_utc) ? { expirationDate: expires } : {}), sameSite: sameSite === 0 ? 'no_restriction' : sameSite === 1 ? 'lax' : sameSite === 2 ? 'strict' : 'unspecified' };
            try {
              if (await target.cookie(details)) report.cookies.imported++; else skip('cookies', 'already-present');
            } catch { skip('cookies', 'write-failed'); }
          } catch { skip('cookies', 'invalid-data'); }
          finally { decrypted?.fill(0); }
        }
      }, options.tempRoot);
      try { await target.flush(); } catch { note('cookies', 'write-failed'); }
    });
  } finally { crypto.close(); }
  return ImportReportSchema.parse(report);
}
