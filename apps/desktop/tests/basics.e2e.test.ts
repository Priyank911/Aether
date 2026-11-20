import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

type State = { visible: string; spaces: Array<{ id: string; activeTabId: string; tabs: Array<{id: string; url: string; pid?: number}> }> };
async function until<T>(probe: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  let value = await probe();
  while (Date.now() < deadline) { value = await probe(); if (ready(value)) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Browser basics did not settle: ${JSON.stringify(value)}`);
}

describe('Browser basics and internal pages', () => {
  let app: DesktopApp;
  let server: Server;
  let secure: Server;
  let base: string;
  let invalidTls: string;
  const evaluate = <T>(expression: string, overlay = false) => app.request<T>('shellEval', { expression, overlay });
  const send = (command: object) => evaluate<{ok: boolean}>(`window.aether.send(${JSON.stringify(command)})`);
  const page = <T>(tabId: string, expression: string) => app.request<T>('eval', { tabId, expression });
  const personal = async () => (await app.request<State>('state')).spaces.find((space) => space.id === 'personal')?.activeTabId ?? '';
  const input = async (selector: string, text: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`, true);
    for (const keyCode of text) await app.request('shellInput', { overlay: true, event: { type: 'char', keyCode } });
    await until(() => evaluate<string>(`document.querySelector(${JSON.stringify(selector)}).value`, true), (value) => value === text);
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const agent = request.url === '/agent-auth';
      if (agent || request.url === '/human-auth') {
        const expected = agent ? 'Basic YWxwaGE6YmV0YQ==' : 'Basic dXNlcjpwYXNz';
        if (request.headers.authorization !== expected) { response.writeHead(401, { 'WWW-Authenticate': `Basic realm="${agent ? 'Agent fixture' : 'Human fixture'}"` }); response.end('Authentication required'); return; }
        response.setHeader('Content-Type', 'text/html'); response.end('<title>Authenticated</title><h1>Signed in</h1>'); return;
      }
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Basics fixture</title><h1>Browser fixture</h1><input aria-label="Draft"><a id="external" href="mailto:fixture@example.test">Email</a>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    base = `http://127.0.0.1:${address.port}`;
    // Public fixture key, deliberately untrusted; it is never used outside this local test server.
    secure = createSecureServer({ key: readFileSync('tests/helpers/localhost-key.pem'), cert: readFileSync('tests/helpers/localhost-cert.pem') }, (_request, response) => response.end('<title>Untrusted TLS</title>'));
    await new Promise<void>((resolve) => secure.listen(0, '127.0.0.1', resolve));
    const secureAddress = secure.address();
    if (!secureAddress || typeof secureAddress === 'string') throw new Error('Missing TLS fixture address');
    invalidTls = `https://127.0.0.1:${secureAddress.port}/`;
    const previous = process.env.AETHER_HOLD_RETURN_MS;
    process.env.AETHER_HOLD_RETURN_MS = '1500';
    try { app = await startDesktop({keepHome:true}); }
    finally { if (previous === undefined) delete process.env.AETHER_HOLD_RETURN_MS; else process.env.AETHER_HOLD_RETURN_MS = previous; }
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.toolbar'))"), Boolean);
  }, 60000);
  afterAll(async () => { await app?.close(); await new Promise<void>((resolve) => server?.close(() => resolve())); await new Promise<void>((resolve) => secure?.close(() => resolve())); });

  it('renders the centered white pixel wordmark on a dark new tab with no privileged preload', async () => {
    const tabId = await personal();
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'New tab');
    expect(await page<string>(tabId, 'location.href')).toBe('aether://newtab/');
    expect(await page<string>(tabId, 'typeof window.aether')).toBe('undefined');
    expect(await page<string>(tabId, 'typeof require')).toBe('undefined');
    expect(await page<string>(tabId, 'getComputedStyle(document.body).backgroundColor')).toBe('rgb(17, 17, 17)');
    expect(await page<string>(tabId, 'getComputedStyle(document.querySelector("svg")).color')).toBe('rgb(255, 255, 255)');
    expect(await page<number>(tabId, 'document.scripts.length')).toBe(0);
    expect(await page<string>(tabId, 'document.querySelector("svg").getAttribute("shape-rendering")')).toBe('crispEdges');
    await until(() => evaluate<string>('document.activeElement.getAttribute("aria-label")'), (label) => label === 'Address and search');
  });

  it('shows real recent Spaces and switches using an internal link without a page bridge', async () => {
    await app.request('agentSpace', { name: 'Recent research' });
    await send({ type: 'nav.reload' });
    const tabId = await personal();
    await until(() => page<boolean>(tabId, 'Boolean(document.querySelector(".recent-spaces a"))'), Boolean);
    expect(await page<string>(tabId, 'document.querySelector(".recent-spaces").textContent')).toContain('Recent research');
    await page(tabId, 'document.querySelector(".recent-spaces a").click()');
    await until(() => app.request<State>('state'), (state) => state.visible === 'recent-research');
    await app.request('showSpace', { spaceId: 'personal' });
  });

  it('opens a custom error page, keeps the failed address and supports retry; a crashed tab gets a shell recovery surface', async () => {
    await send({ type: 'nav.go', input: 'http://127.0.0.1:1/' });
    const tabId = await personal();
    await until(() => page<string>(tabId, 'location.href'), (url) => url.startsWith('aether://error/'));
    expect((await app.request<State>('state')).spaces.find((space) => space.id === 'personal')?.tabs.find((tab) => tab.id === tabId)?.url).toBe('http://127.0.0.1:1/');
    expect(await page<string>(tabId, 'document.body.textContent')).toContain('Try again');
    await send({ type: 'nav.go', input: base });
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'Basics fixture');
    await app.request('crashTab', { tabId });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.tab-crashed'))"), Boolean);
    await evaluate("document.querySelector('.tab-crashed button').click()");
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.tab-crashed'))"), (value) => !value);
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'Basics fixture');
  });

  it('bookmarks a website, reserves a native bookmarks row and serves local History', async () => {
    await send({ type: 'bookmark.toggle' });
    await send({ type: 'bookmarks.toggle' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.bookmarks-bar button'))"), Boolean);
    expect(await evaluate<string>("document.querySelector('.bookmarks-bar').textContent")).toContain('Basics fixture');
    expect((await app.request<{page:{y:number}}>('shellLayout')).page.y).toBe(104);
    await send({ type: 'history.open' });
    const tabId = await personal();
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'History');
    expect(await page<string>(tabId, 'document.body.textContent')).toContain('Basics fixture');
    expect(await page<string>(tabId, 'typeof window.aether')).toBe('undefined');
    await send({ type: 'bookmarks.toggle' });
    await send({ type: 'nav.go', input: base });
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'Basics fixture');
  });

  it('moves the actual tab to an Agent Space, preserving its renderer, draft and back history', async () => {
    const tabId = await personal();
    await page(tabId, 'history.pushState({},"","/second");document.querySelector("input").value="Keep this draft"');
    const before = (await app.request<State>('state')).spaces.find((space) => space.id === 'personal')?.tabs.find((tab) => tab.id === tabId);
    expect((await send({ type: 'tab.sendToAgent', tabId })).ok).toBe(true);
    const after = await app.request<State>('state');
    expect(after.visible).toBe('personal');
    const moved = after.spaces.find((space) => space.id === 'from-personal')?.tabs.find((tab) => tab.id === tabId);
    expect(moved?.pid).toBe(before?.pid);
    expect(await page<string>(tabId, 'document.querySelector("input").value')).toBe('Keep this draft');
    await app.request('showSpace', { spaceId: 'from-personal' });
    await page(tabId, 'history.back()');
    await until(() => page<string>(tabId, 'location.pathname'), (path) => path === '/');
    await app.request('showSpace', { spaceId: 'personal' });
  });

  it('pauses agent HTTP authentication for a person, then keeps the entered credentials out of the tool result', async () => {
    const report = await app.request<ExecReport>('exec', { space: 'Auth task', thought: 'Open the protected fixture', code: `const result=await space.open(${JSON.stringify(`${base}/agent-auth`)});return result.title;` });
    expect(report.outcome.status).toBe('held');
    const pending = await until(() => app.request<{id:string;reason:string}|null>('pending', {spaceId:'auth-task'}), (value) => value?.reason === 'must_perform');
    expect(pending?.reason).toBe('must_perform');
    await app.request('showSpace', { spaceId: 'auth-task' });
    await send({ type: 'nav.reload' });
    await until(() => evaluate<boolean>("Boolean(document.querySelector('.browser-request input[type=password]'))", true), Boolean);
    await input('.browser-request input[autocomplete=username]', 'alpha');
    await input('.browser-request input[type=password]', 'beta');
    await evaluate("document.querySelector('.request-primary').click()", true);
    const state = await app.request<State>('state');
    const tabId = state.spaces.find((space) => space.id === 'auth-task')?.activeTabId;
    if (!tabId) throw new Error('Missing auth tab');
    await until(() => page<string>(tabId, 'document.title'), (title) => title === 'Authenticated');
    await until(() => evaluate<string>("document.querySelector('.decision-actions .primary')?.textContent ?? ''"), (text) => text === "I'm done");
    await evaluate("document.querySelector('.decision-actions .primary').click()");
    if (report.outcome.status !== 'held') throw new Error('Expected held authentication');
    let result = await app.request<ExecReport>('exec', {space:'Auth task',thought:'Collect signed-in page',wait:report.outcome.token});
    for (let attempt=0;result.outcome.status==='held'&&attempt<15;attempt++) result=await app.request<ExecReport>('exec',{space:'Auth task',thought:'Wait for sign-in',wait:result.outcome.token});
    expect(result.outcome.status).toBe('complete');
    expect(JSON.stringify(result)).not.toMatch(/alpha|beta|Authorization|Basic Y/);
    await app.request('showSpace',{spaceId:'personal'});
    await send({type:'panel.toggle',open:false});
  },60000);

  it('refuses invalid certificates for agents and shows a no-bypass interstitial to the person', async () => {
    let result = await app.request<ExecReport>('exec', { space: 'TLS check', thought: 'Check an untrusted connection', code: `try {await space.open(${JSON.stringify(invalidTls)}); return {unexpected:true};} catch(error) {return {code:(error as {code?:string}).code};}` });
    for(let attempt=0;result.outcome.status==='held'&&attempt<15;attempt++) result=await app.request<ExecReport>('exec',{space:'TLS check',thought:'Wait for certificate refusal',wait:result.outcome.token});
    expect(result.outcome.status).toBe('complete');
    if(result.outcome.status==='complete') expect(JSON.parse(result.outcome.json??'{}')).toEqual({code:'refused'});
    await send({type:'nav.go',input:invalidTls});
    const tabId=await personal();
    await until(()=>page<string>(tabId,'location.href'),(url)=>url.startsWith('aether://error/'));
    expect(await page<string>(tabId,'document.body.textContent')).toContain('This connection is not secure');
    expect(await page<string>(tabId,'document.body.textContent')).not.toMatch(/proceed anyway|ignore certificate/i);
  },60000);

  it('requires consent for a mail link and cancels a permission request without giving a page shell access', async () => {
    await send({type:'nav.go',input:base});
    const tabId=await personal();
    await until(()=>page<string>(tabId,'document.title'),(title)=>title==='Basics fixture');
    expect(await page<string>(tabId, 'new Promise(resolve=>{location.href="aether://history/";setTimeout(()=>resolve(location.protocol),200)})')).toBe('http:');
    await page(tabId,'document.querySelector("#external").click()');
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.browser-request'))",true),Boolean);
    expect(await evaluate<string>("document.querySelector('.browser-request').textContent",true)).toContain('mailto:fixture@example.test');
    await evaluate("document.querySelector('.request-actions button:last-child').click()",true);
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.browser-request'))",true),(value)=>!value);
    await page(tabId,'void navigator.geolocation.getCurrentPosition(()=>{},()=>{})');
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.browser-request'))",true),Boolean);
    expect(await evaluate<string>("document.querySelector('.browser-request').textContent",true)).toContain('Know your location');
    await evaluate("document.querySelector('.request-actions button:last-child').click()",true);
    await until(()=>evaluate<boolean>("Boolean(document.querySelector('.browser-request'))",true),(value)=>!value);
  },30000);
});
