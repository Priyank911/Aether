import type { CDPSession } from '@aether/cdp';
import { announceAgentInput } from './geometry.js';
import { wheelAt } from './mouse.js';
import type { PageWatcher } from './page-watch.js';

const MAX_STEPS = 10;
const STEP_WAIT_MS = 450;

interface Metrics {
  cssLayoutViewport: { pageY: number; clientWidth: number; clientHeight: number };
  cssContentSize: { height: number };
}

export interface ScrollThroughResult {
  steps: number;
  reachedEnd: boolean;
  grewBy: number;
}

/**
 * Scroll through the page the way a person does before choosing from a
 * list, so lazily loaded items appear, then return to the top. Bounded in steps;
 * reports whether the end was reached.
 */
export async function scrollThrough(session: CDPSession, watcher: PageWatcher): Promise<ScrollThroughResult> {
  const read = (): Promise<Metrics> => session.send<Metrics>('Page.getLayoutMetrics');
  let metrics = await read();
  const startHeight = metrics.cssContentSize.height;
  let steps = 0;
  let reachedEnd = false;
  let stableAtEnd = 0;
  while (steps < MAX_STEPS && !watcher.dialog) {
    const { clientWidth, clientHeight, pageY } = metrics.cssLayoutViewport;
    if (pageY + clientHeight >= metrics.cssContentSize.height - 4) {
      const before = metrics.cssContentSize.height;
      await new Promise((resolve) => setTimeout(resolve, STEP_WAIT_MS));
      metrics = await read();
      if (metrics.cssContentSize.height <= before && ++stableAtEnd >= 1) {
        reachedEnd = true;
        break;
      }
    }
    await announceAgentInput(session);
    await wheelAt(session, { x: Math.round(clientWidth / 2), y: Math.round(clientHeight / 2) }, Math.round(clientHeight * 1.6));
    steps++;
    await new Promise((resolve) => setTimeout(resolve, STEP_WAIT_MS));
    metrics = await read();
  }
  if (!watcher.dialog) {
    await announceAgentInput(session);
    const { clientWidth, clientHeight } = metrics.cssLayoutViewport;
    await wheelAt(session, { x: Math.round(clientWidth / 2), y: Math.round(clientHeight / 2) }, -1e6);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { steps, reachedEnd, grewBy: Math.max(0, Math.round(metrics.cssContentSize.height - startHeight)) };
}
