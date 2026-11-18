import { expect } from 'vitest';

/*
 * The shared Code Mode test task (plan 3.2, task 3.2): one aether_exec
 * surveys the two-page fixture shop, filters, checks product pages and
 * returns a shortlist. It runs against headless Chrome over MCP and against
 * the desktop app's Spaces, from this one table, so both engines must agree.
 */

export interface ShopChecked {
  pages: number;
  harvested: number;
  checked: Array<{ url: string; data?: { name?: string; price?: string; stock?: string }; error?: string }>;
}

export function shopSurveyScript(shopUrl: string): string {
  return `
const want = { query: 'running shoe', budget: 120, minRating: 4.3 };
await space.open(${JSON.stringify(shopUrl)});
await space.logStep('Surveying the shop');
const found = await space.survey({ ...want, maxPages: 2 });
const fits = found.shortlist
  .map((c) => c.item)
  .filter((item) => (item.numericPrice ?? Infinity) <= want.budget && (item.numericRating ?? 0) >= want.minRating && !item.isOutOfStock);
const checked = await space.mapPages(fits.slice(0, 3).map((item) => item.linkUrl!), (page) => ({ name: page.product?.name, price: page.product?.price, stock: page.product?.availability }));
return { pages: found.stats.pages, harvested: found.stats.harvested, checked };`;
}

export function expectShopShortlist(json: ShopChecked): void {
  expect(json.pages).toBe(2);
  expect(json.harvested).toBe(16);
  const names = json.checked.map((entry) => entry.data?.name);
  expect(names).toContain('Harbor Run running shoe');
  expect(names).toContain('Aurora Max running shoe');
  expect(json.checked.every((entry) => entry.error === undefined && /^USD \d+\.\d\d$/.test(entry.data?.price ?? ''))).toBe(true);
  expect(json.checked.some((entry) => entry.data?.name === 'Cloud Step running shoe')).toBe(false);
}
