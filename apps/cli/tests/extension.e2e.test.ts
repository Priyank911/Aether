import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { createAetherMcpServer } from '../src/mcp/server.js';
import { call, refIn } from './helpers.js';
import { startExtensionHarness, waitFor, type ExtensionHarness } from './extension-harness.js';

/**
 * Steps 4 and 5 end to end: the engine reaches Chrome only through the real
 * extension, the overlay and tab group follow the run state, and the real side
 * panel answers, takes over and resumes.
 */
describe('Extension transport and UI end to end', () => {
  let fixtures: FixtureServers;
  let harness: ExtensionHarness;
  let server: McpServer;
  let client: Client;
  let panelUrl: string;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4131, 4132);
    harness = await startExtensionHarness();
    harness.session.run.holdTimeoutMs = 15000;
    server = createAetherMcpServer(harness.session);
    client = new Client({ name: 'aether-e2e', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    panelUrl = `chrome-extension://${harness.extensionId}/sidepanel.html`;
  }, 60000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await harness?.close();
    await fixtures?.close();
  });

  const overlayState = (): Promise<unknown> =>
    harness.evaluateIn(fixtures.mainBaseUrl, "document.querySelector('aether-overlay')?.dataset.state ?? 'none'");

  const inPanel = (expression: string): Promise<unknown> => harness.evaluateIn(panelUrl, expression);

  it('opens a page in the Aether tab group through the extension and acts on it', async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    expect(page.isError).toBe(false);
    expect(page.text).toMatch(/\[e\d+\] textbox "Full Name:"/);

    const groups = await harness.serviceWorker.send<{ result: { value: string[] } }>('Runtime.evaluate', {
      expression: "chrome.tabGroups.query({}).then((groups) => groups.map((group) => group.title + ':' + group.color))",
      awaitPromise: true,
      returnByValue: true,
    });
    expect(groups.result.value).toEqual(['Aether:blue']);

    const name = refIn(page.text, 'textbox', 'Full Name');
    const acted = await call(client, 'act', { actions: [{ op: 'fill', ref: name, value: 'Grace Hopper' }], risk: 'reversible', why: 'Fill the name' });
    expect(acted.text).toContain(`~ [${name}] textbox "Full Name:" value="Grace Hopper"`);
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('username').value")).toBe('Grace Hopper');
  }, 60000);

  it('shows the blue edge while acting and steps aside for a screenshot', async () => {
    expect(await waitFor(async () => ((await overlayState()) === 'acting' ? true : undefined), 5000, 'the acting overlay')).toBe(true);
    const shot = await call(client, 'screenshot');
    expect(shot.hasImage).toBe(true);
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.querySelector('aether-overlay').style.visibility")).toBe('hidden');
  }, 30000);

  it("blocks the person's clicks and keys while the agent works, but not the agent's own", async () => {
    const page = await call(client, 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    expect(await waitFor(async () => ((await overlayState()) === 'acting' ? true : undefined), 5000, 'the acting overlay')).toBe(true);
    const person = await harness.pageSession(fixtures.mainBaseUrl);
    const centre = (await harness.evaluateIn(
      fixtures.mainBaseUrl,
      "(() => { const r = document.getElementById('newsletter').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()",
    )) as { x: number; y: number };
    const personClick = async (): Promise<void> => {
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
        await person.send('Input.dispatchMouseEvent', { type, x: centre.x, y: centre.y, button: 'left', clickCount: 1 });
      }
    };
    await new Promise((resolve) => setTimeout(resolve, 2700));
    await personClick();
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('newsletter').checked")).toBe(false);

    await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('email').focus()");
    await person.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', text: 'x', windowsVirtualKeyCode: 88 });
    await person.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 });
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('email').value")).toBe('');

    const box = refIn(page.text, 'checkbox', 'Subscribe');
    const acted = await call(client, 'act', { actions: [{ op: 'click', ref: box }], risk: 'reversible', why: 'Tick the box' });
    expect(acted.isError).toBe(false);
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('newsletter').checked")).toBe(true);
  }, 40000);

  it('answers a question from the real side panel and turns the edge amber while waiting', async () => {
    await harness.inspector.sendCommand('Target.createTarget', { url: panelUrl, background: true });
    const asked = call(client, 'ask', { question: 'Which seat do you prefer?', options: ['Aisle', 'Window'] });
    expect(await waitFor(async () => ((await overlayState()) === 'waiting' ? true : undefined), 5000, 'the waiting overlay')).toBe(true);
    await waitFor(async () => ((await inPanel("document.querySelector('.choice') ? 'ready' : ''")) ? true : undefined), 8000, 'the question card');
    expect(await inPanel("document.querySelector('.card-prompt').textContent")).toBe('Which seat do you prefer?');
    await inPanel("[...document.querySelectorAll('.choice')].find((button) => button.textContent === 'Aisle').click()");
    const answer = await asked;
    expect(answer.text.split('\n')[0]).toBe('answered: Aisle');
  }, 40000);

  it('hands control to the person from the panel and takes it back on Resume', async () => {
    await waitFor(async () => ((await inPanel("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Take over') ? 'yes' : ''")) ? true : undefined), 8000, 'the Take over button');
    await inPanel("[...document.querySelectorAll('button')].find((button) => button.textContent === 'Take over').click()");
    // Take over acts at once: the page turns amber and unlocks with no agent call in flight.
    expect(await waitFor(async () => ((await overlayState()) === 'waiting' ? true : undefined), 3000, 'the page to hand over')).toBe(true);
    const looked = call(client, 'look');
    await waitFor(async () => ((await inPanel("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Resume') ? 'yes' : ''")) ? true : undefined), 8000, 'the Resume button');

    // With control handed over, the person's own clicks reach the page again.
    const person = await harness.pageSession(fixtures.mainBaseUrl);
    const before = await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('newsletter').checked");
    const centre = (await harness.evaluateIn(
      fixtures.mainBaseUrl,
      "(() => { const r = document.getElementById('newsletter').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()",
    )) as { x: number; y: number };
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await person.send('Input.dispatchMouseEvent', { type, x: centre.x, y: centre.y, button: 'left', clickCount: 1 });
    }
    expect(await harness.evaluateIn(fixtures.mainBaseUrl, "document.getElementById('newsletter').checked")).toBe(!before);

    await inPanel("[...document.querySelectorAll('button')].find((button) => button.textContent === 'Resume').click()");
    const result = await looked;
    expect(result.text.split('\n')[0]).toBe('the person had control of the tab; your last call was not run. The page now:');
  }, 40000);

  it('removes the overlay when the run ends', async () => {
    await call(client, 'done', { result: 'ok', evidence: 'e2e', success: true });
    expect(await waitFor(async () => ((await overlayState()) === 'none' ? true : undefined), 5000, 'the overlay to go')).toBe(true);
  }, 20000);
});
