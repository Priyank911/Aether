import type { PageNode, Visibility } from './types.js';

const ROLES_SHOWN = 4;

/** Counts of ref'd nodes by direction and role, for summary lines. */
export class NodeCounts {
  private readonly byDirection = new Map<Visibility, number>();
  private readonly byRole = new Map<string, number>();
  private count = 0;

  public get total(): number {
    return this.count;
  }

  /** Count a subtree, filed under the direction of its root. */
  public addSubtree(node: PageNode, direction: Visibility = node.visibility): void {
    const visit = (current: PageNode): void => {
      if (current.ref) {
        this.count++;
        this.byDirection.set(direction, (this.byDirection.get(direction) ?? 0) + 1);
        this.byRole.set(current.role, (this.byRole.get(current.role) ?? 0) + 1);
      }
      for (const child of current.children) visit(child);
    };
    visit(node);
  }

  public roles(): string {
    const sorted = [...this.byRole.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = sorted.slice(0, ROLES_SHOWN).map(([role, n]) => `${n} ${role}`);
    const rest = sorted.slice(ROLES_SHOWN).reduce((sum, [, n]) => sum + n, 0);
    if (rest > 0) shown.push(`${rest} other`);
    return shown.join(', ');
  }

  /** "38 more below, 4 more above (26 link, 9 button, 3 textbox)". */
  public describeOutOfView(): string {
    const parts: string[] = [];
    const below = this.byDirection.get('below') ?? 0;
    const above = this.byDirection.get('above') ?? 0;
    const offscreen = this.byDirection.get('offscreen') ?? 0;
    const inView = this.byDirection.get('in') ?? 0;
    if (below) parts.push(`${below} more below`);
    if (above) parts.push(`${above} more above`);
    if (offscreen) parts.push(`${offscreen} off-screen`);
    if (inView) parts.push(`${inView} more`);
    return `${parts.join(', ')} (${this.roles()})`;
  }

  /** "120 items (80 link, 30 button)". */
  public describeItems(): string {
    return `${this.count} items (${this.roles()})`;
  }
}
