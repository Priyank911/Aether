import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { MCPBrowserSession } from '@aether/engine';
import { engineClient, type EngineClient } from './engine-client.js';
import { call } from './helpers.js';

describe('Procedural Harvest & Graph Matcher with look as=survey', () => {
  let fixtures: FixtureServers;
  let session: MCPBrowserSession;
  let client: EngineClient;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4171, 4172);
    session = await MCPBrowserSession.launch({ headless: true, ephemeral: true });
    client = engineClient(session);
  }, 45000);

  afterAll(async () => {
    await session?.close();
    await fixtures?.close();
  });

  it('autonomously crawls pages into item bucket and graph-matches under budget', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/shop/list?page=1` });

    // Procedural survey: crawl up to 2 pages, budget max $100
    const result = await call(client, 'look', {
      as: 'survey',
      query: 'running shoe under 100',
      max_pages: 2,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/surveyed 2 page\(s\) into item bucket/i);

    // Verify candidates are shortlisted
    expect(result.text).toContain('TOP 3 SHORTLISTED CANDIDATES');
    // Harbor Run ($89) and Aurora Max ($99, 4.8/5) should be top candidates
    expect(result.text).toMatch(/Harbor Run/i);
    expect(result.text).toMatch(/Aurora Max/i);

    // Verify outliers were pruned
    expect(result.text).toContain('Pruned');
    expect(result.text).toMatch(/exceeds budget limit \$100/i);

    // Verify token efficiency: whole 2-page harvest report is well under 700 tokens
    const lines = result.text.split('\n');
    expect(lines.length).toBeLessThan(35);
  }, 60000);

  it('prunes items matching negative terms from natural language query', async () => {
    await call(client, 'open', { url: `${fixtures.mainBaseUrl}/shop/list?page=1` });

    // Exclude Trail and Pace
    const result = await call(client, 'look', {
      as: 'survey',
      query: 'running shoe under 150 without Trail',
      max_pages: 1,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/pruned.*matches negative term "trail"/i);
    const shortlistSection = result.text.split('Pruned')[0] ?? '';
    expect(shortlistSection).not.toMatch(/Trail Runner/i);
  }, 45000);
});
