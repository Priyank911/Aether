import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShellCommand } from '@aether/shared';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type State = { visible: string; spaces: Array<{ id: string; activeTabId?: string; tabs: Array<{ id: string; url: string; state: string }> }> };

async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await probe();
    if (ready(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Toolbar did not settle: ${JSON.stringify(last)}`);
}

describe('Toolbar and omnibox (Phase 4.3)', () => {
  let app: DesktopApp;
  let server: Server;
  let base: string;
  let held: ServerResponse | undefined;
  const evaluate = <T>(expression: string, overlay = false) => app.request<T>('shellEval', { expression, overlay });
  const command = (value: ShellCommand) => evaluate(`window.aether.send(${JSON.stringify(value)})`);
  const state = () => app.request<State>('state');
  const value = () => evaluate<string>("document.querySelector('[role=combobox]').value");
  const input = async (keyCode: string, type = 'keyDown') => {
    keyCode = ({ ArrowDown: 'Down', ArrowUp: 'Up' } as Record<string, string>)[keyCode] ?? keyCode;
    if (type === 'char') {
      for (const character of keyCode) await app.request('shellInput', { event: { type, keyCode: character } });
    } else {
      await app.request('shellInput', { event: { type, keyCode } });
      await app.request('shellInput', { event: { type: 'keyUp', keyCode } });
      if (keyCode === 'Escape') {
        await until(() => evaluate<boolean>("document.querySelector('[role=combobox]').getAttribute('aria-expanded') === 'false' && document.activeElement.getAttribute('role') !== 'combobox'"), Boolean);
        await until(() => evaluate<boolean>("!document.querySelector('.suggestions')", true), Boolean);
      }
    }
  };
  const focusInput = async () => {
    const point = await evaluate<{ x: number; y: number }>("(() => { const rect = document.querySelector('[role=combobox]').getBoundingClientRect(); return {x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2)}; })()");
    for (const type of ['mouseDown', 'mouseUp']) await app.request('shellInput', { event: { type, ...point, button: 'left', clickCount: 1 } });
    await until(() => evaluate<{ ready: boolean; events: unknown; active: string; value: string }>("({ready: document.activeElement.getAttribute('role') === 'combobox' && document.querySelector('[role=combobox]').getAttribute('aria-expanded') === 'true', events: window.focusLog, active: document.activeElement.outerHTML, value: document.querySelector('[role=combobox]').value})"), (result) => result.ready);
  };
  const typeQuery = async (query: string) => {
    await focusInput();
    await evaluate("document.querySelector('[role=combobox]').select()");
    await input(query, 'char');
    await until(value, (text) => text === query);
    await until(() => evaluate<string | null>("document.querySelector('.suggestions-backdrop')?.dataset.query ?? null", true), (text) => text === query);
  };
  const active = (current: State) => {
    const space = current.spaces.find((entry) => entry.id === current.visible);
    return space?.tabs.find((tab) => tab.id === space.activeTabId);
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith('/slow')) { held = response; response.writeHead(200, { 'Content-Type': 'text/html' }); response.write('<!doctype html><title>Slow page</title><body>Waiting'); return; }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<!doctype html><title>${request.url?.startsWith('/second') ? 'Second page' : 'Local fixture'}</title><body>Local toolbar fixture</body>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    base = `http://127.0.0.1:${address.port}`;
    app = await startDesktop();
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[role=combobox]'))"), Boolean);
    await evaluate("window.focusLog = []; for (const name of ['mousedown', 'mouseup', 'click', 'focusin', 'focusout']) window.addEventListener(name, event => { window.focusLog.push({name, target: event.target.tagName, value: document.querySelector('[role=combobox]').value}); window.focusLog = window.focusLog.slice(-15); }, true)");
  }, 60000);

  afterAll(async () => {
    held?.end('</body>');
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('shows only the host at rest and the complete URL on focus, with Escape restoring the host', async () => {
    await command({ type: 'nav.go', input: `${base}/first?source=toolbar#details` });
    await until(state, (current) => active(current)?.state === 'live' && active(current)?.url === `${base}/first?source=toolbar#details`);
    expect(await until(value, (text) => text === new URL(base).host)).toBe(new URL(base).host);
    await focusInput();
    await until(value, (text) => text === `${base}/first?source=toolbar#details`);
    await input('Escape');
    await until(value, (text) => text === new URL(base).host);
    await until(() => app.request<{ overlayAttached: boolean }>('shellLayout'), (layout) => !layout.overlayAttached);
  });

  it('draws local suggestions above the native page while keyboard focus and ARIA selection remain with the input', async () => {
    await app.request('seedNavigation', { kind: 'bookmark', spaceId: 'personal', url: `${base}/second?from=bookmark`, title: 'Local saved destination' });
    await typeQuery('Local saved');
    await until(() => evaluate<string[]>("Array.from(document.querySelectorAll('.suggestion-label')).map(e => e.textContent)", true), (labels) => labels.includes('Local saved destination'));
    expect((await app.request<{ overlayAttached: boolean }>('shellLayout')).overlayAttached).toBe(true);
    expect(await evaluate<string>('document.activeElement.getAttribute("role")')).toBe('combobox');
    await input('ArrowDown');
    await until(() => evaluate<{ id: string | null; value: string; expanded: string | null; events: unknown }>("({id: document.querySelector('[role=combobox]').getAttribute('aria-activedescendant'), value: document.querySelector('[role=combobox]').value, expanded: document.querySelector('[role=combobox]').getAttribute('aria-expanded'), events: window.focusLog})"), (result) => result.id === 'omnibox-option-1');
    expect(await evaluate<string>("document.getElementById('omnibox-option-1').textContent")).toBe('Local saved destination');
    expect(await value()).toBe('Local saved');
    await input('Enter');
    await until(state, (current) => active(current)?.url === `${base}/second?from=bookmark`);
    await until(value, (text) => text === new URL(base).host);
    await until(() => evaluate<boolean>("!document.querySelector('.suggestions')", true), Boolean);
    await until(() => app.request<{ overlayAttached: boolean }>('shellLayout'), (layout) => !layout.overlayAttached);
  });

  it('accepts a suggestion through real overlay pointer input', async () => {
    await typeQuery('Local saved');
    const point = await until(() => evaluate<{ x: number; y: number } | null>(`(() => {
      const row = Array.from(document.querySelectorAll('.suggestion')).find(e => e.textContent.includes('Local saved destination'));
      if (!row) return null;
      const rect = row.getBoundingClientRect(); return {x: Math.round(rect.left + 20), y: Math.round(rect.top + rect.height / 2)};
    })()`, true), (result) => result !== null);
    if (!point) throw new Error('Expected bookmark row');
    for (const type of ['mouseDown', 'mouseUp']) await app.request('shellInput', { overlay: true, event: { type, ...point, button: 'left', clickCount: 1 } });
    await until(() => app.request<{ overlayAttached: boolean }>('shellLayout'), (layout) => !layout.overlayAttached);
    await until(state, (current) => active(current)?.url === `${base}/second?from=bookmark`);
  });

  it('rejects a delayed pointer acceptance after the query or selected destination changes', async () => {
    const before = active(await state())?.url;
    await command({ type: 'omnibox.update', query: 'old.example', selected: 0, left: 120, width: 500 });
    await command({ type: 'omnibox.update', query: 'new.example', selected: 0, left: 120, width: 500 });
    expect(await command({ type: 'omnibox.accept', index: 0, query: 'old.example', input: 'old.example' })).toEqual({ ok: false, error: 'Suggestions changed. Choose an address again.' });
    expect(await command({ type: 'omnibox.accept', index: 0, query: 'new.example', input: 'old.example' })).toEqual({ ok: false, error: 'Suggestions changed. Choose an address again.' });
    expect(active(await state())?.url).toBe(before);
    await command({ type: 'omnibox.close' });
    await until(() => app.request<{ overlayAttached: boolean }>('shellLayout'), (layout) => !layout.overlayAttached);
  });

  it('processes arrows and Enter in order without waiting for a renderer snapshot', async () => {
    await evaluate(`(async () => {
      await window.aether.send({type: 'omnibox.update', query: 'Local saved', selected: 0, left: 120, width: 500});
      await window.aether.send({type: 'omnibox.move', query: 'Local saved', direction: 1});
      return window.aether.send({type: 'omnibox.submit', query: 'Local saved'});
    })()`);
    await until(state, (current) => active(current)?.url === `${base}/second?from=bookmark`);
    await until(() => app.request<{ overlayAttached: boolean }>('shellLayout'), (layout) => !layout.overlayAttached);
  });

  it('learns committed local history and keeps suggestions isolated to the visible Space', async () => {
    await typeQuery('first?source');
    await until(() => evaluate<string[]>("Array.from(document.querySelectorAll('.suggestion-url')).map(e => e.textContent)", true), (urls) => urls.includes(`${base}/first?source=toolbar#details`));
    await input('Escape');
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Private comparison' });
    await app.request('seedNavigation', { kind: 'history', spaceId: id, url: `${base}/private-agent-only`, title: 'Private agent destination' });
    await typeQuery('Private agent');
    const labels = await until(() => evaluate<string[]>("Array.from(document.querySelectorAll('.suggestion-label')).map(e => e.textContent)", true), (items) => items[0]?.includes('Private agent') ?? false);
    expect(labels).not.toContain('Private agent destination');
    await input('Escape');
  });

  it('keeps refused input editable and exposes an actionable address error', async () => {
    await focusInput();
    await evaluate("document.querySelector('[role=combobox]').select()");
    await input('javascript:alert(1)', 'char');
    await until(value, (text) => text === 'javascript:alert(1)');
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.suggestions-backdrop'))", true), (open) => !open);
    await input('Enter');
    await until(() => evaluate<string | null>("document.querySelector('[role=combobox]').getAttribute('aria-invalid')"), (text) => text === 'true');
    expect(await value()).toBe('javascript:alert(1)');
    expect(await evaluate<string>("document.querySelector('#omnibox-error').textContent")).toMatch(/not opened|not allowed|refus|blocked|cannot/i);
    await input('Escape');
  });

  it('drives Back, Forward, Reload and Stop from real navigation state', async () => {
    await command({ type: 'nav.go', input: `${base}/first` });
    await until(state, (current) => active(current)?.state === 'live' && active(current)?.url === `${base}/first`);
    await until(() => evaluate<boolean>("!document.querySelector('[aria-label=Back]').disabled"), Boolean);
    await evaluate("document.querySelector('[aria-label=Back]').click()");
    await until(state, (current) => active(current)?.url === `${base}/second?from=bookmark`);
    await until(() => evaluate<boolean>("!document.querySelector('[aria-label=Forward]').disabled"), Boolean);
    await evaluate("document.querySelector('[aria-label=Forward]').click()");
    await until(state, (current) => active(current)?.url === `${base}/first` && active(current)?.state === 'live');
    await command({ type: 'nav.go', input: `${base}/slow` });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[aria-label=\"Stop loading\"]'))"), Boolean);
    await until(() => Promise.resolve(Boolean(held)), Boolean);
    await evaluate("document.querySelector('[aria-label=\"Stop loading\"]').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[aria-label=Reload]'))"), Boolean);
    held?.end('</body>');
  });

  it('counts working Spaces and turns amber when any needs the person', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Background work' });
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'acting', step: 1, label: 'Checking fixtures', timestamp: Date.now() } });
    await until(() => evaluate<string>("document.querySelector('.agent-indicator').getAttribute('aria-label')"), (label) => label.startsWith('1 running'));
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'waiting_human', step: 1, label: 'Needs review', timestamp: Date.now() } });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.agent-indicator.waiting'))"), Boolean);
    expect(await evaluate<string>("document.querySelector('.agent-indicator').getAttribute('aria-label')")).toContain('1 needs you');
    await evaluate("document.querySelector('.agent-indicator').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[role=menu]'))", true), Boolean);
    await command({ type: 'space.menu', open: false });
    await until(() => evaluate<boolean>("!document.querySelector('[role=menu]')", true), Boolean);
    await until(() => evaluate<boolean>("document.activeElement.classList.contains('space-chip')"), Boolean);
  });

  it('offers a native browser menu with working entries only', async () => {
    const items = await app.request<Array<{ label?: string; submenu?: Array<{ label?: string; role?: string }> }>>('menuTemplate');
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(['New tab', 'Back', 'Reload', 'Zoom', 'Edit', 'Spaces', 'Side panel', 'Quit']));
    expect(items.find((item) => item.label === 'Edit')?.submenu).toEqual(expect.arrayContaining([{ label: 'Copy', role: 'copy' }, { label: 'Paste', role: 'paste' }]));
    expect(items.map((item) => item.label).join(' ')).not.toMatch(/sync|extension|Gemini/i);
    expect(await evaluate<boolean>("Boolean(document.querySelector('[aria-label=\"Main menu\"][aria-haspopup=menu]'))")).toBe(true);
  });

  it('handles browser shortcuts when a native page owns keyboard focus', async () => {
    const before = await state();
    const tabId = active(before)?.id;
    if (!tabId) throw new Error('Expected a live page');
    const count = before.spaces.find((space) => space.id === before.visible)?.tabs.length ?? 0;
    await app.request('shellInput', { tabId, event: { type: 'keyDown', keyCode: 't', modifiers: ['control'] } });
    await until(state, (current) => (current.spaces.find((space) => space.id === current.visible)?.tabs.length ?? 0) === count + 1);
    await until(() => evaluate<boolean>("document.activeElement.getAttribute('role') === 'combobox'"), Boolean);
    const created = active(await state())?.id;
    if (!created) throw new Error('Expected a new tab');
    await app.request('shellInput', { tabId: created, event: { type: 'keyDown', keyCode: 'w', modifiers: ['control'] } });
    await until(state, (current) => (current.spaces.find((space) => space.id === current.visible)?.tabs.length ?? 0) === count);
    await app.request('shellInput', { tabId, event: { type: 'keyDown', keyCode: 'l', modifiers: ['control'] } });
    await until(() => evaluate<boolean>("document.activeElement.getAttribute('role') === 'combobox'"), Boolean);
    await input('Escape');
  });

  it('focuses the address bar when the toolbar creates a new tab', async () => {
    const before = await state();
    const count = before.spaces.find((space) => space.id === before.visible)?.tabs.length ?? 0;
    await evaluate("document.querySelector('[aria-label=\"New tab\"]').click()");
    await until(state, (current) => (current.spaces.find((space) => space.id === current.visible)?.tabs.length ?? 0) === count + 1);
    await until(() => evaluate<boolean>("document.activeElement.getAttribute('role') === 'combobox'"), Boolean);
    expect(await evaluate<string>("document.activeElement.getAttribute('aria-label')")).toBe('Address and search');
    const created = active(await state())?.id;
    if (!created) throw new Error('Expected a new tab');
    await command({ type: 'tab.close', tabId: created });
    await until(state, (current) => (current.spaces.find((space) => space.id === current.visible)?.tabs.length ?? 0) === count);
  });

  it.each(['light', 'dark'])('captures the %s toolbar and native suggestions for review', async (theme) => {
    await app.request('shellTheme', { theme });
    await until(() => evaluate<boolean>(`matchMedia('(prefers-color-scheme: ${theme})').matches`), Boolean);
    await typeQuery('Local saved');
    await until(() => evaluate<boolean>("Array.from(document.querySelectorAll('.suggestion-label')).some(e => e.textContent === 'Local saved destination')", true), Boolean);
    const directory = path.resolve('.userData/ui-review');
    mkdirSync(directory, { recursive: true });
    for (const overlay of [false, true]) {
      const png = await app.request<string>('shellCapture', { overlay });
      writeFileSync(path.join(directory, `toolbar-${theme}${overlay ? '-suggestions' : ''}.png`), Buffer.from(png, 'base64'));
    }
    await input('Escape');
  });
});
