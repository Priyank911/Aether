/**
 * Step 1 exit gate: skim size and capture latency for the fixtures and five real
 * sites, written to docs/probe-results.md. Run from the repository root: pnpm exec tsx scripts/run-probes.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CDPClient, ChromeLauncher, type CDPSession } from '../packages/cdp/src/index.js';
import { startFixtureServers } from '../fixtures/src/index.js';
import { Perceiver, renderSkim } from '../packages/perceiver/src/index.js';

const NAVIGATION_TIMEOUT_MS = 45000;

interface ProbeRow {
  name: string;
  url: string;
  frames: number;
  refs: number;
  skimTokens: number;
  p50: number;
  p95: number;
  note: string;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number((sorted[index] ?? 0).toFixed(1));
}

async function navigate(session: CDPSession, url: string): Promise<boolean> {
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), NAVIGATION_TIMEOUT_MS);
    session.once('Page.loadEventFired', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  await session.send('Page.navigate', { url }, NAVIGATION_TIMEOUT_MS);
  const ok = await loaded;
  await new Promise((resolve) => setTimeout(resolve, 800));
  return ok;
}

async function probe(session: CDPSession, name: string, url: string, runs: number): Promise<ProbeRow> {
  const loaded = await navigate(session, url);
  const perceiver = new Perceiver(session);
  const times: number[] = [];
  let skimTokens = 0;
  let refs = 0;
  let frames = 0;
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const model = await perceiver.capture();
    times.push(performance.now() - started);
    skimTokens = renderSkim(model).tokens;
    refs = model.order.length;
    frames = model.frames.length;
  }
  console.log(`${name}: skim ${skimTokens} tokens, ${refs} refs, p50 ${percentile(times, 50)} ms`);
  return {
    name,
    url,
    frames,
    refs,
    skimTokens,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    note: loaded ? '' : 'no load event before timeout',
  };
}

async function main(): Promise<void> {
  const fixtures = await startFixtureServers(4101, 4102);
  const browser = await ChromeLauncher.launch({ headless: true });
  const client = await CDPClient.connect(browser.wsEndpoint);
  const rows: ProbeRow[] = [];
  try {
    const targets = await client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
    const pageTarget = targets.targetInfos.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No page target');
    const session = await client.attachToTarget(pageTarget.targetId);
    await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Accessibility.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    const base = fixtures.mainBaseUrl;
    const targetsToProbe: Array<[string, string, number]> = [
      ['Fixture: form', `${base}/form.html`, 10],
      ['Fixture: nested iframes', `${base}/nested-iframes.html`, 10],
      ['Fixture: cross-origin iframe', `${base}/cross-origin.html`, 10],
      ['Fixture: shadow DOM', `${base}/shadow-dom.html`, 10],
      ['Fixture: 500-row list', `${base}/long-list.html`, 10],
      ['Fixture: table', `${base}/table.html`, 10],
      ['Fixture: covered by overlay', `${base}/covered.html`, 10],
      ['Wikipedia article', 'https://en.wikipedia.org/wiki/Alan_Turing', 5],
      ['Hacker News', 'https://news.ycombinator.com/', 5],
      ['DuckDuckGo results', 'https://html.duckduckgo.com/html/?q=rust+programming+language', 5],
      ['GitHub repository', 'https://github.com/microsoft/TypeScript', 5],
      ['MDN reference', 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input', 5],
    ];
    for (const [name, url, runs] of targetsToProbe) {
      try {
        rows.push(await probe(session, name, url, runs));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`${name} failed: ${message}`);
        rows.push({ name, url, frames: 0, refs: 0, skimTokens: 0, p50: 0, p95: 0, note: `failed: ${message}` });
      }
    }
  } finally {
    await client.close().catch(() => undefined);
    await browser.kill();
    await fixtures.close();
  }

  const lines = [
    '# Probe results',
    '',
    `Recorded ${new Date().toISOString()} by \`scripts/run-probes.ts\`. Headless Chrome, viewport 1280x800, Node ${process.version}.`,
    '',
    'Skim tokens are estimated at 3.5 characters per token. Latency is the time for one `Perceiver.capture()` (frame discovery, accessibility tree, DOMSnapshot, extraction), measured after the load event; it does not include rendering the skim.',
    '',
    '| Target | Frames | Refs | Skim tokens | Capture p50 | Capture p95 | Note |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (row) =>
        `| ${row.name} | ${row.frames} | ${row.refs} | ${row.skimTokens} | ${row.p50} ms | ${row.p95} ms | ${row.note} |`,
    ),
    '',
    'Real-site results depend on the live page at the time of recording and on network speed while the page settles.',
    '',
  ];
  const outPath = path.resolve(process.cwd(), 'docs/probe-results.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
