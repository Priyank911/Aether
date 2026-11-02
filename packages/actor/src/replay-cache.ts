import { createHash, randomUUID } from 'node:crypto';
import type { ActionItem, ParsedElement, ReplayEntry } from '@aether/shared';

export class ReplayCache {
  private readonly entries = new Map<string, ReplayEntry>();

  /**
   * Compute a deterministic structural hash from a list of elements.
   * Based on roles, names, and backend node structure.
   */
  public static computeStructureHash(elements: ParsedElement[]): string {
    const signature = elements
      .map((e) => `${e.role}:${e.backendDOMNodeId}:${e.name}`)
      .join('|');
    return createHash('sha1').update(signature).digest('hex');
  }

  /**
   * Build the lookup key.
   */
  private static makeKey(site: string, goal: string, structureHash: string): string {
    const normalizedSite = site.trim().toLowerCase();
    const normalizedGoal = goal.trim().toLowerCase();
    return `${normalizedSite}::${normalizedGoal}::${structureHash}`;
  }

  /**
   * Look up a cached action sequence. Returns actions if a cache hit exists.
   */
  public get(site: string, goal: string, structureHash: string): ActionItem[] | undefined {
    const key = ReplayCache.makeKey(site, goal, structureHash);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.hitCount++;
    return entry.actions.map((a) => ({ ...a }));
  }

  /**
   * Record a successful action sequence into the replay cache.
   */
  public record(
    site: string,
    goal: string,
    structureHash: string,
    actions: ActionItem[],
  ): ReplayEntry {
    const key = ReplayCache.makeKey(site, goal, structureHash);
    const entry: ReplayEntry = {
      id: randomUUID(),
      site: site.trim().toLowerCase(),
      goal: goal.trim().toLowerCase(),
      structureHash,
      actions: actions.map((a) => ({ ...a })),
      timestamp: Date.now(),
      hitCount: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Invalidate entries matching a site or goal.
   */
  public invalidate(site: string, goal?: string): boolean {
    const normalizedSite = site.trim().toLowerCase();
    const normalizedGoal = goal?.trim().toLowerCase();
    let removed = false;

    for (const [key, entry] of this.entries.entries()) {
      if (entry.site === normalizedSite) {
        if (!normalizedGoal || entry.goal === normalizedGoal) {
          this.entries.delete(key);
          removed = true;
        }
      }
    }
    return removed;
  }

  /**
   * Total number of cached replay entries.
   */
  public size(): number {
    return this.entries.size;
  }

  /**
   * Clear all cached replay sequences.
   */
  public clear(): void {
    this.entries.clear();
  }
}
