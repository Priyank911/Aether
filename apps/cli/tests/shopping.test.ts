import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { call, refIn } from './helpers.js';

/**
 * The shopping method over stdio: look as=items scrolls a lazily loaded
 * listing so items below the fold are listed, points at the next page, counts
 * distinct items across pages, and reads the product facts a page declares.
 */
describe('Listing survey with look as=items', () => {
  let fixtures: FixtureServers;
  let client: Client;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4141, 4142);
    client = new Client({ name: 'aether-shopping', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('apps/cli/src/index.ts'), 'mcp', '--headless', '--direct'],
        cwd: process.cwd(),
        stderr: 'inherit',
      }),
    );
  }, 45000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await fixtures?.close();
  });

  it('sends the working method as server instructions', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('look as=items');
    expect(instructions.length).toBeLessThan(1500);
  });

  it('lists items loaded only after scrolling, with prices, ratings and the next page', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/shop/list?page=1` });
    const listing = await call(client, 'look', { as: 'items' });
    expect(listing.isError).toBe(false);
    expect(listing.text).toMatch(/12 found; page says 16 results; 12 new this run/);
    expect(listing.text).toMatch(/"Harbor Run running shoe" \| \$89\.00 \| 4\.4\/5 \(1,530\)/);
    expect(listing.text).toMatch(/"Trail Runner One running shoe".*sponsored/);
    expect(listing.text).toMatch(/"Cloud Step running shoe".*out of stock/);
    expect(listing.text).toMatch(/next page: \[e\d+\] link "Next"/);
    expect(listing.text).not.toMatch(/"Help"/);

    const next = /next page: \[(e\d+)\]/.exec(listing.text)?.[1] ?? '';
    const moved = await call(client, 'act', { actions: [{ op: 'click', ref: next }], risk: 'read', why: 'Next page of results' });
    expect(moved.isError).toBe(false);
    const second = await call(client, 'look', { as: 'items' });
    expect(second.text).toMatch(/4 found; page says 16 results; 4 new this run/);
    expect(second.text).toMatch(/"Aurora Max running shoe" \| \$99\.00 \| 4\.8\/5/);
    expect(second.text).toContain('next page: none found on this page');
    expect(second.text).toContain('16 distinct items seen this run');
  }, 60000);

  it('reads the product facts a product page declares', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/shop/item/13` });
    const product = await call(client, 'look', { as: 'items' });
    expect(product.text).toContain('price: USD 99.00');
    expect(product.text).toContain('rating: 4.8/5 from 2210 reviews');
    expect(product.text).toContain('availability: in stock');
    expect(product.text).toContain('seller: Fixture Shop');
  }, 30000);

  it('answers a repeated look on an unchanged page in one line', async () => {
    const first = await call(client, 'look');
    expect(first.text).toMatch(/button "Add to cart"/);
    refIn(first.text, 'button', 'Add to cart');
    const again = await call(client, 'look');
    expect(again.text.split('\n')[0]).toMatch(/^page unchanged since your last look/);
  }, 30000);
});
