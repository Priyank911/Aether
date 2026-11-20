import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type Rect = { x: number; y: number; width: number; height: number };
type Layout = { content: Rect; shell: Rect; page: Rect };

async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 12000;
  let value = await probe();
  while (Date.now() < deadline) {
    value = await probe();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Panel state did not settle: ${JSON.stringify(value)}`);
}

describe('Side panel in the native browser', () => {
  let app: DesktopApp;
  let fixtures: FixtureServers;
  const evaluate = <T>(expression: string, overlay = false) => app.request<T>('shellEval', { expression, overlay });
  const send = (command: object) => evaluate<{ ok: boolean; error?: string }>(`window.aether.send(${JSON.stringify(command)})`);
  const hasPanel = () => evaluate<boolean>("Boolean(document.querySelector('.side-panel'))");

  beforeAll(async () => {
    fixtures = await startFixtureServers(4195, 4196);
    const previousHold = process.env.AETHER_HOLD_RETURN_MS;
    process.env.AETHER_HOLD_RETURN_MS = '1500';
    try { app = await startDesktop({ keepHome: true }); }
    finally { if (previousHold === undefined) delete process.env.AETHER_HOLD_RETURN_MS; else process.env.AETHER_HOLD_RETURN_MS = previousHold; }
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"), Boolean);
  }, 60000);
  afterAll(async () => { await app?.close(); await fixtures?.close(); });

  it.each([640, 1280])('opens a real panel without covering the page at %i px', async (width) => {
    await app.request('shellLayout', { width, height: 760 });
    await evaluate("document.querySelector('[aria-label=\"Side panel\"]').click()");
    await until(hasPanel, Boolean);
    const layout = await app.request<Layout>('shellLayout');
    const panel = await until(() => evaluate<Rect>("(() => { const {x,y,width,height}=document.querySelector('.side-panel').getBoundingClientRect(); return {x,y,width,height}; })()"), (rect) => Math.abs(rect.x + rect.width - layout.content.width) <= 1);
    expect(panel.width).toBe(320);
    expect(Math.abs(panel.x - layout.page.width)).toBeLessThanOrEqual(1);
    expect(panel.y).toBe(76);
    expect(layout.shell.height).toBe(layout.content.height);
    expect(layout.page.width + panel.width).toBe(layout.content.width);
    await evaluate("document.querySelector('[aria-label=\"Close side panel\"]').click()");
    await until(hasPanel, (value) => !value);
    expect((await app.request<Layout>('shellLayout')).shell.height).toBe(76);
  });

  it('toggles with the shortcut from the native page and resizes by keyboard', async () => {
    await send({ type: 'panel.toggle', open: false });
    await until(hasPanel, (value) => !value);
    const state = await app.request<{ spaces: Array<{ id: string; activeTabId: string }> }>('state');
    const tabId = state.spaces.find((space) => space.id === 'personal')?.activeTabId;
    await app.request('shellInput', { tabId, event: { type: 'keyDown', keyCode: '\\', modifiers: ['control'] } });
    await until(hasPanel, Boolean);
    await evaluate("document.querySelector('.panel-resizer').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft',bubbles:true}))");
    await until(() => evaluate<number>("document.querySelector('.side-panel').getBoundingClientRect().width"), (width) => width === 340);
    await send({ type: 'panel.resize', width: 320 });
  });

  it('saves, lists, disables and deletes local preferences without starting an agent', async () => {
    await evaluate("document.getElementById('panel-tab-memory').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.memory-toggle input:not(:disabled)'))"), Boolean);
    expect((await send({ type: 'memory', command: { type: 'aether.memory', op: 'save_fact', key: 'currency', value: 'INR' } })).ok).toBe(true);
    await until(() => evaluate<string>("document.querySelector('.memory-panel').textContent"), (text) => text.includes('INR') && text.includes('Saved by you'));
    expect((await send({ type: 'memory', command: { type: 'aether.memory', op: 'save_fact', key: 'password', value: 'password: abcdef-secret' } })).ok).toBe(false);
    await evaluate("document.querySelector('.memory-toggle input').click()");
    await until(() => evaluate<boolean>("document.querySelector('.memory-toggle input').checked"), (checked) => !checked);
    expect((await send({ type: 'memory', command: { type: 'aether.memory', op: 'save_fact', key: 'ignored', value: 'no' } })).ok).toBe(false);
    await evaluate("document.querySelector('.memory-toggle input').click()");
    await until(() => evaluate<boolean>("document.querySelector('.memory-toggle input').checked"), Boolean);
    await evaluate("document.querySelector('[aria-label=\"Delete preference currency\"]').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('[aria-label=\"Delete preference currency\"]'))"), (value) => !value);
    expect((await app.request<{ spaces: unknown[] }>('state')).spaces).toHaveLength(1);
    await send({ type: 'panel.toggle', open: false });
    await until(hasPanel, (value) => !value);
  });

  it('does not open for a background decision, then renders full held URLs and Deny resolves the real call', async () => {
    const report = await app.request<ExecReport>('exec', { space: 'Panel approval', thought: 'Review new destinations', code: `await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/form.html`)}); try { await space.openTabs(['https://collector.example/?d=page-title', 'https://second.example/?q=page-title']); } catch (error) { return {code: (error as {code?:string}).code}; }` });
    expect(report.outcome.status).toBe('held');
    expect(await hasPanel()).toBe(false);
    expect((await app.request<{ visible: string }>('state')).visible).toBe('personal');
    await app.request('showSpace', { spaceId: 'panel-approval' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.decision-card'))"), Boolean);
    expect(await evaluate<string[]>("Array.from(document.querySelectorAll('.approval-urls code')).map(e=>e.textContent)")).toEqual(['https://collector.example/?d=page-title', 'https://second.example/?q=page-title']);
    expect(await evaluate<string[]>("Array.from(document.querySelectorAll('.decision-actions button')).map(e=>e.textContent)")).toEqual(['Open all', 'Deny']);
    expect(await evaluate<string>('document.activeElement.textContent')).toBe('Open all');
    await evaluate("Array.from(document.querySelectorAll('.decision-actions button')).find(e=>e.textContent==='Deny').click()");
    if (report.outcome.status !== 'held') throw new Error('Expected held script');
    const done = await app.request<ExecReport>('exec', { space: 'Panel approval', thought: 'Collect result', wait: report.outcome.token });
    expect(done.outcome.status).toBe('complete');
    if (done.outcome.status === 'complete') expect(JSON.parse(done.outcome.json ?? '{}')).toEqual({ code: 'denied' });
    await app.request('showSpace', { spaceId: 'personal' });
  }, 60000);

  it('Approve releases an irreversible fixture action through the decision card', async () => {
    const report = await app.request<ExecReport>('exec', { space: 'Panel danger', thought: 'Review irreversible action', code: `await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/injection.html`)}); const found = await space.find('Delete Account', 'button'); return await space.act([{op:'click',ref:found[0]!.ref}],{risk:'reversible',why:'Remove the old account'});` });
    expect(report.outcome.status).toBe('held');
    await app.request('showSpace', { spaceId: 'panel-danger' });
    await until(() => evaluate<string | null>("document.querySelector('.decision-actions .primary')?.textContent ?? null"), (text) => text === 'Approve');
    expect(await evaluate<string>("document.querySelector('.agent-claim strong').textContent")).toBe('Aether says');
    await evaluate("document.querySelector('.decision-actions .primary').click()");
    if (report.outcome.status !== 'held') throw new Error('Expected held script');
    let done = await app.request<ExecReport>('exec', { space: 'Panel danger', thought: 'Collect approved result', wait: report.outcome.token });
    for (let attempt = 0; done.outcome.status === 'held' && attempt < 15; attempt++) done = await app.request<ExecReport>('exec', { space: 'Panel danger', thought: 'Wait for approved action', wait: done.outcome.token });
    expect(done.outcome.status).toBe('complete');
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.decision-card'))"), (value) => !value);
    await app.request('showSpace', { spaceId: 'personal' });
  }, 60000);

  it('answers a held question using the keyboard-accessible choices', async () => {
    const report = await app.request<ExecReport>('exec', { space: 'Panel question', thought: 'Ask for a currency', code: `await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/form.html`)}); const answer = await space.ask('Which currency?', {options:['INR','USD']}); return {reply:answer.reply};` });
    expect(report.outcome.status).toBe('held');
    await app.request('showSpace', { spaceId: 'panel-question' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.decision-card input[type=radio]'))"), Boolean);
    expect(await evaluate<string>('document.activeElement.textContent')).toBe('Send answer');
    expect(await evaluate<string>("document.querySelector('.decision-actions .primary').getAttribute('aria-disabled')")).toBe('true');
    await evaluate("document.querySelector('.decision-card input[value=INR]').click()");
    await until(() => evaluate<boolean>("document.querySelector('.decision-actions .primary').getAttribute('aria-disabled') !== 'true'"), Boolean);
    await evaluate("document.querySelector('.decision-actions .primary').click()");
    if (report.outcome.status !== 'held') throw new Error('Expected held question');
    let done = await app.request<ExecReport>('exec', { space: 'Panel question', thought: 'Collect answer', wait: report.outcome.token });
    for (let attempt = 0; done.outcome.status === 'held' && attempt < 15; attempt++) done = await app.request<ExecReport>('exec', { space: 'Panel question', thought: 'Wait for answer', wait: done.outcome.token });
    expect(done.outcome.status).toBe('complete');
    if (done.outcome.status === 'complete') expect(JSON.parse(done.outcome.json ?? '{}')).toEqual({reply:'INR'});
    await app.request('showSpace', { spaceId: 'personal' });
  }, 60000);

  it('dismisses the Space menu from the side panel and the native viewport backdrop', async () => {
    await send({ type: 'panel.toggle', open: true });
    await until(hasPanel, Boolean);
    await send({ type: 'space.menu', open: true });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.space-menu'))", true), Boolean);
    await evaluate("document.querySelector('.panel-header').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.space-menu'))", true), (value) => !value);
    await send({ type: 'space.menu', open: true });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.space-menu'))", true), Boolean);
    await evaluate("document.querySelector('.space-menu-dismiss').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))", true);
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.space-menu'))", true), (value) => !value);
  });
});
