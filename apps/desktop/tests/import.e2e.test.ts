import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportState } from '@aether/shared';
import { startDesktop, type DesktopApp } from './desktop-harness.js';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const value = await probe(); if (ready(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Import UI did not settle');
}

describe('person-selected browser import', () => {
  let app: DesktopApp;
  let root: string;
  let directory: string;
  let server: Server;
  let identityUrl: string;
  let identityHeaders: IncomingHttpHeaders | undefined;
  const evaluate = <T>(expression: string) => app.request<T>('shellEval', { expression });
  const send = (command: object) => evaluate<{ ok: boolean; error?: string }>(`window.aether.send(${JSON.stringify(command)})`);
  beforeAll(async () => {
    server = createServer((request, response) => { if (request.url === '/identity') identityHeaders = request.headers; response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Local identity fixture</title>Identity fixture'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture address');
    identityUrl = `http://127.0.0.1:${address.port}/identity`;
    root = mkdtempSync(path.join(tmpdir(), 'aether-import-ui-'));
    directory = path.join(root, 'Chosen profile'); mkdirSync(path.join(directory, 'Network'), { recursive: true });
    writeFileSync(path.join(directory, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Imported bookmark', url: 'https://example.invalid/saved' }] } } }));
    const history = new DatabaseSync(path.join(directory, 'History'));
    history.exec("CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER,visit_count INTEGER); INSERT INTO urls VALUES ('https://example.invalid/history','Imported history',13300000000000000,3)"); history.close();
    const cookies = new DatabaseSync(path.join(directory, 'Network', 'Cookies'));
    cookies.exec("CREATE TABLE meta(key TEXT,value TEXT); INSERT INTO meta VALUES('version','24'); CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,value TEXT,encrypted_value BLOB,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER)");
    const insert = cookies.prepare("INSERT INTO cookies VALUES('.example.invalid',?,'/',?,?,?,1,1,1)");
    const expiration = (BigInt(Math.trunc(Date.now() / 1000)) + 86400n + 11644473600n) * 1000000n;
    insert.run('import-fixture-session', 'fixture-cookie-secret', Buffer.alloc(0), expiration);
    insert.run('import-app-bound', '', Buffer.from('v20-sentinel'), expiration); cookies.close();
    app = await startDesktop({ keepHome: true });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"), Boolean);
  }, 60000);
  afterAll(async () => { await app?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (root) rmSync(root, { recursive: true, force: true }); });

  it('offers optional import on a fresh new tab and opens the unprivileged link into trusted Settings', async () => {
    const state = await app.request<{ spaces: Array<{ id: string; activeTabId: string }> }>('state');
    const tabId = state.spaces.find(space => space.id === 'personal')?.activeTabId;
    await until(() => app.request<boolean>('eval', { tabId, expression: "Boolean(document.querySelector('.import-invitation a'))" }), Boolean);
    expect(await app.request('eval', { tabId, expression: 'typeof window.aether' })).toBe('undefined');
    await app.request('eval', { tabId, expression: "document.querySelector('.import-invitation a').click()" });
    await until(() => evaluate<boolean>("Boolean(document.getElementById('browser-import'))"), Boolean);
    expect((await send({ type: 'import.discover' })).ok).toBe(true);
    expect((await app.request<ImportState>('importState')).profiles).toEqual([]);
    expect(await evaluate<string>("document.querySelector('.import-empty').textContent")).toContain('profile folder');
  });

  it('imports only selected data, then explicitly opts into cookies and reports skips without leaking values', async () => {
    await app.request('importProfileFolder', { directory });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('#import-profile')?.value) && document.querySelector('.import-primary')?.disabled === false"), Boolean);
    await evaluate("document.querySelector('.import-primary').click()");
    await until(() => app.request<ImportState>('importState'), state => !state.busy && Boolean(state.report));
    let state = await app.request<ImportState>('importState');
    expect(state.report?.bookmarks.imported).toBe(1); expect(state.report?.history.imported).toBe(1); expect(state.report?.cookies.imported).toBe(0);
    expect(await app.request('persistentCookies')).toEqual([]);
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.import-report'))"), Boolean);
    await evaluate("document.querySelectorAll('.import-choices input')[2].click()");
    await until(() => evaluate<boolean>("document.querySelectorAll('.import-choices input')[2].checked && !document.querySelector('.import-primary').disabled"), Boolean);
    await evaluate("document.querySelector('.import-primary').click()");
    await until(() => app.request<ImportState>('importState'), value => !value.busy && value.report?.cookies.imported === 1);
    state = await app.request<ImportState>('importState');
    expect(state.report?.bookmarks.imported).toBe(0); expect(state.report?.history.imported).toBe(0);
    expect(state.report?.cookies).toEqual({ imported: 1, skipped: 1 });
    expect(state.report?.temporaryCopiesRemoved).toBe(true);
    expect(state.report?.issues).toContainEqual({ kind: 'cookies', reason: 'app-bound', count: 1 });
    expect(JSON.stringify(state)).not.toContain('fixture-cookie-secret');
    expect(await app.request('persistentCookies')).toEqual([expect.objectContaining({ name: 'import-fixture-session', secure: true, httpOnly: true })]);
  });

  it('refuses arbitrary paths and import actions outside Personal Settings', async () => {
    expect((await send({ type: 'import.start', profileId: directory, selection: { bookmarks: true, history: true, cookies: false } })).ok).toBe(false);
    const before = await app.request<ImportState>('importState');
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'No profile capability' });
    await app.request('showSpace', { spaceId: id });
    expect((await send({ type: 'import.discover' })).ok).toBe(false);
    expect((await send({ type: 'import.choose' })).ok).toBe(false);
    expect((await send({ type: 'import.start', profileId: before.profiles[0]?.id, selection: { bookmarks: true, history: false, cookies: false } })).ok).toBe(false);
    expect((await app.request<ImportState>('importState')).report).toEqual(before.report);
  });

  it('persists imported cookies and the first-run choice after restart', async () => {
    const home = app.home; await app.close(); app = await startDesktop({ home, keepHome: true });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"), Boolean);
    expect((await app.request<ImportState>('importState')).offer).toBe(false);
    expect(await app.request('persistentCookies')).toEqual([expect.objectContaining({ name: 'import-fixture-session' })]);
    await send({ type: 'settings.open' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('#browser-import'))"), Boolean);
    expect(await evaluate<boolean>("Boolean(document.querySelector('.import-offer'))")).toBe(false);
    await send({ type: 'history.open' });
    const state = await app.request<{ spaces: Array<{ id: string; activeTabId: string }> }>('state');
    const tabId = state.spaces.find(space => space.id === 'personal')?.activeTabId;
    await until(() => app.request<string>('eval', { tabId, expression: 'document.body.textContent' }), text => text.includes('Imported history'));
    await send({ type: 'nav.go', input: identityUrl });
    await until(async () => identityHeaders, Boolean);
    const userAgent = String(identityHeaders?.['user-agent']);
    expect(userAgent).toMatch(/Chrome\/[\d.]+/); expect(userAgent).not.toMatch(/Electron|aether/i);
    expect(identityHeaders?.['sec-ch-ua']).toContain(`v="${userAgent.match(/Chrome\/(\d+)/)?.[1]}"`);
    expect(identityHeaders?.['sec-ch-ua-platform']).toBe(JSON.stringify(process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'));
    expect(await app.request<string>('eval', { tabId, expression: 'navigator.userAgent' })).not.toMatch(/Electron|aether/i);
  }, 60000);
});
