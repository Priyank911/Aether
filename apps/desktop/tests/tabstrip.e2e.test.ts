import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShellCommand } from '@aether/shared';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type TabInfo = { id: string; state: string; muted: boolean; liveMuted?: boolean };
type State = { visible: string; spaces: Array<{ id: string; activeTabId?: string; tabs: TabInfo[] }> };

async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    last = await probe();
    if (ready(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Tab strip did not settle: ${JSON.stringify(last)}`);
}

describe('Tab strip and Space menu (Phase 4.2)', () => {
  let app: DesktopApp;
  let server: Server;
  let slowResponse: ServerResponse | undefined;
  let slowUrl: string;
  const evaluate = <T>(expression: string, overlay = false) => app.request<T>('shellEval', { expression, overlay });
  const command = (value: ShellCommand) => evaluate(`window.aether.send(${JSON.stringify(value)})`);
  const state = () => app.request<State>('state');
  const ids = () => evaluate<string[]>("Array.from(document.querySelectorAll('[role=tab]')).map(e => e.dataset.tabId)");
  const menuVisible = () => evaluate<boolean>("Boolean(document.querySelector('[role=menu]'))", true);

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url !== '/') { response.writeHead(404); response.end(); return; }
      slowResponse = response;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.write('<!doctype html><title>Loading fixture</title><body>Waiting');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server');
    slowUrl = `http://127.0.0.1:${address.port}/`;
    app = await startDesktop();
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.space-chip') && document.querySelector('[aria-selected=true][aria-busy=false]'))"), Boolean);
  }, 60000);

  afterAll(async () => {
    slowResponse?.end('</body>');
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('renders neutral new-tab icons and places the new-tab button next to the tabs', async () => {
    const layout = await evaluate<{ gap: number; fallback: boolean; topAccent: string }>(`(() => {
      const tab = document.querySelector('[role=tab]');
      const plus = document.querySelector('[aria-label="New tab"]');
      return { gap: plus.getBoundingClientRect().left - tab.getBoundingClientRect().right,
        fallback: Boolean(tab.querySelector('.favicon use[href="#i-globe"]')),
        topAccent: getComputedStyle(tab, '::before').content };
    })()`);
    expect(layout.fallback).toBe(true);
    expect(layout.gap).toBeLessThanOrEqual(12);
    expect(layout.topAccent).toBe('none');
  });

  it('shows real loading and crashed states in the favicon slot', async () => {
    await command({ type: 'tab.new', url: slowUrl });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[aria-selected=true] .tab-spinner'))"), Boolean);
    const response = await until(() => Promise.resolve(slowResponse), Boolean);
    response?.end('</body>');
    const selected = await until(() => evaluate<string | null>("document.querySelector('[aria-selected=true][aria-busy=false]')?.dataset.tabId ?? null"), Boolean);
    await app.request('crashTab', { tabId: selected });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.crashed .favicon use[href=\"#i-warning\"]'))"), Boolean);
    await command({ type: 'tab.close', tabId: selected as string });
  });

  it('reorders through drag/drop and activates tabs through arrow keys', async () => {
    await command({ type: 'tab.new' });
    await command({ type: 'tab.new' });
    const before = await until(ids, (value) => value.length === 3);
    await evaluate(`(() => {
      window.testTabDrag = new DataTransfer();
      document.querySelector('[role=tab]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.testTabDrag }));
    })()`);
    await evaluate(`(() => {
      const target = document.querySelectorAll('[role=tab]')[2];
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.testTabDrag, clientX: target.getBoundingClientRect().right - 1 }));
      delete window.testTabDrag;
    })()`);
    const expected = [before[1], before[2], before[0]];
    await until(ids, (value) => JSON.stringify(value) === JSON.stringify(expected));
    expect((await state()).spaces.find((space) => space.id === 'personal')?.tabs.map((tab) => tab.id)).toEqual(expected);
    await evaluate("document.querySelector('[aria-selected=true]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
    await until(() => evaluate<string>("document.querySelector('[aria-selected=true]').dataset.tabId"), (id) => id === before[0]);
    expect(await evaluate<string>('document.activeElement.dataset.tabId')).toBe(before[0]);
  });

  it('mutes through the tab control and retains mute while the tab sleeps and wakes', async () => {
    const current = (await state()).spaces.find((space) => space.id === 'personal')?.activeTabId;
    if (!current) throw new Error('Expected active Personal tab');
    await command({ type: 'tab.mute', tabId: current, muted: true });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[aria-selected=true] .tab-audio[aria-pressed=true]'))"), Boolean);
    const other = (await ids()).find((id) => id !== current);
    if (!other) throw new Error('Expected another Personal tab');
    await command({ type: 'tab.activate', tabId: other });
    await app.request('hibernate', { tabId: current });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.sleeping .favicon'))"), Boolean);
    await command({ type: 'tab.activate', tabId: current });
    await until(state, (value) => value.spaces.find((space) => space.id === 'personal')?.tabs.some((tab) => tab.id === current && tab.liveMuted === true) ?? false);
    await until(() => evaluate<boolean>(`Boolean(document.querySelector('[data-tab-id="${current}"][aria-selected=true] .tab-audio'))`), Boolean);
    await evaluate("document.querySelector('[aria-selected=true] .tab-audio').click()");
    await until(state, (value) => value.spaces.find((space) => space.id === 'personal')?.tabs.some((tab) => tab.id === current && !tab.muted && tab.liveMuted === false) ?? false);
  });

  it('closes tabs with middle click without closing a neighboring tab', async () => {
    const before = await ids();
    await evaluate("document.querySelector('[role=tab]').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))");
    expect(await until(ids, (value) => value.length === before.length - 1)).toEqual(before.slice(1));
  });

  it('renders Space status over the native page and restores focus on Escape', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Compare listings' });
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'acting', step: 1, label: 'Comparing listings', timestamp: Date.now() } });
    await evaluate("document.querySelector('.space-chip').click()");
    await until(menuVisible, Boolean);
    expect(await evaluate<string[]>("Array.from(document.querySelectorAll('[role=menuitemradio]')).map(e=>e.textContent)", true)).toEqual(['PersonalYour browsing', 'Compare listingsWorking']);
    expect((await app.request<{ overlayAttached: boolean }>('shellLayout')).overlayAttached).toBe(true);
    await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))", true);
    await until(menuVisible, (visible) => !visible);
    await until(() => evaluate<string>('document.activeElement.className'), (name) => name.includes('space-chip'));
    expect((await app.request<{ overlayAttached: boolean }>('shellLayout')).overlayAttached).toBe(false);
  });

  it('restores an archived Space while leaving its background tabs asleep', async () => {
    const archived = { id: 'archived-review', name: 'Saved research', kind: 'agent', state: 'idle', partition: 'persist', archived: true, createdAt: 1 };
    await app.request('seedArchivedSpace', { space: archived, tabs: ['saved-one', 'saved-two'].map((id) => ({ id, spaceId: archived.id, url: 'about:blank', title: id, scrollY: 0, state: 'hibernated', lastViewedAt: 1 })) });
    await evaluate("document.querySelector('.space-chip').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[data-space-id=archived-review]'))", true), Boolean);
    await evaluate("document.querySelector('[data-space-id=archived-review]').click()", true);
    const restored = await until(state, (value) => value.visible === archived.id && value.spaces.find((space) => space.id === archived.id)?.tabs[0]?.state === 'live');
    const tabs = restored.spaces.find((space) => space.id === archived.id)?.tabs;
    expect(tabs?.map((tab) => tab.state)).toEqual(['live', 'hibernated']);
    await until(() => evaluate<{ visible: boolean; error: string | null }>("({visible: Boolean(document.querySelector('[role=menu]')), error: document.querySelector('[role=alert]')?.textContent ?? null})", true), (value) => !value.visible);
    expect((await app.request<{ overlayAttached: boolean }>('shellLayout')).overlayAttached).toBe(false);
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true, bubbles: true }))");
    await until(state, (value) => value.visible === 'personal');
  });

  it.each(['light', 'dark'])('keeps tab overflow contained and captures the %s shell for review', async (theme) => {
    await app.request('shellTheme', { theme });
    await until(() => evaluate<boolean>(`matchMedia('(prefers-color-scheme: ${theme})').matches`), Boolean);
    for (let index = 0; index < 7; index++) await command({ type: 'tab.new' });
    const layout = await app.request<{ content: { width: number }; shell: { width: number } }>('shellLayout', { width: 640, height: 700 });
    const widths = await until(() => evaluate<{ width: number; scroll: number; overflow: boolean }>("({width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: document.querySelector('.tabs').scrollWidth > document.querySelector('.tabs').clientWidth})"), (value) => Math.abs(value.width - layout.content.width) <= 1);
    expect(layout.content.width).toBeLessThan(800);
    expect(widths.scroll).toBeLessThanOrEqual(widths.width);
    expect(widths.overflow).toBe(true);
    const directory = path.resolve('.userData/ui-review');
    mkdirSync(directory, { recursive: true });
    const png = await app.request<string>('shellCapture');
    writeFileSync(path.join(directory, `chrome-${theme}.png`), Buffer.from(png, 'base64'));
  });
});
