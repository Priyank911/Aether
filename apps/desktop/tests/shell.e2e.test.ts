import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type Rect = { x: number; y: number; width: number; height: number };
interface Layout {
  content: Rect;
  shell: Rect;
  page: Rect;
  menuVisible: boolean;
  overlayAttached: boolean;
}
interface Geometry {
  toolbar: Rect;
  strip: Rect;
  agentbar: Rect | null;
  viewportHeight: number;
  documentWidth: number;
  viewportWidth: number;
}

const geometry = `(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  return {
    strip: rect('.strip'), toolbar: rect('.toolbar'), agentbar: rect('.agentbar'),
    viewportHeight: innerHeight, viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  };
})()`;

async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  let value = await probe();
  while (Date.now() < deadline) {
    value = await probe();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The shell did not reach the expected rendered state within 10 seconds: ${JSON.stringify(value)}`);
}

describe('Built React shell in Electron', () => {
  let app: DesktopApp;
  const evaluate = <T>(expression: string, overlay = false) => app.request<T>('shellEval', { expression, overlay });
  const measure = () => evaluate<Geometry>(geometry);

  beforeAll(async () => {
    app = await startDesktop();
    await until(() => evaluate<boolean>("Boolean(document.querySelector('#root .toolbar'))"), Boolean);
  }, 60000);

  afterAll(async () => { await app?.close(); });

  it('loads React and its local CSS rather than silently using the legacy shell', async () => {
    expect(await evaluate<string>('location.pathname')).toMatch(/\/renderer-dist\/index\.html$/);
    expect(await evaluate<string>("getComputedStyle(document.querySelector('.toolbar')).display")).toBe('flex');
    expect(await evaluate<string>("getComputedStyle(document.querySelector('.strip')).webkitAppRegion")).toBe('drag');
    expect(await evaluate<string>("getComputedStyle(document.querySelector('.strip button')).webkitAppRegion")).toBe('no-drag');
    expect(await evaluate<string>("document.querySelector('input').placeholder")).toContain('Google');
  });

  it('mounts the overlay with transparent CSS and leaves it detached when idle', async () => {
    await until(() => evaluate<boolean>("Boolean(document.querySelector('#root .ovl'))", true), Boolean);
    expect(await evaluate<string>('location.pathname', true)).toMatch(/\/renderer-dist\/overlay\.html$/);
    expect(await evaluate<string>('getComputedStyle(document.body).backgroundColor', true)).toBe('rgba(0, 0, 0, 0)');
    expect((await app.request<Layout>('shellLayout')).overlayAttached).toBe(false);
  });

  it.each([640, 1280])('keeps the entire toolbar above the native page at %i px wide', async (width) => {
    await app.request('shellLayout', { width, height: 700 });
    const layout = await app.request<Layout>('shellLayout');
    // Windows rounds DIP sizes at fractional display scaling and includes hidden-frame insets.
    const dom = await until(measure, (value) => Math.abs(value.viewportWidth - layout.content.width) <= 1);
    expect(dom.strip.height).toBe(36);
    expect(dom.toolbar.y).toBe(36);
    expect(dom.toolbar.height).toBe(40);
    expect(dom.toolbar.y + dom.toolbar.height).toBe(dom.viewportHeight);
    expect(Math.abs(layout.shell.width - dom.viewportWidth)).toBeLessThanOrEqual(1);
    expect(layout.page.y).toBe(layout.shell.height);
    expect(layout.page.y).toBe(76);
    expect(dom.documentWidth).toBeLessThanOrEqual(dom.viewportWidth);
    if (process.platform !== 'darwin') expect(layout.menuVisible).toBe(false);
  });

  it('shows elapsed work, routes waiting decisions to Review and releases the done row after four seconds', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Agent bar states' });
    await app.request('openTab', { spaceId: id, url: 'about:blank', activate: true });
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'acting', step: 1, label: 'Comparing results', timestamp: Date.now() - 42000 } });
    await app.request('showSpace', { spaceId: id });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.agmeta[aria-label^=Elapsed]'))"), Boolean);
    expect(await evaluate<string>("document.querySelector('.aglabel').textContent")).toBe('Comparing results');
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'waiting_human', step: 1, label: 'Review', pending: { id: 'bar-question', reason: 'question', prompt: 'Choose a destination', createdAt: Date.now() }, timestamp: Date.now() } });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.agentbar.waiting'))"), Boolean);
    expect(await evaluate<string[]>("Array.from(document.querySelectorAll('.agactions button')).map(e => e.textContent)")).toEqual(['Review', 'Stop task']);
    await evaluate("window.aether.send({type:'panel.toggle', open:false})");
    await app.request('setRunFrame', { spaceId: id, frame: { type: 'aether.state', state: 'done', step: 1, label: 'Compared results', timestamp: Date.now() } });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.agentbar.done'))"), Boolean);
    await until(measure, (value) => value.agentbar === null && value.viewportHeight === 76);
    await app.request('showSpace', { spaceId: 'personal' });
  });

  it('reserves the Agent bar row without clipping it and releases the row on return to Personal', async () => {
    const { id } = await app.request<{ id: string }>('agentSpace', { name: 'Shell geometry' });
    await app.request('openTab', { spaceId: id, url: 'about:blank', activate: true });
    await app.request('setRunFrame', {
      spaceId: id,
      frame: { type: 'aether.state', state: 'acting', step: 1, label: 'Checking shell layout', timestamp: Date.now() },
    });
    await app.request('showSpace', { spaceId: id });
    const agent = await until(measure, (value) => value.agentbar !== null && value.viewportHeight > 108);
    expect(agent.strip.height).toBe(36);
    expect(agent.toolbar.height).toBe(40);
    expect(agent.agentbar?.y).toBe(76);
    expect(agent.agentbar?.height).toBe(32);
    const agentLayout = await app.request<Layout>('shellLayout');
    expect(agent.viewportHeight).toBe(agentLayout.content.height);
    expect(agentLayout.page.y).toBe(110);

    await app.request('showSpace', { spaceId: 'personal' });
    const personal = await until(measure, (value) => value.agentbar === null && value.viewportHeight === 76);
    expect(personal.toolbar.y + personal.toolbar.height).toBe(76);
    expect((await app.request<Layout>('shellLayout')).page.y).toBe(76);
  });
});
