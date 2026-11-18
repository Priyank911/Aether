import type { PageModel } from '@aether/perceiver';
import type { ActParams } from '@aether/shared';
import { siteOf } from '@aether/memory';

const MAX_STEPS_PER_SITE = 30;

function quoteName(name: string): string {
  return `"${name.replace(/\s+/g, ' ').trim().slice(0, 60).replace(/"/g, "'")}"`;
}

/**
 * What the agent did on each site in this run, as engine-written lines with
 * roles and names but no refs and no typed values, so a stored route carries
 * no personal data and no page text beyond element names.
 */
export class ActionLog {
  private readonly bySite = new Map<string, { goal: string; steps: string[] }>();
  /** Sites whose stored route was offered to the agent in this run. */
  public readonly advertised = new Set<string>();

  public recordOpen(url: string): void {
    let path = url;
    try {
      const parsed = new URL(url);
      path = `${parsed.origin}${parsed.pathname}`;
    } catch {
      // keep the raw string
    }
    this.add(url, undefined, `open ${path}`);
  }

  public recordActions(model: PageModel, params: ActParams, executed: number): void {
    for (const action of params.actions.slice(0, executed)) {
      const node = action.ref ? model.byRef.get(action.ref) : undefined;
      const target = node ? `${node.role} ${quoteName(node.name)}` : '';
      const extra = action.op === 'key' || action.op === 'scroll' ? ` ${action.value ?? ''}`.trimEnd() : '';
      this.add(model.url, params.why, `${action.op}${target ? ` ${target}` : ''}${extra}`);
    }
  }

  public entries(): Array<{ site: string; goal: string; steps: string[] }> {
    return [...this.bySite.entries()].map(([site, entry]) => ({ site, goal: entry.goal || `visit ${site}`, steps: entry.steps }));
  }

  public clear(): void {
    this.bySite.clear();
    this.advertised.clear();
  }

  /** The goal of a site's route is the agent's reason for its first action there. */
  private add(url: string, why: string | undefined, line: string): void {
    const site = siteOf(url);
    if (!site) return;
    const entry = this.bySite.get(site) ?? { goal: '', steps: [] };
    if (!entry.goal && why) entry.goal = why.slice(0, 120);
    if (entry.steps.length < MAX_STEPS_PER_SITE && entry.steps.at(-1) !== line) entry.steps.push(line);
    this.bySite.set(site, entry);
  }
}
