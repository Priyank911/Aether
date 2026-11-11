import { CAPTCHA_FRAME_PATTERN } from '@aether/shared';
import { NodeCounts } from './counts.js';
import { captureWarnings, estimateTokens, indent, isBlankRow, nodeLine, quote, truncate } from './format.js';
import { DIALOG_ROLES, INTERACTIVE_ROLES, isScope, LIST_ROLES, TABLE_ROLES } from './roles.js';
import type { PageModel, PageNode, RenderResult } from './types.js';

export const SKIM_BUDGET = 1200;
const RUN_COLLAPSE_AT = 6;
const RUN_KEEP = 3;
const FOOTER_RESERVE = 40;
const MAX_DEMOTIONS = 60;
const UNCOVERED_SHOWN = 6;

/** Lower collapses first when the skim is over budget. Main and dialogs never collapse. */
const DEMOTION_ORDER: Record<string, number> = {
  contentinfo: 1,
  navigation: 2,
  complementary: 3,
  banner: 4,
  search: 5,
  region: 6,
  form: 7,
  frame: 8,
};

interface OutLine {
  text: string;
  ref?: string;
}

interface Section {
  node?: PageNode;
  lines: OutLine[];
}

export function lookHint(ref: string | undefined, after?: string): string {
  if (!ref) return 'use find';
  return `look ref=${ref}${after ? ` after=${after}` : ''}`;
}

function lastRefIn(lines: OutLine[], from = 0): string | undefined {
  for (let index = lines.length - 1; index >= from; index--) {
    const ref = lines[index]?.ref;
    if (ref) return ref;
  }
  return undefined;
}

function summaryLine(node: PageNode, depth = 0): OutLine {
  const counts = new NodeCounts();
  for (const child of node.children) counts.addSubtree(child);
  return { text: `${indent(depth)}${nodeLine(node)}: ${counts.describeItems()}: ${lookHint(node.ref)}`, ref: node.ref };
}

class InViewIndex {
  private readonly memo = new Map<PageNode, boolean>();

  public has(node: PageNode): boolean {
    const known = this.memo.get(node);
    if (known !== undefined) return known;
    const result = node.visibility === 'in' || node.children.some((child) => this.has(child));
    this.memo.set(node, result);
    return result;
  }
}

class SkimRenderer {
  constructor(
    private readonly inView: InViewIndex,
    private readonly collapsed: ReadonlySet<PageNode>,
    private readonly skip: ReadonlySet<PageNode>,
  ) {}

  public renderScope(node: PageNode, depth: number, out: OutLine[]): void {
    if (this.collapsed.has(node) && node.ref) {
      out.push(summaryLine(node, depth));
      return;
    }
    const counts = new NodeCounts();
    const inner: OutLine[] = [];
    this.renderChildren(node.children, depth + 1, counts, node.ref, inner);
    const head = `${indent(depth)}${nodeLine(node)}`;
    if (inner.length > 0) {
      out.push({ text: head, ref: node.ref }, ...inner);
      if (counts.total > 0) {
        out.push({ text: `${indent(depth + 1)}... ${counts.describeOutOfView()}: ${lookHint(node.ref)}` });
      }
    } else if (counts.total > 0) {
      out.push({ text: `${head}: ${counts.describeOutOfView()}`, ref: node.ref });
    } else if (node.visibility === 'in' && node.name) {
      out.push({ text: head, ref: node.ref });
    }
  }

  public renderChildren(
    children: PageNode[],
    depth: number,
    counts: NodeCounts,
    containerRef: string | undefined,
    out: OutLine[],
  ): void {
    const shown: PageNode[] = [];
    for (const child of children) {
      if (this.skip.has(child) || isBlankRow(child)) continue;
      if (this.inView.has(child)) shown.push(child);
      else counts.addSubtree(child);
    }
    let start = 0;
    while (start < shown.length) {
      const first = shown[start];
      if (!first) break;
      let end = start + 1;
      const collapsible = !isScope(first.role) && first.role !== 'row';
      while (collapsible && end < shown.length && shown[end]?.role === first.role) end++;
      const run = end - start;
      const keep = collapsible && run >= RUN_COLLAPSE_AT ? RUN_KEEP : run;
      for (let index = start; index < start + keep; index++) {
        const node = shown[index];
        if (node) this.renderNode(node, depth, counts, containerRef, out);
      }
      if (keep < run) {
        const lastShown = shown[start + keep - 1]?.ref;
        out.push({ text: `${indent(depth)}... ${run - keep} more ${first.role} in view: ${lookHint(containerRef, lastShown)}` });
      }
      start = end;
    }
  }

  private renderNode(node: PageNode, depth: number, counts: NodeCounts, containerRef: string | undefined, out: OutLine[]): void {
    if (isScope(node.role)) {
      this.renderScope(node, depth, out);
      return;
    }
    const headIndex = out.length;
    out.push({ text: `${indent(depth)}${nodeLine(node)}`, ref: node.ref });
    if (node.role === 'row') return;
    if (!node.ref) {
      this.renderChildren(node.children, depth + 1, counts, containerRef, out);
      return;
    }
    // A container with a ref keeps its own out-of-view summary, so the model can page through it.
    const local = new NodeCounts();
    this.renderChildren(node.children, depth + 1, local, node.ref, out);
    if (local.total > 0) {
      out.push({
        text: `${indent(depth + 1)}... ${local.describeOutOfView()}: ${lookHint(node.ref, lastRefIn(out, headIndex + 1))}`,
      });
    } else if (out.length === headIndex + 1 && !node.name && (LIST_ROLES.has(node.role) || TABLE_ROLES.has(node.role))) {
      out.pop();
    }
  }
}

function collectDialogs(roots: PageNode[], inView: InViewIndex): PageNode[] {
  const found: PageNode[] = [];
  const visit = (node: PageNode): void => {
    if (DIALOG_ROLES.has(node.role) && inView.has(node)) {
      found.push(node);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return found;
}

function collectDemotable(roots: PageNode[], inView: InViewIndex): PageNode[] {
  const found: PageNode[] = [];
  const sizes = new Map<PageNode, number>();
  const visit = (node: PageNode): number => {
    let size = node.ref ? 1 : 0;
    for (const child of node.children) size += visit(child);
    if (isScope(node.role) && node.ref && node.role !== 'main' && !DIALOG_ROLES.has(node.role) && inView.has(node)) {
      found.push(node);
      sizes.set(node, size);
    }
    return size;
  };
  for (const root of roots) visit(root);
  return found.sort(
    (a, b) =>
      (DEMOTION_ORDER[a.role] ?? 8) - (DEMOTION_ORDER[b.role] ?? 8) || (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0),
  );
}

/** When most controls in view are covered, say so and name the controls still reachable, which usually belong to the overlay. */
function overlayWarning(model: PageModel): string[] {
  const inView: PageNode[] = [];
  let covered = 0;
  for (const ref of model.order) {
    const node = model.byRef.get(ref);
    if (!node || !INTERACTIVE_ROLES.has(node.role) || node.visibility !== 'in') continue;
    inView.push(node);
    if (node.states.includes('covered')) covered++;
  }
  if (covered < 3 || covered * 2 < inView.length) return [];
  const reachable = inView.filter((node) => !node.states.includes('covered'));
  const lines = [`! ${covered} of ${inView.length} controls in view are covered by an overlay`];
  if (reachable.length > 0) {
    const shown = reachable.slice(0, UNCOVERED_SHOWN).map((node) => nodeLine(node));
    const more = reachable.length > UNCOVERED_SHOWN ? ` | ${reachable.length - UNCOVERED_SHOWN} more` : '';
    lines.push(`! reachable: ${shown.join(' | ')}${more}`);
  }
  return lines;
}

function buildSections(model: PageModel, renderer: SkimRenderer, dialogs: PageNode[]): Section[] {
  const sections: Section[] = [];
  for (const dialog of dialogs) {
    const lines: OutLine[] = [];
    renderer.renderScope(dialog, 0, lines);
    sections.push({ node: dialog, lines });
  }
  const pageCounts = new NodeCounts();
  let loose: PageNode[] = [];
  const flushLoose = (): void => {
    if (loose.length === 0) return;
    const lines: OutLine[] = [];
    renderer.renderChildren(loose, 0, pageCounts, undefined, lines);
    if (lines.length > 0) sections.push({ lines });
    loose = [];
  };
  for (const root of model.roots) {
    if (dialogs.includes(root)) continue;
    if (isScope(root.role)) {
      flushLoose();
      const lines: OutLine[] = [];
      renderer.renderScope(root, 0, lines);
      if (lines.length > 0) sections.push({ node: root, lines });
    } else {
      loose.push(root);
    }
  }
  flushLoose();
  if (pageCounts.total > 0) sections.push({ lines: [{ text: `... page: ${pageCounts.describeOutOfView()}: use find` }] });
  return sections;
}

function countTokens(header: string[], sections: Section[]): number {
  return estimateTokens([...header, ...sections.flatMap((section) => section.lines.map((line) => line.text))].join('\n'));
}

/** Nearest ancestor ref for every ref, so a cut can point at the container to page through. */
function containerRefs(roots: PageNode[]): Map<string, string> {
  const parents = new Map<string, string>();
  const walk = (node: PageNode, container: string | undefined): void => {
    if (node.ref && container) parents.set(node.ref, container);
    for (const child of node.children) walk(child, node.ref ?? container);
  };
  for (const root of roots) walk(root, undefined);
  return parents;
}

/** Last resort: keep lines in order until the budget, then point at the container of the last line shown. */
function cut(header: string[], sections: Section[], budget: number, parents: Map<string, string>): Section[] {
  let used = estimateTokens(header.join('\n'));
  const result: Section[] = [];
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (!section) continue;
    const kept: OutLine[] = [];
    let full = true;
    for (const line of section.lines) {
      const cost = estimateTokens(line.text) + 1;
      if (used + cost > budget - FOOTER_RESERVE) {
        full = false;
        break;
      }
      kept.push(line);
      used += cost;
    }
    if (full) {
      result.push(section);
      continue;
    }
    const remaining = section.lines.length - kept.length;
    const lastRef = lastRefIn(kept);
    const container = (lastRef && parents.get(lastRef)) ?? section.node?.ref;
    kept.push({ text: `... ${remaining} more lines in view: ${lookHint(container, lastRef)}` });
    result.push({ node: section.node, lines: kept });
    for (const later of sections.slice(index + 1)) {
      if (later.node?.ref && !DIALOG_ROLES.has(later.node.role)) result.push({ node: later.node, lines: [summaryLine(later.node)] });
    }
    break;
  }
  return result;
}

/**
 * The glance: what is in the viewport, grouped by region, with one summary line
 * per region for what lies outside it. Over budget, the least useful regions
 * collapse to one line each, then the rest is cut with a pointer; nothing is
 * dropped without a line that names where it is.
 */
export function renderSkim(model: PageModel, budget = SKIM_BUDGET): RenderResult {
  const header = [
    `page ${truncate(model.url, 200)} ${quote(model.title)} frames=${model.frames.length} scroll=${model.scrollPercent}%`,
    ...overlayWarning(model),
    ...(model.frames.some((frame) => CAPTCHA_FRAME_PATTERN.test(frame.url))
      ? ['! a CAPTCHA is on the page: hand it to the person with ask']
      : []),
  ];
  const inView = new InViewIndex();
  const dialogs = collectDialogs(model.roots, inView);
  const skip = new Set(dialogs);
  const collapsed = new Set<PageNode>();

  let sections = buildSections(model, new SkimRenderer(inView, collapsed, skip), dialogs);
  if (countTokens(header, sections) > budget) {
    const candidates = collectDemotable(model.roots, inView).slice(0, MAX_DEMOTIONS);
    for (const candidate of candidates) {
      collapsed.add(candidate);
      sections = buildSections(model, new SkimRenderer(inView, collapsed, skip), dialogs);
      if (countTokens(header, sections) <= budget) break;
    }
  }
  if (countTokens(header, sections) > budget) sections = cut(header, sections, budget, containerRefs(model.roots));

  const text = [...header, ...sections.flatMap((section) => section.lines.map((line) => line.text))].join('\n');
  return { text, tokens: estimateTokens(text), warnings: captureWarnings(model) };
}
