import { createHash } from 'node:crypto';
import type { CDPSession } from '@aether/cdp';
import type { PageWatcher } from './page-watch.js';

const SAMPLE_INTERVAL_MS = 150;
const SETTLE_CAP_MS = 2500;
const LOAD_CAP_MS = 10000;

interface AXSample {
  nodes: Array<{ role?: { value?: unknown }; name?: { value?: unknown }; backendDOMNodeId?: number }>;
}

async function structureHash(session: CDPSession): Promise<string | undefined> {
  try {
    const tree = await session.send<AXSample>('Accessibility.getFullAXTree', { depth: 6 });
    const signature = tree.nodes
      .map((node) => `${String(node.role?.value ?? '')}:${node.backendDOMNodeId ?? ''}:${String(node.name?.value ?? '').length}`)
      .join('|');
    return createHash('sha1').update(signature).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Wait until the page stops changing: first for a navigation the action
 * started, then until two accessibility-structure samples 150 ms apart match.
 * Returns false when the cap was reached, so the caller can say the page was
 * still changing.
 */
export async function waitForSettle(session: CDPSession, watcher: PageWatcher): Promise<boolean> {
  if (watcher.dialog) return true;
  if (watcher.loading && !(await watcher.untilLoaded(LOAD_CAP_MS))) return false;
  const started = Date.now();
  let previous: string | undefined;
  while (Date.now() - started < SETTLE_CAP_MS) {
    if (watcher.dialog) return true;
    const current = await structureHash(session);
    if (current !== undefined && current === previous) return true;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
  }
  return false;
}
