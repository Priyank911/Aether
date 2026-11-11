import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { call, refIn, tokens } from './helpers.js';

/**
 * Step 2 exit gate: the four fixture tasks of docs/METRICS.md, driven through
 * the shipped stdio entry point by a scripted client in place of a model.
 */
describe('Step 2 fixture tasks over stdio', () => {
  let fixtures: FixtureServers;
  let client: Client;
  const spent = new Map<string, number>();

  beforeAll(async () => {
    fixtures = await startFixtureServers(4111, 4112);
    client = new Client({ name: 'aether-task-runner', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('apps/cli/src/index.ts'), 'mcp', '--headless', '--direct'],
        cwd: process.cwd(),
        stderr: 'inherit',
      }),
    );
  }, 45000);

  afterAll(async () => {
    for (const [task, count] of spent) console.log(`${task}: ${count} result tokens`);
    await client?.close().catch(() => undefined);
    await fixtures?.close();
  });

  async function step(task: string, name: string, args: Record<string, unknown>) {
    const result = await call(client, name, args);
    spent.set(task, (spent.get(task) ?? 0) + tokens(result.text));
    return result;
  }

  it('task-fix-01: fills the multi-field form without submitting and the values read back', async () => {
    const page = await step('task-fix-01', 'open', { url: `${fixtures.mainBaseUrl}/form.html` });
    const name = refIn(page.text, 'textbox', 'Full Name');
    const email = refIn(page.text, 'textbox', 'Email');
    const country = refIn(page.text, 'combobox', 'Country');
    const newsletter = refIn(page.text, 'checkbox', 'Subscribe');
    const form = /\[(e\d+)\] form/.exec(page.text)?.[1] ?? '';

    const acted = await step('task-fix-01', 'act', {
      actions: [
        { op: 'fill', ref: name, value: 'Ada Lovelace' },
        { op: 'fill', ref: email, value: 'ada@example.com' },
        { op: 'fill', ref: country, value: 'India' },
        { op: 'fill', ref: newsletter, value: 'true' },
      ],
      risk: 'reversible',
      why: 'Fill the registration form without submitting it',
    });
    expect(acted.isError).toBe(false);
    expect(acted.text).toMatch(/step \d+ ok 4\/4 \| url unchanged/);
    expect(acted.text).toContain(`~ [${name}] textbox "Full Name:" value="Ada Lovelace"`);
    expect(acted.text).toContain(`~ [${email}] textbox "Email Address:" value="ada@example.com"`);
    expect(acted.text).toContain(`~ [${country}] combobox "Country:" value="India"`);
    expect(acted.text).toMatch(new RegExp(`~ \\[${newsletter}\\] checkbox "Subscribe to monthly newsletter".*\\[checked\\]`));
    expect(acted.text).not.toContain('page changed');

    const check = await step('task-fix-01', 'look', { ref: form });
    expect(check.text).toContain('value="Ada Lovelace"');
    expect(check.text).toContain('value="India"');
  }, 60000);

  it('task-fix-02: clicks the button inside the cross-origin iframe and sees the triggered state', async () => {
    await step('task-fix-02', 'open', { url: `${fixtures.mainBaseUrl}/cross-origin.html` });
    const found = await step('task-fix-02', 'find', { query: 'Apply Now', role: 'button' });
    const apply = refIn(found.text, 'button', 'Apply Now');
    const acted = await step('task-fix-02', 'act', { actions: [{ op: 'click', ref: apply }], risk: 'reversible', why: 'Apply' });
    expect(acted.isError).toBe(false);
    expect(acted.text).toContain('heading "Application received"');
  }, 60000);

  it('task-fix-03: clicks the button inside the open shadow root', async () => {
    const page = await step('task-fix-03', 'open', { url: `${fixtures.mainBaseUrl}/shadow-dom.html` });
    const button = refIn(page.text, 'button', 'Shadow Button Action');
    const acted = await step('task-fix-03', 'act', { actions: [{ op: 'click', ref: button }], risk: 'reversible', why: 'Press it' });
    expect(acted.isError).toBe(false);
    expect(acted.text).toContain('text + "Shadow action done"');
  }, 60000);

  it('task-fix-04: locates row 482 of the 500-row list with find and selects it', async () => {
    await step('task-fix-04', 'open', { url: `${fixtures.mainBaseUrl}/long-list.html` });
    const found = await step('task-fix-04', 'find', { query: 'number 482' });
    const row = refIn(found.text, 'link', 'Row item number 482');
    expect(found.text).toContain('(below)');
    const acted = await step('task-fix-04', 'act', { actions: [{ op: 'click', ref: row }], risk: 'read', why: 'Select row 482' });
    expect(acted.isError).toBe(false);
    expect(acted.text).toMatch(/url -> http:\/\/localhost:4111\/long-list\.html#item-482/);
  }, 60000);
});
