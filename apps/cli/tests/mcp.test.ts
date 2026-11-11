import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { createAetherMcpServer, MCPBrowserSession } from '../src/mcp/index.js';
import { call, refIn, tokens } from './helpers.js';

describe('MCP tool surface over Direct CDP', () => {
  let fixtures: FixtureServers;
  let browser: MCPBrowserSession;
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4105, 4106);
    browser = await MCPBrowserSession.launch({ headless: true });
    server = createAetherMcpServer(browser);
    client = new Client({ name: 'aether-mcp-test-client', version: '1.0.0' });
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

  it('lists exactly the eight tools within the 900 token definition budget', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['act', 'ask', 'done', 'find', 'look', 'memory', 'open', 'screenshot']);
    // What a host can pass to the model: name, description and input schema. The MCP execution field is protocol metadata.
    const definitionTokens = tokens(JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))));
    console.log(`tool definitions: ${definitionTokens} tokens`);
    expect(definitionTokens).toBeLessThanOrEqual(900);
  });

  it('wraps page text with a per-call nonce and the page origin', async () => {
    const first = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    const second = await call(client, 'look');
    const nonce = (text: string) => /<page untrusted nonce=([0-9a-f]{12}) origin=http:\/\/localhost:4105>/.exec(text)?.[1];
    expect(nonce(first.text)).toBeDefined();
    expect(nonce(second.text)).toBeDefined();
    expect(nonce(first.text)).not.toBe(nonce(second.text));
    expect(first.text.trimEnd().endsWith(`</page untrusted nonce=${nonce(first.text)}>`)).toBe(true);
  });

  it('look reads a region, the text view, and pages; find returns refs', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/long-list.html` });
    const list = /\[(e\d+)\] list/.exec(page.text)?.[1] ?? '';
    const region = await call(client, 'look', { ref: list });
    const after = /after=(e\d+)\n?<\/page/.exec(region.text)?.[1] ?? /after=(e\d+)/.exec(region.text)?.[1];
    expect(after).toBeDefined();
    const next = await call(client, 'look', { ref: list, after });
    expect(next.text).toContain(`continued after ${after}`);
    const text = await call(client, 'look', { as: 'text' });
    expect(text.text).toContain('# Large Catalog Feed');
    const found = await call(client, 'find', { query: 'number 77', role: 'link' });
    expect(found.text).toMatch(/\[e\d+\] link "Row item number 77 in catalog"/);
  });

  it('holds the page while a JavaScript dialog is open and answers it with op=dialog', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/dialog.html` });
    const discard = refIn(page.text, 'button', 'Discard draft');
    const clicked = await call(client, 'act', { actions: [{ op: 'click', ref: discard }], risk: 'reversible', why: 'Discard' });
    expect(clicked.text).toContain('dialog confirm "Discard the draft?" is open');
    const blocked = await call(client, 'look');
    expect(blocked.text).toContain('dialog confirm "Discard the draft?" is open');
    const answered = await call(client, 'act', { actions: [{ op: 'dialog', value: 'accept' }], risk: 'reversible', why: 'Confirm discard' });
    expect(answered.isError).toBe(false);
    expect(answered.text).toContain('Draft discarded');
  }, 30000);

  it('follows a tab opened by a click and makes it the agent tab', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/dialog.html` });
    const link = refIn(page.text, 'link', 'Open the form in a new tab');
    const clicked = await call(client, 'act', { actions: [{ op: 'click', ref: link }], risk: 'read', why: 'Open the form' });
    expect(clicked.text).toContain('new tab opened by this step is now the agent tab');
    expect(clicked.text).toMatch(/textbox "Full Name:"/);
    const look = await call(client, 'look');
    expect(look.text).toContain('Aether Form Fixture');
  }, 30000);

  it('refuses to click a control covered by an overlay and names the cover', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/covered.html` });
    const deal = refIn(page.text, 'button', 'View deal one');
    const clicked = await call(client, 'act', { actions: [{ op: 'click', ref: deal }], risk: 'read', why: 'View the deal' });
    expect(clicked.isError).toBe(true);
    expect(clicked.text).toContain(`click [${deal}] not done: covered by`);
    expect(clicked.text).toMatch(/step \d+ failed 0\/1/);
    const accept = refIn(page.text, 'button', 'Accept all');
    const dismissed = await call(client, 'act', { actions: [{ op: 'click', ref: accept }], risk: 'reversible', why: 'Close the banner' });
    expect(dismissed.isError).toBe(false);
  }, 30000);

  it('stops a batch at a navigation and reports the actions not run', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/long-page.html` });
    const search = refIn(page.text, 'searchbox', 'Search stories');
    const story = refIn(page.text, 'link', 'Read story 1');
    const acted = await call(client, 'act', {
      actions: [
        { op: 'fill', ref: search, value: 'harbor' },
        { op: 'key', ref: search, value: 'Enter' },
        { op: 'click', ref: story },
      ],
      risk: 'read',
      why: 'Search the stories',
    });
    expect(acted.text).toMatch(/step \d+ ok 2\/3 \| url -> http:\/\/localhost:4105\/long-page\.html\?/);
    expect(acted.text).toContain('stopped by navigation, 1 not run');
  }, 30000);

  it('reports a stale ref without doing anything', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    const acted = await call(client, 'act', { actions: [{ op: 'click', ref: 'e99999' }], risk: 'read', why: 'Old ref' });
    expect(acted.isError).toBe(true);
    expect(acted.text).toContain('stale [e99999]: no longer on the page, nothing was done.');
  });

  it('refuses navigation outside http and https', async () => {
    const refused = await call(client, 'open', { url: 'file:///etc/passwd' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('refuse');
  });

  it('returns a screenshot image and reports empty memory', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    expect((await call(client, 'screenshot')).hasImage).toBe(true);
    expect((await call(client, 'memory', { op: 'recall' })).text).toBe('nothing stored for localhost:4105.');
    const done = await call(client, 'done', { result: 'ok', evidence: 'seen', success: true });
    expect(done.text).toContain('run ended (success)');
  });
});
