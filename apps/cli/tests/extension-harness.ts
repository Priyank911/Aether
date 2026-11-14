import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CDPClient, ChromeLauncher, type CDPSession, type LaunchedBrowser } from '@aether/cdp';
import { ExtensionBridge } from '../src/mcp/bridge.js';
import { MCPBrowserSession } from '../src/mcp/browser-session.js';

export const EXTENSION_PATH = path.resolve('apps/extension/.output/chrome-mv3');

export interface ExtensionHarness {
  /** Test-side CDP over the pipe, for inspecting pages and the extension. */
  inspector: CDPClient;
  extensionId: string;
  serviceWorker: CDPSession;
  bridge: ExtensionBridge;
  /** The engine session that reaches Chrome only through the extension. */
  session: MCPBrowserSession;
  evaluateIn: (urlPrefix: string, expression: string) => Promise<unknown>;
  /** A test-side session on a page, standing in for the person's own input. */
  pageSession: (urlPrefix: string) => Promise<CDPSession>;
  close: () => Promise<void>;
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Headless Chrome over --remote-debugging-pipe with the built extension loaded
 * through Extensions.loadUnpacked, and the engine bridge address placed in the
 * extension's session storage, which is where the native host's message lands.
 */
export async function startExtensionHarness(): Promise<ExtensionHarness> {
  if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error('The extension is not built. Run pnpm extension:build first.');
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'aether-e2e-'));
  // An unpacked extension's id comes from its folder, so a copy gets an id the
  // person's registered native host does not allow. The test then never reads
  // or disturbs their ~/.aether/bridge.json.
  const extensionCopy = path.join(directory, 'extension');
  await cp(EXTENSION_PATH, extensionCopy, { recursive: true });
  const browser: LaunchedBrowser = await ChromeLauncher.launch({ headless: true, pipe: true, extensions: true });
  if (!browser.transport) throw new Error('pipe transport missing');
  const inspector = CDPClient.over(browser.transport);
  const { id: extensionId } = await inspector.sendCommand<{ id: string }>('Extensions.loadUnpacked', { path: extensionCopy }, undefined, 30000);

  const bridge = new ExtensionBridge(path.join(directory, 'bridge.json'));
  await bridge.start();

  const workerTarget = await waitFor(async () => {
    const { targetInfos } = await inspector.sendCommand<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>('Target.getTargets');
    return targetInfos.find((target) => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
  }, 10000, 'the extension service worker');
  const serviceWorker = await inspector.attachToTarget(workerTarget.targetId);
  // The worker target exists before its script has run; wait until the background has registered its listeners.
  await waitFor(async () => {
    const ready = await serviceWorker
      .send<{ result: { value?: boolean } }>('Runtime.evaluate', {
        expression: "typeof chrome !== 'undefined' && !!chrome.storage && chrome.storage.onChanged.hasListeners()",
        returnByValue: true,
      })
      .catch(() => undefined);
    return ready?.result.value ? true : undefined;
  }, 10000, 'the extension background to start');

  const connected = new Promise<void>((resolve) => bridge.once('connected', () => resolve()));
  const { port, token } = bridge.address;
  await serviceWorker.send('Runtime.evaluate', {
    expression: `chrome.storage.session.set({ 'aether.bridge': { port: ${port}, token: '${token}' } })`,
    awaitPromise: true,
  });
  await Promise.race([connected, new Promise((_, reject) => setTimeout(() => reject(new Error('extension did not connect')), 10000))]);

  const engine = CDPClient.over(bridge.transport);
  bridge.on('reset', (reason: string) => engine.resetSessions(reason));
  const session = await MCPBrowserSession.over(engine);
  bridge.attachRun(session.run);

  const attached = new Map<string, CDPSession>();
  const pageSession = async (urlPrefix: string): Promise<CDPSession> => {
    const { targetInfos } = await inspector.sendCommand<{ targetInfos: Array<{ targetId: string; type: string; url: string }> }>('Target.getTargets');
    const target = targetInfos.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(urlPrefix));
    if (!target) throw new Error(`no page at ${urlPrefix}`);
    let page = attached.get(target.targetId);
    if (!page || page.isDetached) {
      page = await inspector.attachToTarget(target.targetId);
      attached.set(target.targetId, page);
    }
    return page;
  };
  const evaluateIn = async (urlPrefix: string, expression: string): Promise<unknown> => {
    const page = await pageSession(urlPrefix);
    const result = await page.send<{ result: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return result.result.value;
  };

  return {
    inspector,
    extensionId,
    serviceWorker,
    bridge,
    session,
    evaluateIn,
    pageSession,
    close: async () => {
      await session.close().catch(() => undefined);
      await bridge.close();
      await inspector.close().catch(() => undefined);
      await browser.kill();
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export { waitFor };
