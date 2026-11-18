/**
 * Spike S4b: does look as=items (behind space.items) find the listing on real
 * sites? Drives the engine session headless, opens each URL, and prints the
 * item count, the controls found and the token cost.
 *
 * Usage: npx tsx scripts/spikes/s4b-items-real.ts [url ...]
 */
import { MCPBrowserSession, type ToolOutput } from '../../packages/engine/src/browser-session.js';
import { toToolResult } from '../../packages/engine/src/tool-output.js';

const DEFAULT_URLS = [
  'https://books.toscrape.com/catalogue/category/books/mystery_3/index.html',
  'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
  'https://www.ebay.com/sch/i.html?_nkw=running+shoes',
  'https://news.ycombinator.com/',
];

function textOf(output: ToolOutput): string {
  return toToolResult(output)
    .content.map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;
  const session = await MCPBrowserSession.launch({ headless: true, ephemeral: true });
  try {
    for (const url of urls) {
      const opened = textOf(await session.open({ url }));
      const started = Date.now();
      const items = textOf(await session.look({ as: 'items' }));
      const lines = items.split('\n');
      const header = lines.find((line) => line.startsWith('items on')) ?? '(no header)';
      const controls = lines.filter((line) => /^(sort|next page|more):/.test(line));
      const sample = lines.filter((line) => /^\d+\. /.test(line)).slice(0, 3);
      console.log(`\n=== ${url}`);
      console.log(`open: ${Math.ceil(opened.length / 3.5)} tokens; items: ${Math.ceil(items.length / 3.5)} tokens in ${Date.now() - started} ms`);
      console.log(lines[0]);
      console.log(header);
      for (const line of [...controls, ...sample]) console.log(`  ${line}`);
    }
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
