import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import type { Pending } from '@aether/shared';
import { createAetherMcpServer, MCPBrowserSession } from '../src/mcp/index.js';
import { call, refIn } from './helpers.js';

describe('Step 6 memory through the tools', () => {
  let fixtures: FixtureServers;
  let browser: MCPBrowserSession;
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4141, 4142);
    browser = await MCPBrowserSession.launch({ headless: true });
    browser.run.holdTimeoutMs = 5000;
    server = createAetherMcpServer(browser);
    client = new Client({ name: 'aether-memory-test', version: '1.0.0' });
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

  it('records the route of a successful run and offers it on the next visit, without typed values', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    expect(page.text).not.toContain('memory:');
    await call(client, 'act', {
      actions: [
        { op: 'fill', ref: refIn(page.text, 'textbox', 'Full Name'), value: 'Ada Lovelace' },
        { op: 'fill', ref: refIn(page.text, 'combobox', 'Country'), value: 'India' },
      ],
      risk: 'reversible',
      why: 'Fill the registration form',
    });
    const ended = await call(client, 'done', { result: 'filled', evidence: 'values read back', success: true });
    expect(ended.text).toMatch(/run ended \(success\) after \d+ tool calls and \d+ result tokens/);

    const again = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    expect(again.text).toContain('memory: 1 known route for localhost:4141; call memory op=recall site=localhost:4141');
    const recall = await call(client, 'memory', { op: 'recall', site: 'localhost:4141' });
    expect(recall.text).toContain('route for "Fill the registration form" (worked 1x):');
    expect(recall.text).toContain('fill textbox "Full Name:"');
    expect(recall.text).toContain('fill combobox "Country:"');
    expect(recall.text).not.toContain('Ada Lovelace');
    expect(recall.text).toMatch(/<page untrusted nonce=[0-9a-f]+ origin=https:\/\/localhost:4141>/);
    await call(client, 'done', { result: 'checked', evidence: 'recall', success: false });
  }, 60000);

  it('saves a site note at once and a profile fact only after approval', async () => {
    const note = await call(client, 'memory', { op: 'save', site: 'localhost:4141', value: 'the country list is a native select' });
    expect(note.text).toBe('saved a note for localhost:4141.');

    const pending = nextPending();
    const saving = call(client, 'memory', { op: 'save', key: 'seat', value: 'aisle' });
    const request = await pending;
    expect(request.reason).toBe('approval');
    expect(request.prompt).toBe('Save to your profile: seat = aisle?');
    browser.run.receive({ type: 'aether.reply', id: request.id, kind: 'approve' });
    expect((await saving).text).toBe('saved to the profile: seat.');

    const recalled = await call(client, 'memory', { op: 'recall', key: 'seat' });
    expect(recalled.text).toContain('saved: seat = aisle');
  }, 30000);

  it('refuses to store secrets and never asks the person to approve one', async () => {
    const refused = await call(client, 'memory', { op: 'save', key: 'bank password', value: 'hunter2' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('never keeps');
    expect(browser.run.waiting).toBeUndefined();
  });

  it('applies the person’s edits from the side panel and honours the off switch', async () => {
    let listing = browser.memoryCommand({ type: 'aether.memory', op: 'save_fact', key: 'meal', value: 'vegetarian' });
    expect(listing.facts).toContainEqual({ key: 'meal', value: 'vegetarian', source: 'user' });
    expect(listing.procedures.map((procedure) => procedure.goal)).toContain('Fill the registration form');

    listing = browser.memoryCommand({ type: 'aether.memory', op: 'set_enabled', enabled: false });
    expect(listing.enabled).toBe(false);
    expect((await call(client, 'memory', { op: 'recall' })).text).toBe('memory is off; nothing was stored or recalled.');
    browser.memoryCommand({ type: 'aether.memory', op: 'set_enabled', enabled: true });

    listing = browser.memoryCommand({ type: 'aether.memory', op: 'save_fact', key: 'card', value: '4111 1111 1111 1111' });
    expect(listing.error).toContain('never keeps');
  });
});
