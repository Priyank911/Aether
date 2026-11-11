import { CDPClient, ChromeLauncher, type CDPSession } from '@aether/cdp';
import { Perceiver, renderFind, renderSkim, renderText, type PageModel } from '@aether/perceiver';

export interface ProbeOptions {
  headless?: boolean;
  verbose?: boolean;
  /** Also print the text view. */
  text?: boolean;
  /** Also run find with this query. */
  find?: string;
}

export interface ProbeResult {
  url: string;
  title: string;
  frames: number;
  refs: number;
  skimTokens: number;
  captureMs: number;
  skim: string;
  model: PageModel;
}

async function navigate(session: CDPSession, url: string, timeoutMs = 30000): Promise<void> {
  const loaded = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    session.once('Page.loadEventFired', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await session.send('Page.navigate', { url }, timeoutMs);
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Open a URL in an isolated Chrome and print the skim the model would receive. */
export async function runProbe(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const browser = await ChromeLauncher.launch({ headless: options.headless ?? true });
  let client: CDPClient | undefined;
  try {
    client = await CDPClient.connect(browser.wsEndpoint);
    const targets = await client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
    const pageTarget = targets.targetInfos.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No page target found in Chrome');
    const session = await client.attachToTarget(pageTarget.targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await navigate(session, url);

    const perceiver = new Perceiver(session);
    const started = performance.now();
    const model = await perceiver.capture();
    const captureMs = Number((performance.now() - started).toFixed(1));
    const skim = renderSkim(model);

    if (options.verbose !== false) {
      console.log(`--- ${model.url}`);
      console.log(`frames=${model.frames.length} refs=${model.order.length} skim=${skim.tokens} tokens capture=${captureMs} ms`);
      for (const warning of skim.warnings) console.log(`warning: ${warning}`);
      console.log(skim.text);
      if (options.text) {
        const text = renderText(model);
        console.log(`--- text view (${text.tokens} tokens)`);
        console.log(text.text);
      }
      if (options.find) {
        const found = renderFind(model, options.find);
        console.log(`--- find (${found.tokens} tokens)`);
        console.log(found.text);
      }
    }

    return {
      url: model.url,
      title: model.title,
      frames: model.frames.length,
      refs: model.order.length,
      skimTokens: skim.tokens,
      captureMs,
      skim: skim.text,
      model,
    };
  } finally {
    await client?.close().catch(() => undefined);
    await browser.kill();
  }
}
