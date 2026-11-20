import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SpaceStore, type DatabaseHandle } from '@aether/memory';
import { NavigationStore } from '../apps/desktop/src/main/navigation-store.js';
import { importChromeProfile, type ImportTarget } from '../apps/desktop/src/main/import/chrome-importer.js';
import { chromeRoots, discoverChromeProfiles } from '../apps/desktop/src/main/import/profiles.js';
import { CookieCrypto } from '../apps/desktop/src/main/import/cookie-crypto.js';
import { chromeIdentity } from '../apps/desktop/src/main/import/browser-identity.js';
import { dpapi } from '../scripts/spikes/s6/profile.mjs';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const roots: string[] = [];
const databases: DatabaseHandle[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'aether-import-test-')); roots.push(root);
  const profile = path.join(root, 'Default'); mkdirSync(path.join(profile, 'Network'), { recursive: true });
  const temporary = path.join(root, 'working'); mkdirSync(temporary);
  writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Local profile' } } }, os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped-fixture-key')]).toString('base64') } }));
  writeFileSync(path.join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: '<bookmark>', url: 'https://example.invalid/bookmark' }, { type: 'url', url: 'javascript:alert(1)' }] } } }));
  const history = new DatabaseSync(path.join(profile, 'History'));
  history.exec("CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER,visit_count INTEGER); INSERT INTO urls VALUES ('https://example.invalid/history','History',13300000000000000,7),('file:///private','Skip',0,1)"); history.close();
  const key = randomBytes(32);
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.alloc(12, 1));
  const payload = Buffer.concat([createHash('sha256').update('.example.invalid').digest(), Buffer.from('fixture-session')]);
  const encrypted = Buffer.concat([Buffer.from('v10'), Buffer.alloc(12, 1), cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
  const cookies = new DatabaseSync(path.join(profile, 'Network', 'Cookies'));
  cookies.exec("CREATE TABLE meta(key TEXT,value TEXT); INSERT INTO meta VALUES('version','24'); CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,value TEXT,encrypted_value BLOB,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER,top_frame_site_key TEXT)");
  const insert = cookies.prepare("INSERT INTO cookies VALUES('.example.invalid',?,'/',?,?,0,1,1,1,?)");
  insert.run('session','',encrypted,''); insert.run('bound','',Buffer.from('v20-sentinel'),''); insert.run('partitioned','value',Buffer.alloc(0),'https://elsewhere.invalid');
  cookies.close();
  const db = openDatabase(':memory:'); databases.push(db);
  new SpaceStore(db).saveSpace({ id: 'personal', name: 'Personal', kind: 'human', partition: 'persist', createdAt: 1, archived: false });
  const navigation = new NavigationStore(db);
  const accepted: Parameters<ImportTarget['cookie']>[0][] = [];
  const target: ImportTarget = { navigation, cookie: async value => { if (accepted.some(item => item.name === value.name)) return false; accepted.push(value); return true; }, flush: async () => {} };
  return { root, profile, temporary, key, navigation, accepted, target };
}

describe('device-independent Chrome import', () => {
  it('discovers OS profile roots and labels without embedding a username', async () => {
    const f = fixture();
    const result = await discoverChromeProfiles([f.root]);
    expect(result).toHaveLength(1); expect(result[0]?.public.name).toBe('Local profile');
    expect(result[0]?.directory).toBe(f.profile);
    expect(chromeRoots('win32', '/person', { LOCALAPPDATA: '/device/local' })[0]).toContain(path.join('device', 'local', 'Google', 'Chrome', 'User Data'));
    expect(chromeRoots('linux', '/person', { XDG_CONFIG_HOME: '/configured' })[0]).toBe(path.join('/configured', 'google-chrome'));
    expect(chromeRoots('darwin', '/person', {})[0]).toBe(path.join('/person', 'Library', 'Application Support', 'Google', 'Chrome'));
    expect(await discoverChromeProfiles([path.join(f.root, 'not-installed')])).toEqual([]);
  });
  it('imports into Personal, decrypts a fixture cookie, reports skips and removes temporary copies', async () => {
    const f = fixture();
    const before = readFileSync(path.join(f.profile, 'History'));
    const report = await importChromeProfile(f.profile, { bookmarks: true, history: true, cookies: true }, f.target, { tempRoot: f.temporary, crypto: new CookieCrypto(f.profile, 'win32', async () => Buffer.from(f.key)) });
    expect(report.bookmarks).toEqual({ imported: 1, skipped: 1 });
    expect(report.history).toEqual({ imported: 1, skipped: 1 });
    expect(report.cookies).toEqual({ imported: 1, skipped: 2 });
    expect(f.navigation.list('personal', 'bookmark')[0]?.title).toBe('<bookmark>');
    expect(f.navigation.list('personal', 'history')[0]?.title).toBe('History');
    expect(f.navigation.list('agent', 'history')).toEqual([]);
    expect(f.accepted[0]).toMatchObject({ name: 'session', value: 'fixture-session', secure: true, httpOnly: true, sameSite: 'lax' });
    expect(report.issues).toContainEqual({ kind: 'cookies', reason: 'app-bound', count: 1 });
    expect(readdirSync(f.temporary)).toEqual([]); expect(report.temporaryCopiesRemoved).toBe(true);
    expect(readFileSync(path.join(f.profile, 'History'))).toEqual(before);
    expect(JSON.stringify(report)).not.toMatch(/fixture-session|example\.invalid|<bookmark>/);
    f.key.fill(0);
  });
  it.runIf(process.platform === 'win32')('uses the production DPAPI helper to unwrap a generated fixture key', async () => {
    const f = fixture();
    writeFileSync(path.join(f.root, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), dpapi('protect', f.key)]).toString('base64') } }));
    const report = await importChromeProfile(f.profile, { bookmarks: false, history: false, cookies: true }, f.target, { tempRoot: f.temporary });
    expect(report.cookies.imported).toBe(1); expect(f.accepted[0]?.value).toBe('fixture-session');
    f.key.fill(0);
  }, 60000);
  it('repeated import does not toggle bookmarks, inflate history or overwrite session cookies', async () => {
    const f = fixture();
    const run = () => importChromeProfile(f.profile, { bookmarks: true, history: true, cookies: true }, f.target, { tempRoot: f.temporary, crypto: new CookieCrypto(f.profile, 'win32', async () => Buffer.from(f.key)) });
    await run(); const second = await run();
    expect(second.bookmarks.imported).toBe(0); expect(second.history.imported).toBe(0); expect(second.cookies.imported).toBe(0);
    expect(f.accepted).toHaveLength(1); expect(f.navigation.list('personal', 'bookmark')).toHaveLength(1);
    f.key.fill(0);
  });
  it('refuses a busy database without removing source journals and still imports independent selected data', async () => {
    const f = fixture(); writeFileSync(path.join(f.profile, 'History-wal'), 'busy');
    const report = await importChromeProfile(f.profile, { bookmarks: true, history: true, cookies: false }, f.target, { tempRoot: f.temporary });
    expect(report.bookmarks.imported).toBe(1); expect(report.history.imported).toBe(0);
    expect(report.issues).toContainEqual({ kind: 'history', reason: 'source-busy', count: 1 });
    expect(readFileSync(path.join(f.profile, 'History-wal'), 'utf8')).toBe('busy'); expect(readdirSync(f.temporary)).toEqual([]);
    f.key.fill(0);
  });
  it('does not read or copy data types that the person did not select', async () => {
    const f = fixture(); rmSync(path.join(f.profile, 'History')); rmSync(path.join(f.profile, 'Network'), { recursive: true });
    const report = await importChromeProfile(f.profile, { bookmarks: true, history: false, cookies: false }, f.target, { tempRoot: f.temporary });
    expect(report.bookmarks.imported).toBe(1); expect(report.issues.every(issue => issue.kind === 'bookmarks')).toBe(true);
    expect(f.accepted).toEqual([]); expect(readdirSync(f.temporary)).toEqual([]);
    f.key.fill(0);
  });
  it('keeps unsupported platform encryption explicit and derives identity from bundled Chromium', async () => {
    const f = fixture();
    const report = await importChromeProfile(f.profile, { bookmarks: false, history: false, cookies: true }, f.target, { crypto: new CookieCrypto(f.profile, 'linux') });
    expect(report.cookies.imported).toBe(0); expect(report.issues).toContainEqual({ kind: 'cookies', reason: 'encryption-unavailable', count: 1 });
    const identity = chromeIdentity('Mozilla/5.0 Chrome/123.0.0.0 @aether/desktop/0.3.0 Aether/1.0 Electron/45.0 Safari/537.36', '157.0.1.2', 'win32');
    expect(identity.userAgent).toBe('Mozilla/5.0 Chrome/157.0.1.2 Safari/537.36'); expect(identity.hints['Sec-CH-UA']).toContain('v="157"');
    f.key.fill(0);
  });
});
