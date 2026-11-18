import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { MCPBrowserSession } from '../src/mcp/browser-session.js';
import { engineClient, type EngineClient } from './engine-client.js';
import { call, refIn } from './helpers.js';

/**
 * Listing reads behind space.items: look as=items scrolls a lazily loaded
 * listing so items below the fold are listed, points at the next page, counts
 * distinct items across pages, and reads the product facts a page declares.
 */
describe('Listing survey with look as=items', () => {
  let fixtures: FixtureServers;
  let session: MCPBrowserSession;
  let client: EngineClient;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4141, 4142);
    session = await MCPBrowserSession.launch({ headless: true, ephemeral: true });
    client = engineClient(session);
  }, 45000);

  afterAll(async () => {
    await session?.close();
    await fixtures?.close();
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
