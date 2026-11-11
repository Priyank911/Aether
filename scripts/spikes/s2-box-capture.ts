/**
 * Spike S2 (docs/PLAN.md section 5.1 and 13).
 *
 * Question: what does it cost to attach bounding boxes to the accessibility
 * capture, using one DOMSnapshot.captureSnapshot per frame versus batched
 * DOM.getBoxModel calls for the kept nodes only?
 *
 * Also checks which coordinate space DOMSnapshot layout bounds use, because the
 * skim needs viewport-relative positions.
 *
 * Run: pnpm exec tsx scripts/spikes/s2-box-capture.ts
 */
import { performance } from 'node:perf_hooks';
import { CDPClient, ChromeLauncher, type CDPSession } from '../../packages/cdp/src/index.js';
import { HEADING_ROLES, INTERACTIVE_ROLES, LANDMARK_ROLES } from '../../packages/perceiver/src/index.js';
import { startFixtureServers } from '../../fixtures/src/index.js';

const RUNS = 5;

interface AXNode {
  ignored?: boolean;
  role?: { value?: unknown };
  backendDOMNodeId?: number;
}

interface SnapshotResult {
  documents: Array<{
    nodes: { backendNodeId?: number[] };
    layout: { nodeIndex: number[]; bounds: number[][] };
    scrollOffsetX?: number;
    scrollOffsetY?: number;
  }>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

function keptBackendIds(nodes: AXNode[]): number[] {
  const ids = new Set<number>();
  for (const node of nodes) {
    if (node.ignored || !node.backendDOMNodeId) continue;
    const role = String(node.role?.value ?? '').toLowerCase();
    if (INTERACTIVE_ROLES.has(role) || HEADING_ROLES.has(role) || LANDMARK_ROLES.has(role)) {
      ids.add(node.backendDOMNodeId);
    }
  }
  return [...ids];
}

async function navigate(session: CDPSession, url: string): Promise<boolean> {
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    session.once('Page.loadEventFired', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  await session.send('Page.navigate', { url });
  const ok = await loaded;
  await new Promise((r) => setTimeout(r, 800));
  return ok;
}

async function measure(session: CDPSession, label: string): Promise<void> {
  const ax: number[] = [];
  const snap: number[] = [];
  const boxes: number[] = [];
  let kept = 0;
  let layoutNodes = 0;

  for (let run = 0; run < RUNS; run++) {
    const [axResult, axMs] = await timed(() => session.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree'));
    ax.push(axMs);
    const ids = keptBackendIds(axResult.nodes);
    kept = ids.length;

    const [snapshot, snapMs] = await timed(() =>
      session.send<SnapshotResult>('DOMSnapshot.captureSnapshot', {
        computedStyles: ['pointer-events', 'visibility'],
        includePaintOrder: true,
        includeDOMRects: false,
      }),
    );
    snap.push(snapMs);
    layoutNodes = snapshot.documents.reduce((sum, doc) => sum + doc.layout.nodeIndex.length, 0);

    const [, boxMs] = await timed(() =>
      Promise.all(ids.map((backendNodeId) => session.send('DOM.getBoxModel', { backendNodeId }).catch(() => null))),
    );
    boxes.push(boxMs);
  }

  const axP50 = median(ax);
  const snapP50 = median(snap);
  const boxP50 = median(boxes);
  console.log(
    `${label.padEnd(28)} kept=${String(kept).padStart(4)} layout=${String(layoutNodes).padStart(6)} | ` +
      `ax ${axP50.toFixed(0).padStart(5)} ms | +snapshot ${snapP50.toFixed(0).padStart(5)} ms (total ${(axP50 + snapP50).toFixed(0)}) | ` +
      `+boxModel batch ${boxP50.toFixed(0).padStart(5)} ms (total ${(axP50 + boxP50).toFixed(0)})`,
  );
}

async function coordinateCheck(session: CDPSession): Promise<void> {
  const doc = await session.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  const found = await session.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '#catalog-list li:nth-child(200) a',
  });
  const described = await session.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { nodeId: found.nodeId });
  const backendNodeId = described.node.backendNodeId;

  const readSnapshotY = async (): Promise<{ y: number; scrollY: number }> => {
    const snapshot = await session.send<SnapshotResult>('DOMSnapshot.captureSnapshot', { computedStyles: [] });
    const main = snapshot.documents[0];
    if (!main) throw new Error('no document');
    const nodeIndex = main.nodes.backendNodeId?.indexOf(backendNodeId) ?? -1;
    const layoutIndex = main.layout.nodeIndex.indexOf(nodeIndex);
    return { y: main.layout.bounds[layoutIndex]?.[1] ?? Number.NaN, scrollY: main.scrollOffsetY ?? 0 };
  };
  const readBoxY = async (): Promise<number> => {
    const box = await session.send<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId });
    return box.model.content[1] ?? Number.NaN;
  };

  const before = await readSnapshotY();
  const boxBefore = await readBoxY();
  await session.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 1000)' });
  await new Promise((r) => setTimeout(r, 200));
  const after = await readSnapshotY();
  const boxAfter = await readBoxY();

  console.log('\nCoordinate space check (row 200 of the long list, scrolled 1000 px):');
  console.log(`  DOMSnapshot bounds y: ${before.y} -> ${after.y} (scrollOffsetY ${before.scrollY} -> ${after.scrollY})`);
  console.log(`  DOM.getBoxModel y:    ${boxBefore} -> ${boxAfter}`);
  console.log(
    `  DOMSnapshot bounds are ${before.y === after.y ? 'document-absolute (subtract scrollOffset for viewport)' : 'viewport-relative'}; ` +
      `getBoxModel is ${boxBefore === boxAfter ? 'document-absolute' : 'viewport-relative'}.`,
  );
}

async function main(): Promise<void> {
  const fixtures = await startFixtureServers(4301, 4302);
  const browser = await ChromeLauncher.launch({ headless: true });
  const client = await CDPClient.connect(browser.wsEndpoint);
  try {
    const targets = await client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
    const page = targets.targetInfos.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const session = await client.attachToTarget(page.targetId);
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const sites: Array<[string, string]> = [
      ['fixture form', `${fixtures.mainBaseUrl}/form.html`],
      ['fixture long list', `${fixtures.mainBaseUrl}/long-list.html`],
      ['wikipedia article', 'https://en.wikipedia.org/wiki/Alan_Turing'],
      ['hacker news', 'https://news.ycombinator.com/'],
      ['github repo', 'https://github.com/microsoft/TypeScript'],
      ['duckduckgo html', 'https://html.duckduckgo.com/html/?q=rust+programming+language'],
      ['mdn reference', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input'],
    ];

    console.log(`Spike S2: p50 of ${RUNS} runs, viewport 1280x800, headless\n`);
    for (const [label, url] of sites) {
      try {
        const loaded = await navigate(session, url);
        await measure(session, loaded ? label : `${label} (no load event)`);
      } catch (error) {
        console.log(`${label.padEnd(28)} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await navigate(session, `${fixtures.mainBaseUrl}/long-list.html`);
    await coordinateCheck(session);
  } finally {
    await client.close().catch(() => undefined);
    await browser.kill();
    await fixtures.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Spike S2 failed:', error);
  process.exit(1);
});
