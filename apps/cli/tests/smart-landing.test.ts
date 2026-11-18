import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { AetherConfigSchema, type AetherConfig, type CookieBannerMode } from '@aether/shared';
import { MCPBrowserSession, type ToolOutput } from '@aether/engine';

/**
 * Smart Landing (plan 3.1, section 6.1, decision D3): every open settles the
 * page, answers a cookie banner the way the person's setting says, and labels
 * the page type. A sign-in wall that mentions cookies is never touched.
 */
describe('Smart Landing', () => {
  let fixtures: FixtureServers;
  let session: MCPBrowserSession;
  let config: AetherConfig = AetherConfigSchema.parse({});

  beforeAll(async () => {
    fixtures = await startFixtureServers(4161, 4162);
    session = await MCPBrowserSession.launch({ headless: true, ephemeral: true, config: { read: () => config } });
  }, 60000);

  afterAll(async () => {
    await session?.close();
    await fixtures?.close();
  });

  async function land(page: string, mode: CookieBannerMode): Promise<{ output: ToolOutput; choice: string }> {
    config = AetherConfigSchema.parse({ cookieBanners: mode });
    const output = await session.open({ url: `${fixtures.mainBaseUrl}/consent/${page}.html` });
    const read = await session.look({ as: 'text' });
    const choice = /Cookie choice: ([\w-]+)/.exec(read.page ?? '')?.[1] ?? 'none';
    return { output, choice };
  }

  it('rejects optional cookies in a modal consent dialog by default, and the agent sees the page without it', async () => {
    const { output, choice } = await land('modal', 'reject');
    expect(choice).toBe('rejected');
    expect(output.notes[0]).toMatch(/^closed a cookie banner \(rejected optional cookies\) in \d+ ms$/);
    expect(output.page).not.toContain('Accept all');
    expect(output.page).toContain('Harbour town council');
  });

  it('finds the refuse option in a bar that is not a dialog ("Only necessary")', async () => {
    const { output, choice } = await land('bar', 'reject');
    expect(choice).toBe('rejected');
    expect(output.notes[0]).toMatch(/^closed a cookie banner \(rejected optional cookies\)/);
  });

  it('never accepts for the person when there is no way to refuse', async () => {
    const { output, choice } = await land('acceptOnly', 'reject');
    expect(choice).toBe('none');
    expect(output.notes[0]).toMatch(/^cookie banner has no option to refuse optional cookies, so it was left as it is \(your setting: reject\): accept \[e\d+\]$/);
  });

  it('accepts when the person chose accept', async () => {
    const { output, choice } = await land('modal', 'accept');
    expect(choice).toBe('accepted');
    expect(output.notes[0]).toMatch(/^closed a cookie banner \(accepted cookies\)/);
  });

  it('leaves banners alone when the setting is off, and tells the agent where the banner is', async () => {
    const { output, choice } = await land('modal', 'off');
    expect(choice).toBe('none');
    expect(output.notes[0]).toMatch(/^cookie banner left as it is \(your setting\): \[e\d+\] reject \[e\d+\], accept \[e\d+\], settings \[e\d+\]$/);
  });

  it('never treats a sign-in wall that mentions cookies as a consent banner', async () => {
    const { output, choice } = await land('signIn', 'accept');
    expect(choice).toBe('none');
    expect(output.notes.some((note) => /cookie banner/.test(note))).toBe(false);
    expect(output.page).toContain('Agree and continue');
  });

  it('labels the page type: listing, product, form and article', async () => {
    config = AetherConfigSchema.parse({});
    const listing = await session.open({ url: `${fixtures.mainBaseUrl}/shop/list?page=1` });
    expect(listing.landing?.archetype).toBe('listing');
    const product = await session.open({ url: `${fixtures.mainBaseUrl}/shop/item/13` });
    expect(product.landing?.archetype).toBe('product');
    expect(product.landing?.product?.price).toBe('USD 99.00');
    const form = await session.open({ url: `${fixtures.mainBaseUrl}/form.html` });
    expect(form.landing?.archetype).toBe('form');
    const article = await session.open({ url: `${fixtures.mainBaseUrl}/long-page.html` });
    expect(['article', 'listing']).toContain(article.landing?.archetype);
  }, 60000);
});
