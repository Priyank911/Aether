import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { call } from './helpers.js';

describe('Procedural Harvest & Graph Matcher with look as=survey', () => {
  let fixtures: FixtureServers;
  let client: Client;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4151, 4152);
    client = new Client({ name: 'aether-survey-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          path.resolve('node_modules/tsx/dist/cli.mjs'),
          path.resolve('apps/cli/src/index.ts'),
          'mcp',
          '--headless',
          '--direct',
        ],
        cwd: process.cwd(),
        stderr: 'inherit',
      }),
    );
  }, 45000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
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
