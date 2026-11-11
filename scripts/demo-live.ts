/**
 * Headed walkthrough on the form fixture: skim, one batched act, and the delta
 * the model receives. Run: pnpm demo
 */
import { Actor } from '../packages/actor/src/index.js';
import { CDPClient, ChromeLauncher } from '../packages/cdp/src/index.js';
import { startFixtureServers } from '../fixtures/src/index.js';
import { estimateTokens, Perceiver, renderSkim, type PageModel } from '../packages/perceiver/src/index.js';

function refOf(model: PageModel, role: string, nameIncludes: string): string {
  for (const node of model.byRef.values()) {
    if (node.role === role && node.name.includes(nameIncludes) && node.ref) return node.ref;
  }
  throw new Error(`No ${role} named like "${nameIncludes}"`);
}

async function runLiveDemo(): Promise<void> {
  const fixtures = await startFixtureServers(4101, 4102);
  const browser = await ChromeLauncher.launch({ headless: false });
  const client = await CDPClient.connect(browser.wsEndpoint);
  try {
    const targets = await client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
    const pageTarget = targets.targetInfos.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No page target');
    const session = await client.attachToTarget(pageTarget.targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');

    const loaded = new Promise<void>((resolve) => {
      session.once('Page.loadEventFired', () => resolve());
      setTimeout(resolve, 5000);
    });
    await session.send('Page.navigate', { url: `${fixtures.mainBaseUrl}/form.html` });
    await loaded;

    const perceiver = new Perceiver(session);
    const actor = new Actor(perceiver);
    const model = await perceiver.capture();
    const skim = renderSkim(model);
    console.log(`Skim (${skim.tokens} tokens):\n${skim.text}\n`);

    const result = await actor.execute({
      actions: [
        { ref: refOf(model, 'textbox', 'Full Name'), op: 'type', value: 'Ada Lovelace' },
        { ref: refOf(model, 'textbox', 'Email'), op: 'type', value: 'ada@example.com' },
        { ref: refOf(model, 'combobox', 'Country'), op: 'select', value: 'IN' },
        { ref: refOf(model, 'checkbox', 'newsletter'), op: 'click' },
      ],
      risk: 'reversible',
      why: 'Fill the registration form without submitting',
    });
    console.log(`Act result (${estimateTokens(result.text)} tokens):\n${result.text}\n`);

    console.log('Chrome stays open for 7 seconds.');
    await new Promise((resolve) => setTimeout(resolve, 7000));
  } finally {
    await client.close().catch(() => undefined);
    await browser.kill();
    await fixtures.close();
  }
}

runLiveDemo().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
