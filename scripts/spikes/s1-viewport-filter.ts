import { ChromeLauncher, CDPClient } from '@aether/cdp';
import { performance } from 'node:perf_hooks';

async function runSpike(): Promise<void> {
  console.log('Running Spike S1: Benchmarking DOMSnapshot.captureSnapshot vs AX capture for viewport filtering...');
  const browser = await ChromeLauncher.launch({ headless: true });
  let client: CDPClient | null = null;

  try {
    client = await CDPClient.connect(browser.wsEndpoint);
    const targets = await client.sendCommand<{
      targetInfos: Array<{ targetId: string; type: string }>;
    }>('Target.getTargets');
    const pageTarget = targets.targetInfos.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const session = await client.attachToTarget(pageTarget.targetId);
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');

    // Navigate to a rich page with many elements
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head><style>body { height: 3000px; } .item { margin: 20px; }</style></head>
      <body>
        <h1>Above fold heading</h1>
        <button id="b1">Button 1</button>
        <div style="height: 1200px;"></div>
        <h2>Below fold heading</h2>
        <button id="b2">Button 2</button>
        <div style="height: 1200px;"></div>
        <button id="b3">Button 3</button>
      </body>
      </html>
    `;
    await session.send('Page.navigate', {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`,
    });
    await new Promise((r) => setTimeout(r, 200));

    // 1. Measure Accessibility.getFullAXTree alone
    const axTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await session.send('Accessibility.getFullAXTree');
      axTimes.push(performance.now() - t0);
    }
    const axMedian = axTimes.sort((a, b) => a - b)[Math.floor(axTimes.length / 2)] ?? 0;
    console.log(`Accessibility.getFullAXTree median latency: ${axMedian.toFixed(2)} ms`);

    // 2. Measure DOMSnapshot.captureSnapshot
    const domSnapshotTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await session.send('DOMSnapshot.captureSnapshot', {
        computedStyles: [],
        includeDOMRects: true,
        includePaintOrder: false,
      });
      domSnapshotTimes.push(performance.now() - t0);
    }
    const domSnapshotMedian = domSnapshotTimes.sort((a, b) => a - b)[Math.floor(domSnapshotTimes.length / 2)] ?? 0;
    console.log(`DOMSnapshot.captureSnapshot median latency: ${domSnapshotMedian.toFixed(2)} ms`);

    const ratio = domSnapshotMedian / Math.max(1, axMedian);
    console.log(`Overhead ratio (DOMSnapshot / AX): ${ratio.toFixed(2)}x`);

    if (domSnapshotMedian > 150 || ratio > 2.0) {
      console.log('SPIKE RESULT: DOMSnapshot.captureSnapshot adds significant overhead per step.');
      console.log('Per Section 7.1 and Spike S1 instructions: Disable DOMSnapshot viewport filtering and rely on cap (150 elements) and sibling collapse rules.');
    } else {
      console.log('SPIKE RESULT: DOMSnapshot is fast enough to consider for viewport filtering.');
    }
  } finally {
    if (client) await client.close().catch(() => {});
    await browser.kill();
  }
}

void runSpike().catch((err) => {
  console.error('Spike S1 failed:', err);
  process.exit(1);
});
