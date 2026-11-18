import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

/**
 * Step 2 exit (plan 3.1, section 14): the Electron app keeps unviewed tabs
 * asleep with metadata only, scales concurrency with free memory and sleeps
 * tabs under pressure, keeps cookies but sweeps caches when a Space is
 * deleted, survives a crashed renderer, renders background Agent tabs in the
 * agent host window, never debugs the person's own tabs, and restores Spaces
 * after a restart. The engine reaches pages through the Electron transport.
 */

interface TabState {
  id: string;
  url: string;
  title: string;
  state: string;
  pid?: number;
}
interface AppState {
  visible: string;
  spaces: Array<{ id: string; kind: string; activeTabId?: string; tabs: TabState[] }>;
}

const GB = 1024 ** 3;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Aether Desktop core (Step 2)', () => {
  let fixtures: FixtureServers;
  let app: DesktopApp;
  let base: string;

  const state = () => app.request<AppState>('state');
  const space = async (id: string) => {
    const found = (await state()).spaces.find((entry) => entry.id === id);
    if (!found) throw new Error(`no Space ${id}`);
    return found;
  };
  async function until<T>(probe: () => Promise<T | undefined>, ms: number, what: string): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const value = await probe();
      if (value !== undefined) return value;
      await wait(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  beforeAll(async () => {
    fixtures = await startFixtureServers(4191, 4192);
    base = fixtures.mainBaseUrl;
    app = await startDesktop({ keepHome: true });
    // Hold memory at a roomy reading so the real watchdog never acts on this machine's load mid-test.
    await app.request('setMemory', { free: 28 * GB, total: 32 * GB });
  }, 60000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await fixtures?.close();
  });

  it('starts with the Personal Space and one tab, and never debugs the person\'s tabs', async () => {
    const initial = await state();
    expect(initial.visible).toBe('personal');
    const personal = initial.spaces.find((entry) => entry.id === 'personal');
    expect(personal?.kind).toBe('human');
    expect(personal?.tabs).toHaveLength(1);
    await expect(app.request('capture', { tabId: personal?.tabs[0]?.id })).rejects.toThrow(/No target with id/);
  });

  it('opens 15 tabs lazily: one live, fourteen asleep with only metadata stored', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Watch hunt' });
    const urls = Array.from({ length: 15 }, (_, index) => `${base}/shop/item/${(index % 16) + 1}`);
    const opened = await app.request<{ tabIds: string[]; live: number; hibernated: number }>('openTabs', { spaceId: id, urls, lazy: true });
    expect(opened).toMatchObject({ live: 1, hibernated: 14 });
    expect(opened.tabIds).toHaveLength(15);
    const tabs = (await space(id)).tabs;
    expect(tabs.filter((tab) => tab.pid !== undefined)).toHaveLength(1);
    expect(tabs.filter((tab) => tab.state === 'hibernated')).toHaveLength(14);
    await wait(500);
    const stored = await app.request<{ rows: number; bytes: number }>('storeTabs', { spaceId: id });
    expect(stored.rows).toBe(15);
    expect(stored.bytes / stored.rows).toBeLessThan(300);
  }, 30000);

  it('scales live pages with free memory and puts background tabs to sleep under pressure', async () => {
    await app.request('setMemory', { free: 28 * GB, total: 32 * GB });
    const roomy = await app.request<number>('slots');
    expect(roomy).toBeGreaterThan(1);
    await app.request('setMemory', { free: 6 * GB, total: 32 * GB });
    expect(await app.request<number>('slots')).toBe(1);

    await app.request('setMemory', { free: 28 * GB, total: 32 * GB });
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Fan out' });
    const urls = [1, 2, 3, 4].map((item) => `${base}/shop/item/${item}`);
    const opened = await app.request<{ live: number }>('openTabs', { spaceId: id, urls });
    expect(opened.live).toBe(Math.min(4, roomy));

    await app.request('setMemory', { free: 1 * GB, total: 32 * GB });
    // Within the wake grace nothing an agent just opened is put to sleep.
    expect(await app.request<number>('watchdog')).toBe(0);
    let slept = 0;
    for (let round = 0; round < 10; round++) slept += await app.request<number>('watchdog', { laterMs: 60_000 });
    expect(slept).toBe(opened.live - 1);
    const spaces = (await state()).spaces;
    for (const entry of spaces) {
      for (const tab of entry.tabs) if (tab.pid !== undefined) expect(tab.id).toBe(entry.activeTabId);
    }
    const fanOut = spaces.find((entry) => entry.id === id);
    expect(fanOut?.tabs.filter((tab) => tab.id !== fanOut.activeTabId).every((tab) => tab.state === 'hibernated')).toBe(true);
    await app.request('setMemory', { free: 28 * GB, total: 32 * GB });
  }, 40000);

  it('renders a background Agent tab in the host window: trusted scrolling loads its lazy items', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Lazy list' });
    const tabId = await app.request<string>('openTab', { spaceId: id, url: `${base}/shop/list?page=1`, live: true });
    await until(async () => ((await space(id)).tabs.find((tab) => tab.id === tabId)?.state === 'live' ? true : undefined), 10000, 'the list to load');
    expect((await state()).visible).toBe('personal');
    const capture = await app.request<{ url: string; tokens: number }>('capture', { tabId });
    expect(capture.url).toBe(`${base}/shop/list?page=1`);
    expect(await app.request<number>('eval', { tabId, expression: "document.querySelectorAll('.card').length" })).toBe(8);
    await app.request('wheel', { tabId, times: 6 });
    const loaded = await until(
      async () => {
        const count = await app.request<number>('eval', { tabId, expression: "document.querySelectorAll('.card').length" });
        return count === 12 ? count : undefined;
      },
      5000,
      'the lazily loaded cards',
    );
    expect(loaded).toBe(12);
  }, 40000);

  it('blocks ad and tracking requests from Agent tabs only', async () => {
    const state0 = await state();
    const agentTab = state0.spaces.find((entry) => entry.kind === 'agent' && entry.tabs.some((tab) => tab.pid !== undefined))?.tabs.find((tab) => tab.pid !== undefined);
    const before = await app.request<number>('blocked');
    await app.request('eval', { tabId: agentTab?.id, expression: "fetch('https://ad.doubleclick.net/x').then(() => 'loaded', () => 'blocked')" });
    expect(await app.request<number>('blocked')).toBe(before + 1);
    const personalTab = (await space('personal')).activeTabId;
    await app.request('eval', { tabId: personalTab, expression: "fetch('https://ad.doubleclick.net/x').then(() => 'loaded', () => 'failed')" });
    expect(await app.request<number>('blocked')).toBe(before + 1);
  }, 30000);

  it('deleting a Space clears its caches but keeps cookies, so the person stays signed in', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Cache owner' });
    const tabId = await app.request<string>('openTab', { spaceId: id, url: `${fixtures.crossOriginBaseUrl}/cross-origin-child.html`, live: true });
    await until(async () => ((await space(id)).tabs.find((tab) => tab.id === tabId)?.state === 'live' ? true : undefined), 10000, 'the page');
    const stored = await app.request<string>('eval', {
      tabId,
      expression: "document.cookie = 'session=kept; max-age=3600; path=/'; caches.open('aether-test').then((cache) => cache.put('/probe', new Response('cached'))).then(() => caches.keys()).then((keys) => keys.join(','))",
    });
    expect(stored).toBe('aether-test');
    const swept = await app.request<{ sweptOrigins: string[] }>('closeSpace', { spaceId: id });
    expect(swept.sweptOrigins).toEqual([fixtures.crossOriginBaseUrl]);

    const { id: next } = await app.request<{ id: string }>('agentSpace', { name: 'After delete' });
    const again = await app.request<string>('openTab', { spaceId: next, url: `${fixtures.crossOriginBaseUrl}/cross-origin-child.html`, live: true });
    await until(async () => ((await space(next)).tabs.find((tab) => tab.id === again)?.state === 'live' ? true : undefined), 10000, 'the page again');
    expect(await app.request<string>('eval', { tabId: again, expression: 'document.cookie' })).toContain('session=kept');
    expect(await app.request<string>('eval', { tabId: again, expression: "caches.keys().then((keys) => keys.join(','))" })).toBe('');
  }, 40000);

  it('survives a crashed page: only that tab is marked crashed, the app and other tabs keep working', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Crash test' });
    const doomed = await app.request<string>('openTab', { spaceId: id, url: `${base}/form.html`, live: true });
    const healthy = await app.request<string>('openTab', { spaceId: id, url: `${base}/table.html`, live: true });
    await until(async () => ((await space(id)).tabs.every((tab) => tab.state === 'live') ? true : undefined), 10000, 'both tabs');
    await app.request('crashTab', { tabId: doomed });
    const after = await until(async () => {
      const tabs = (await space(id)).tabs;
      return tabs.find((tab) => tab.id === doomed)?.state === 'crashed' ? tabs : undefined;
    }, 10000, 'the crash to register');
    expect(after.find((tab) => tab.id === healthy)?.state).toBe('live');
    await expect(app.request('capture', { tabId: doomed })).rejects.toThrow(/No target with id/);
    const capture = await app.request<{ url: string }>('capture', { tabId: healthy });
    expect(capture.url).toBe(`${base}/table.html`);
  }, 40000);

  it('restores Spaces and tabs after a restart, all asleep except the Personal tab', async () => {
    const before = await state();
    const watchHunt = before.spaces.find((entry) => entry.id === 'watch-hunt');
    await app.close();
    app = await startDesktop({ home: app.home });
    await app.request('setMemory', { free: 28 * GB, total: 32 * GB });
    const restored = await state();
    const again = restored.spaces.find((entry) => entry.id === 'watch-hunt');
    expect(again?.tabs.map((tab) => tab.url)).toEqual(watchHunt?.tabs.map((tab) => tab.url));
    expect(again?.tabs.every((tab) => tab.state === 'hibernated')).toBe(true);
    const live = restored.spaces.flatMap((entry) => entry.tabs).filter((tab) => tab.pid !== undefined);
    expect(live.map((tab) => tab.id)).toEqual([restored.spaces.find((entry) => entry.id === 'personal')?.activeTabId]);
    expect(restored.spaces.some((entry) => entry.id === 'cache-owner')).toBe(false);
  }, 60000);
});
