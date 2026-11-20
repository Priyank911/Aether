import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type Rect = { x: number; y: number; width: number; height: number };
type Layout = { content: Rect; shell: Rect; page: Rect; overlay: Rect; overlayAttached: boolean };
type State = { spaces: Array<{ id: string; activeTabId: string }> };
async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  let value = await probe();
  while (Date.now() < deadline) {
    value = await probe();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Overlay did not settle: ${JSON.stringify(value)}`);
}

describe('Native overlay input and Find', () => {
  let app: DesktopApp;
  let server: Server;
  let url: string;
  let personal: string;
  const evaluate = <T>(expression: string, overlay = true) => app.request<T>('shellEval', { expression, overlay });
  const send = (command: object) => evaluate(`window.aether.send(${JSON.stringify(command)})`);
  const pageEval = <T>(tabId: string, expression: string) => app.request<T>('eval', { tabId, expression });

  beforeAll(async () => {
    server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Overlay fixture</title><button id="increment" style="margin:100px;width:120px;height:40px" onclick="window.count=(window.count||0)+1">Increment</button><input aria-label="Person text"><p>needle needle needle</p>'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    url = `http://127.0.0.1:${address.port}/`;
    const old = process.env.AETHER_HOLD_RETURN_MS;
    process.env.AETHER_HOLD_RETURN_MS = '1500';
    try { app = await startDesktop({ keepHome: true }); }
    finally { if (old === undefined) delete process.env.AETHER_HOLD_RETURN_MS; else process.env.AETHER_HOLD_RETURN_MS = old; }
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.toolbar'))", false), Boolean);
    personal = await app.request<string>('openTab', { spaceId: 'personal', url, activate: true });
    await until(() => pageEval<string>(personal, 'document.title'), (title) => title === 'Overlay fixture');
  }, 60000);
  afterAll(async () => { await app?.close(); await new Promise<void>((resolve) => server?.close(() => resolve())); });

  it('opens Find from page focus, counts and cycles matches, then detaches on Escape', async () => {
    await app.request('shellInput', { tabId: personal, event: { type: 'keyDown', keyCode: 'f', modifiers: ['control'] } });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.find-bar'))"), Boolean);
    expect(await evaluate<string>('document.activeElement.getAttribute("aria-label")')).toBe('Find in page');
    await send({ type: 'find.start', text: 'needle', forward: true });
    await until(() => evaluate<string>("document.querySelector('.find-bar output').textContent"), (value) => value.endsWith('/3'));
    const first = await evaluate<string>("document.querySelector('.find-bar output').textContent");
    await send({ type: 'find.start', text: 'needle', forward: true });
    await until(() => evaluate<string>("document.querySelector('.find-bar output').textContent"), (value) => value !== first && value.endsWith('/3'));
    const layout = await app.request<Layout>('shellLayout');
    expect(layout.overlay.height).toBe(64);
    expect(layout.overlay.width).toBeLessThan(layout.page.width);
    await app.request('shellInput', { overlay: true, event: { type: 'keyDown', keyCode: 'Escape' } });
    await until(() => app.request<Layout>('shellLayout'), (value) => !value.overlayAttached);
  });

  it('blocks native clicks and typing while CDP actions still reach the page; Escape takes over', async () => {
    const running = app.request<ExecReport>('exec', { space: 'Shield work', thought: 'Exercise shield', code: `await space.open(${JSON.stringify(url)}); const match=await space.find('Increment','button'); await space.act([{op:'click',ref:match[0]!.ref}],{risk:'reversible',why:'Increment fixture'}); for (;;) await space.skim();` });
    const state = await until(() => app.request<State>('state'), (value) => value.spaces.some((space) => space.id === 'shield-work' && Boolean(space.activeTabId)));
    const tabId = state.spaces.find((space) => space.id === 'shield-work')?.activeTabId;
    if (!tabId) throw new Error('Shield fixture tab is missing');
    await app.request('showSpace', { spaceId: 'shield-work' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.input-shield'))"), Boolean);
    await until(() => pageEval<number>(tabId, 'window.count || 0'), (value) => value === 1);
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.ghost-target'))"), Boolean);
    const point = await pageEval<{ x: number; y: number }>(tabId, '(() => { const r=document.querySelector("#increment").getBoundingClientRect(); return {x:Math.round(r.x+r.width/2)+2,y:Math.round(r.y+r.height/2)+2}; })()');
    for (const type of ['mouseDown', 'mouseUp']) await app.request('shellInput', { overlay: true, event: { type, ...point, button: 'left', clickCount: 1 } });
    await app.request('shellInput', { overlay: true, event: { type: 'char', keyCode: 'x' } });
    expect(await pageEval<number>(tabId, 'window.count')).toBe(1);
    expect(await pageEval<string>(tabId, 'document.querySelector("input").value')).toBe('');
    const acting = await app.request<Layout>('shellLayout');
    expect(acting.overlayAttached).toBe(true);
    expect(acting.page.x).toBe(2);
    expect(acting.page.y).toBe(110);
    await app.request('shellInput', { overlay: true, event: { type: 'keyDown', keyCode: 'Escape' } });
    await until(() => app.request<{ reason: string } | null>('pending', { spaceId: 'shield-work' }), (value) => value?.reason === 'user_interrupted');
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.input-shield'))"), (value) => !value);
    await until(() => evaluate<string>("document.querySelector('.viewport-frame')?.className ?? ''", false), (value) => value.includes('waiting'));
    expect((await app.request<Layout>('shellLayout')).overlayAttached).toBe(false);
    await app.request('runControl', { spaceId: 'shield-work', kind: 'stop' });
    await running;
    await app.request('showSpace', { spaceId: 'personal' });
    await send({ type: 'panel.toggle', open: false });
  }, 60000);

  it('does not shield Personal for a background acting Space and clears the frame on done', async () => {
    await app.request('setRunFrame', { spaceId: 'shield-work', frame: { type: 'aether.state', state: 'acting', step: 1, label: 'Background work', timestamp: Date.now() } });
    await until(() => app.request<Layout>('shellLayout'), (value) => !value.overlayAttached);
    expect(await evaluate<boolean>("Boolean(document.querySelector('.input-shield'))")).toBe(false);
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.viewport-frame'))", false), (value) => !value);
    await app.request('setRunFrame', { spaceId: 'shield-work', frame: { type: 'aether.state', state: 'done', step: 1, label: 'Done', timestamp: Date.now() - 5000 } });
    await app.request('showSpace', { spaceId: 'shield-work' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.viewport-frame'))", false), (value) => !value);
    expect((await app.request<Layout>('shellLayout')).page.x).toBe(0);
    await app.request('showSpace', { spaceId: 'personal' });
  });

  it('shows actionable errors as a dismissible small native toast', async () => {
    await send({ type: 'nav.go', input: 'javascript:alert(1)' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.overlay-toast'))"), Boolean);
    const layout = await app.request<Layout>('shellLayout');
    expect(layout.overlay.height).toBe(72);
    expect(layout.overlay.y).toBe(layout.content.height - 72);
    await evaluate("document.querySelector('[aria-label=\"Dismiss notification\"]').click()");
    await until(() => app.request<Layout>('shellLayout'), (value) => !value.overlayAttached);
  });
});
