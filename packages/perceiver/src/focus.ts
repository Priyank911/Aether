import { captureWarnings, estimateTokens, indent, isBlankRow, nodeLine } from './format.js';
import { isScope } from './roles.js';
import { lookHint } from './skim.js';
import { StaleRefError } from './stale.js';
import type { PageModel, PageNode, RenderResult } from './types.js';

export const FOCUS_BUDGET = 1500;
const RUN_COLLAPSE_AT = 6;
const RUN_KEEP = 3;

interface Entry {
  text: string;
  ref?: string;
}

/**
 * Flatten a subtree in document order. Direct children of the focused node are
 * never collapsed, so paging walks through them; deeper runs collapse with a
 * pointer to their container.
 */
function flatten(root: PageNode): Entry[] {
  const entries: Entry[] = [];
  const emit = (node: PageNode, depth: number): void => {
    entries.push({ text: `${indent(depth)}${nodeLine(node)}`, ref: node.ref });
    if (node.role === 'row') return;
    emitChildren(node, depth + 1, node !== root);
  };
  const emitChildren = (parent: PageNode, depth: number, collapse: boolean): void => {
    const children = parent.children.filter((child) => !isBlankRow(child));
    let start = 0;
    while (start < children.length) {
      const first = children[start];
      if (!first) break;
      let end = start + 1;
      const collapsible = collapse && !isScope(first.role) && first.role !== 'row';
      while (collapsible && end < children.length && children[end]?.role === first.role) end++;
      const run = end - start;
      const keep = collapsible && run >= RUN_COLLAPSE_AT ? RUN_KEEP : run;
      for (let index = start; index < start + keep; index++) {
        const child = children[index];
        if (child) emit(child, depth);
      }
      if (keep < run) {
        entries.push({ text: `${indent(depth)}... ${run - keep} more ${first.role}: ${lookHint(parent.ref)}` });
      }
      start = end;
    }
  };
  emit(root, 0);
  return entries;
}

/** The full subtree of one ref, regardless of the viewport, paged by ref. */
export function renderFocus(model: PageModel, ref: string, after?: string, budget = FOCUS_BUDGET): RenderResult {
  const node = model.byRef.get(ref);
  if (!node) throw new StaleRefError(ref);
  const entries = flatten(node);

  let start = 0;
  const out: string[] = [];
  if (after) {
    const position = entries.findIndex((entry) => entry.ref === after);
    if (position < 0) throw new Error(`after=${after} is not inside [${ref}]; call look ref=${ref} without after`);
    start = position + 1;
    out.push(`[${ref}] ${node.role} continued after ${after}`);
  }

  let used = estimateTokens(out.join('\n'));
  let lastRef: string | undefined;
  let index = start;
  for (; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry) break;
    const cost = estimateTokens(entry.text) + 1;
    if (used + cost > budget - 20 && index > start) break;
    out.push(entry.text);
    used += cost;
    if (entry.ref) lastRef = entry.ref;
  }
  if (index < entries.length) {
    out.push(`... ${entries.length - index} more lines: ${lookHint(ref, lastRef)}`);
  }
  const text = out.join('\n');
  return { text, tokens: estimateTokens(text), warnings: captureWarnings(model) };
}
