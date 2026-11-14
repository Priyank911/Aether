import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import type { HumanReply, Pending } from '@aether/shared';
import { createAetherMcpServer, MCPBrowserSession } from '../src/mcp/index.js';
import { call, refIn } from './helpers.js';

/**
 * Step 3: every run-state transition, driven by a fake human channel that
 * replies the way the side panel will.
 */
describe('Run state, holds and approvals', () => {
  let fixtures: FixtureServers;
  let browser: MCPBrowserSession;
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4121, 4122);
    browser = await MCPBrowserSession.launch({ headless: true });
    browser.run.holdTimeoutMs = 3000;
    server = createAetherMcpServer(browser);
    client = new Client({ name: 'aether-run-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }, 30000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await browser?.close();
    await fixtures?.close();
  });

  /** Resolve with the next pending request, as the side panel would see it. */
  function nextPending(): Promise<Pending> {
    return new Promise((resolve) => {
      const stop = browser.run.onFrame((frame) => {
        if (frame.pending) {
          queueMicrotask(() => stop());
          resolve(frame.pending);
        }
      });
    });
  }

  function reply(id: string, kind: HumanReply['kind'], text?: string): boolean {
    return browser.run.receive({ type: 'aether.reply', id, kind, text });
  }

  async function finish(): Promise<void> {
    await call(client, 'done', { result: 'test', evidence: 'test', success: true });
  }

  it('holds an irreversible click for approval, shows the card, and runs it once approved', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/injection.html` });
    const remove = refIn(page.text, 'button', 'Delete Account');
    const pending = nextPending();
    const acted = call(client, 'act', { actions: [{ op: 'click', ref: remove }], risk: 'reversible', why: 'Remove the old account' });
    const request = await pending;
    expect(request.reason).toBe('approval');
    expect(browser.run.state).toBe('waiting_human');
    expect(request.approval?.site).toBe('http://localhost:4121');
    expect(request.approval?.element).toContain('button "Delete Account"');
    expect(request.approval?.agentReason).toBe('Remove the old account');
    expect(request.approval?.values).toContainEqual({ label: 'Master Password:', value: '(empty)' });
    expect(reply(request.id, 'approve')).toBe(true);
    const result = await acted;
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/step \d+ ok 1\/1/);
    await finish();
  }, 30000);

  it('returns a denial without acting', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/injection.html` });
    const transfer = refIn(page.text, 'button', 'Transfer Funds');
    const pending = nextPending();
    const acted = call(client, 'act', { actions: [{ op: 'click', ref: transfer }], risk: 'reversible', why: 'Move money' });
    reply((await pending).id, 'deny', 'not today');
    const result = await acted;
    expect(result.isError).toBe(true);
    expect(result.text).toContain('the person denied this step: not today; nothing was done.');
    await finish();
  }, 30000);

  it('hands a password field to the person and resumes with fresh refs', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/injection.html` });
    const password = refIn(page.text, 'textbox', 'Master Password');
    const pending = nextPending();
    const acted = call(client, 'act', { actions: [{ op: 'fill', ref: password, value: 'hunter2' }], risk: 'reversible', why: 'Log in' });
    const request = await pending;
    expect(request.reason).toBe('must_perform');
    expect(request.prompt).toContain('which the person must type');
    reply(request.id, 'done');
    const result = await acted;
    expect(result.text.split('\n')[0]).toBe('the person did it');
    expect(result.text).toContain('textbox "Master Password:"');
    expect(result.text).not.toContain(`[${password}] textbox`);
    await finish();
  }, 30000);

  it('asks a question with options and returns the answer outside the wrapper', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    const pending = nextPending();
    const asked = call(client, 'ask', { question: 'Which seat?', options: ['Aisle', 'Window'] });
    const request = await pending;
    expect(request).toMatchObject({ reason: 'question', prompt: 'Which seat?', options: ['Aisle', 'Window'] });
    expect(reply(request.id, 'approve')).toBe(false);
    expect(reply(request.id, 'answer', 'Aisle')).toBe(true);
    const result = await asked;
    expect(result.text.split('\n')[0]).toBe('answered: Aisle');
    expect(result.text.indexOf('answered: Aisle')).toBeLessThan(result.text.indexOf('<page untrusted'));
    await finish();
  }, 30000);

  it('returns a pending handoff on timeout, blocks other tools, and continues when the reply comes', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    const first = await call(client, 'ask', { question: 'Confirm the dates?' });
    const id = /pending handoff=([0-9a-f]{8})/.exec(first.text)?.[1] ?? '';
    expect(id).not.toBe('');
    const blocked = await call(client, 'look');
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain(`call ask with handoff=${id}`);
    const resumed = call(client, 'ask', { question: 'ignored', handoff: id });
    setTimeout(() => reply(id, 'answer', 'Yes'), 200);
    expect((await resumed).text.split('\n')[0]).toBe('answered: Yes');
    await finish();
  }, 30000);

  it('hands the tab to the person on Take over and returns when they press Resume', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    browser.run.control({ type: 'aether.control', kind: 'takeover' });
    const pending = nextPending();
    const looked = call(client, 'look');
    const request = await pending;
    expect(request.reason).toBe('user_interrupted');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(browser.run.state).toBe('waiting_human');
    reply(request.id, 'resume');
    const result = await looked;
    expect(result.text.split('\n')[0]).toBe('the person had control of the tab; your last call was not run. The page now:');
    expect(result.text).toContain('textbox "Full Name:"');
    await finish();
  }, 30000);

  it('stops the run on Stop and tells the agent to call done', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    browser.run.control({ type: 'aether.control', kind: 'stop' });
    const result = await call(client, 'look');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('the person stopped this run');
    expect(browser.run.state).toBe('idle');
  }, 30000);

  it('asks before opening a model-built URL that carries data to a new origin', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html?first=allowed` });
    const pending = nextPending();
    const opened = call(client, 'open', { url: `${fixtures.crossOriginBaseUrl}/collect?d=secret-from-page` });
    const request = await pending;
    expect(request.reason).toBe('approval');
    expect(request.prompt).toContain('is new to this run and the URL carries data');
    reply(request.id, 'deny');
    const result = await opened;
    expect(result.text).toContain('the person denied opening this URL');
    const sameOrigin = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/table.html?sort=price` });
    expect(sameOrigin.isError).toBe(false);
    await finish();
  }, 30000);
});
