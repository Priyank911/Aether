/**
 * Spike S5: does look as=items find the listing on real sites? Runs the
 * shipped MCP entry point headless and direct, opens each URL, and prints the
 * item count, the controls found and the token cost.
 *
 * Usage: npx tsx scripts/spikes/s5-items-real.ts [url ...]
 */
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DEFAULT_URLS = [
  'https://books.toscrape.com/catalogue/category/books/mystery_3/index.html',
  'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops',
  'https://www.ebay.com/sch/i.html?_nkw=running+shoes',
  'https://news.ycombinator.com/',
];

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const blocks = Array.isArray(result.content) ? (result.content as Array<{ type: string; text?: string }>) : [];
  return blocks.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;
  const client = new Client({ name: 'aether-spike-s5', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('apps/cli/src/index.ts'), 'mcp', '--headless', '--direct'],
      cwd: process.cwd(),
      stderr: 'ignore',
    }),
  );
  try {
    for (const url of urls) {
      const opened = textOf(await client.callTool({ name: 'open', arguments: { url } }));
      const started = Date.now();
      const items = textOf(await client.callTool({ name: 'look', arguments: { as: 'items' } }));
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
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
