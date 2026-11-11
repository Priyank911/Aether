import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Actor, PageWatcher } from '@aether/actor';
import { CDPClient, ChromeLauncher, type CDPSession, type LaunchedBrowser } from '@aether/cdp';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { Perceiver, type PageModel } from '@aether/perceiver';

function refOf(model: PageModel, role: string, nameIncludes: string): string {
  for (const node of model.byRef.values()) {
    if (node.role === role && node.name.includes(nameIncludes) && node.ref) return node.ref;
  }
  throw new Error(`No ${role} named like "${nameIncludes}"`);
}

describe('Actor: trusted CDP input against the latest capture', () => {
  let fixtures: FixtureServers;
  let browser: LaunchedBrowser;
  let client: CDPClient;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4103, 4104);
    browser = await ChromeLauncher.launch({ headless: true });
    client = await CDPClient.connect(browser.wsEndpoint);
  }, 30000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await browser?.kill();
    await fixtures?.close();
  });

  async function setup(path: string): Promise<{ session: CDPSession; actor: Actor; model: PageModel }> {
    const { targetId } = await client.sendCommand<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const session = await client.attachToTarget(targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    const loaded = new Promise<void>((resolve) => {
      session.once('Page.loadEventFired', () => resolve());
      setTimeout(resolve, 5000);
    });
    await session.send('Page.navigate', { url: `${fixtures.mainBaseUrl}/${path}` });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const perceiver = new Perceiver(session);
    const model = await perceiver.capture();
    return { session, actor: new Actor(perceiver, await PageWatcher.attach(session)), model };
  }

  async function readPageValue<T>(session: CDPSession, expression: string): Promise<T> {
    const result = await session.send<{ result: { value: T } }>('Runtime.evaluate', { expression, returnByValue: true });
    return result.result.value;
  }

  it('fills a text field with trusted input, replacing what was there', async () => {
    const { session, actor, model } = await setup('form.html');
    const name = refOf(model, 'textbox', 'Full Name');
    await actor.execute({ actions: [{ op: 'fill', ref: name, value: 'First' }], risk: 'reversible', why: 'Fill' });
    const result = await actor.execute({ actions: [{ op: 'fill', ref: name, value: 'Jane Doe' }], risk: 'reversible', why: 'Refill' });
    expect(result.success).toBe(true);
    expect(await readPageValue<string>(session, 'document.getElementById("username").value')).toBe('Jane Doe');
  });

  it('picks a select option by its visible label', async () => {
    const { session, actor, model } = await setup('form.html');
    const result = await actor.execute({
      actions: [{ op: 'fill', ref: refOf(model, 'combobox', 'Country'), value: 'United Kingdom' }],
      risk: 'reversible',
      why: 'Choose the UK',
    });
    expect(result.success).toBe(true);
    expect(result.notes).toEqual(['1: chose "United Kingdom"']);
    expect(await readPageValue<string>(session, 'document.getElementById("country").value')).toBe('UK');
  });

  it('names the available options when the label does not exist', async () => {
    const { actor, model } = await setup('form.html');
    const result = await actor.execute({
      actions: [{ op: 'fill', ref: refOf(model, 'combobox', 'Country'), value: 'Atlantis' }],
      risk: 'reversible',
      why: 'Choose a country',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('no option "Atlantis"; options are: United States, United Kingdom, India');
  });

  it('sets a checkbox to a state and leaves it alone when already there', async () => {
    const { session, actor, model } = await setup('form.html');
    const box = refOf(model, 'checkbox', 'newsletter');
    await actor.execute({ actions: [{ op: 'fill', ref: box, value: 'true' }], risk: 'reversible', why: 'Subscribe' });
    const again = await actor.execute({ actions: [{ op: 'fill', ref: box, value: 'true' }], risk: 'reversible', why: 'Subscribe again' });
    expect(again.notes).toEqual(['1: already checked']);
    expect(await readPageValue<boolean>(session, 'document.getElementById("newsletter").checked')).toBe(true);
  });

  it('returns a header and a delta line for the changed field, not a snapshot', async () => {
    const { actor, model } = await setup('form.html');
    const ref = refOf(model, 'textbox', 'Full Name');
    const result = await actor.execute({ actions: [{ op: 'fill', ref, value: 'Delta Test' }], risk: 'reversible', why: 'Check delta' });
    expect(result.text.split('\n')[0]).toBe('step 1 ok 1/1 | url unchanged');
    expect(result.text).toContain(`~ [${ref}] textbox "Full Name:" value="Delta Test"`);
    expect(result.text).not.toContain('Submit Application');
  });

  it('scrolls the page with a trusted wheel event', async () => {
    const { actor } = await setup('long-list.html');
    const result = await actor.execute({ actions: [{ op: 'scroll', value: 'down' }], risk: 'read', why: 'See more' });
    expect(result.text.split('\n')[0]).toMatch(/scroll 0% -> [1-9]\d*%/);
  });

  it('attaches a local file to a file input', async () => {
    const { session, actor, model } = await setup('upload.html');
    const input = [...model.byRef.values()].find((node) => node.name.includes('Resume'));
    expect(input?.ref).toBeDefined();
    const file = path.resolve('fixtures/package.json');
    const result = await actor.execute({ actions: [{ op: 'upload', ref: input?.ref, value: file }], risk: 'reversible', why: 'Attach the resume' });
    expect(result.success).toBe(true);
    expect(result.notes).toEqual(['1: attached package.json']);
    expect(await readPageValue<string>(session, "document.getElementById('chosen').textContent")).toBe('Chosen: package.json');
  });

  it('refuses to upload a path that is not a file', async () => {
    const { actor, model } = await setup('upload.html');
    const input = [...model.byRef.values()].find((node) => node.name.includes('Resume'));
    const result = await actor.execute({ actions: [{ op: 'upload', ref: input?.ref, value: path.resolve('fixtures') }], risk: 'reversible', why: 'Attach' });
    expect(result.error).toContain('no file at');
  });

  it('reports a stale ref without running anything', async () => {
    const { actor } = await setup('form.html');
    const result = await actor.execute({ actions: [{ op: 'click', ref: 'e9999' }], risk: 'read', why: 'Use a ref that does not exist' });
    expect(result.success).toBe(false);
    expect(result.executedCount).toBe(0);
    expect(result.error).toBe('stale [e9999]: no longer on the page, nothing was done. Call look or find for current refs.');
    expect(result.text.split('\n')[0]).toBe('step 1 failed 0/1 | url unchanged');
  });

  it('rejects an op that needs a ref when none is given', async () => {
    const { actor } = await setup('form.html');
    const result = await actor.execute({ actions: [{ op: 'click' }], risk: 'read', why: 'Missing ref' });
    expect(result.error).toBe('click not done: click needs a ref');
  });
});
