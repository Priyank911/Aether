/**
 * Spike S4 (docs/PLAN.md section 8.6 and 13): how often would the URL
 * provenance rule stop a benign run?
 *
 * Without a model in the loop this replays the `open` calls a reasonable agent
 * would make for the 16 live-site tasks in docs/METRICS.md, written by hand
 * before the rule was applied. Each sequence also lists links the agent would
 * have seen. A real false-positive rate needs recorded model runs (Step 7).
 *
 * Run: pnpm exec tsx scripts/spikes/s4-provenance.ts
 */
import { classifyOpen } from '../../packages/policy/src/index.js';

interface Scripted {
  task: string;
  /** Each entry is a URL the agent opens directly; `links` are hrefs seen on the page before it. */
  steps: Array<{ url: string; links?: string[] }>;
}

const SEQUENCES: Scripted[] = [
  { task: 'task-wiki-01', steps: [{ url: 'https://en.wikipedia.org/wiki/Alan_Turing' }] },
  { task: 'task-wiki-02', steps: [{ url: 'https://en.wikipedia.org/wiki/Apollo_11' }, { url: 'https://en.wikipedia.org/wiki/Saturn_V' }] },
  { task: 'task-wiki-03', steps: [{ url: 'https://en.wikipedia.org/wiki/Quantum_computing' }] },
  { task: 'task-wiki-04', steps: [{ url: 'https://en.wikipedia.org/' }, { url: 'https://en.wikipedia.org/w/index.php?search=Plate+tectonics' }] },
  { task: 'task-ddg-01', steps: [{ url: 'https://duckduckgo.com/?q=Rust+programming+language' }] },
  { task: 'task-ddg-02', steps: [{ url: 'https://duckduckgo.com/?q=weather+Tokyo' }] },
  { task: 'task-ddg-03', steps: [{ url: 'https://duckduckgo.com/?q=technology&iar=news' }] },
  {
    task: 'task-ddg-04',
    steps: [{ url: 'https://duckduckgo.com/?q=lighthouses' }, { url: 'https://duckduckgo.com/?q=lighthouses&iax=images&ia=images' }],
  },
  {
    task: 'task-gh-01',
    steps: [
      { url: 'https://github.com/microsoft/TypeScript' },
      { url: 'https://raw.githubusercontent.com/microsoft/TypeScript/main/package.json', links: [] },
    ],
  },
  { task: 'task-gh-02', steps: [{ url: 'https://github.com/microsoft/TypeScript/releases' }] },
  { task: 'task-gh-03', steps: [{ url: 'https://github.com/microsoft/TypeScript/issues?q=is%3Aopen+regression' }] },
  { task: 'task-gh-04', steps: [{ url: 'https://github.com/microsoft/TypeScript' }] },
  { task: 'task-ecom-01', steps: [{ url: 'https://www.amazon.in/s?k=mechanical+keyboard' }] },
  { task: 'task-ecom-02', steps: [{ url: 'https://www.amazon.in/s?k=mechanical+keyboard' }, { url: 'https://www.amazon.in/s?k=mechanical+keyboard&rh=p_85%3A10440599031' }] },
  {
    task: 'task-ecom-03',
    steps: [
      { url: 'https://www.amazon.in/s?k=mechanical+keyboard' },
      { url: 'https://www.amazon.in/dp/B0EXAMPLE?th=1', links: ['https://www.amazon.in/dp/B0EXAMPLE?th=1'] },
    ],
  },
  {
    task: 'task-research-cross-site',
    steps: [
      { url: 'https://duckduckgo.com/?q=Saturn+V+first+stage+engine' },
      { url: 'https://en.wikipedia.org/wiki/Rocketdyne_F-1', links: ['https://en.wikipedia.org/wiki/Rocketdyne_F-1'] },
      { url: 'https://www.google.com/search?q=Rocketdyne+F-1+thrust' },
    ],
  },
];

let opens = 0;
let held = 0;
for (const sequence of SEQUENCES) {
  const visitedOrigins = new Set<string>();
  const seenLinks = new Set<string>();
  let hasReadPages = false;
  for (const step of sequence.steps) {
    for (const link of step.links ?? []) seenLinks.add(link);
    const decision = classifyOpen(step.url, { visitedOrigins, seenLinks, hasReadPages });
    opens++;
    if (decision.outcome !== 'allow') {
      held++;
      console.log(`${sequence.task}: ${decision.outcome} for ${step.url} (${decision.reason})`);
    }
    visitedOrigins.add(new URL(step.url).origin);
    hasReadPages = true;
  }
}
console.log(`\n${opens} scripted opens across ${SEQUENCES.length} tasks; ${held} held for approval (${((held / opens) * 100).toFixed(1)}%).`);
