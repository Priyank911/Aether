import { estimateTokens, nodeLine, quote } from './format.js';
import { renderSkim } from './skim.js';
import type { PageModel, PageNode } from './types.js';

/** Above this share of changed elements, and at least MIN_BULK_CHANGES of them, the page counts as replaced. */
export const FULL_SKIM_CHANGE_RATIO = 0.4;
const MIN_BULK_CHANGES = 10;
const ELEMENT_LINE_CAP = 30;
const TEXT_LINE_CAP = 12;

export interface PageDelta {
  /** True when a full skim replaces the delta. */
  full: boolean;
  reason?: string;
  lines: string[];
  urlChanged: boolean;
  url: string;
  scrollFrom: number;
  scrollTo: number;
}

function signature(node: PageNode): string {
  return [node.role, node.name, node.value ?? '', node.states.join(',')].join('\u0000');
}

function frameSet(model: PageModel): string {
  return model.frames
    .map((frame) => frame.frameId)
    .sort()
    .join(',');
}

function textChanges(prev: PageModel, curr: PageModel, elementNames: Set<string>): string[] {
  const remaining = new Map<string, number>();
  for (const line of prev.lines) {
    if (line.plain) remaining.set(line.plain, (remaining.get(line.plain) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const line of curr.lines) {
    if (!line.plain) continue;
    const count = remaining.get(line.plain) ?? 0;
    if (count > 0) remaining.set(line.plain, count - 1);
    else added.push(line.plain);
  }
  const removed: string[] = [];
  for (const [text, count] of remaining) {
    for (let index = 0; index < count; index++) removed.push(text);
  }
  const keep = (text: string): boolean => !elementNames.has(text);
  const lines = [
    ...added.filter(keep).map((text) => `text + ${quote(text, 120)}`),
    ...removed.filter(keep).map((text) => `text - ${quote(text, 120)}`),
  ];
  if (lines.length <= TEXT_LINE_CAP) return lines;
  return [...lines.slice(0, TEXT_LINE_CAP), `... ${lines.length - TEXT_LINE_CAP} more text changes: look as=text`];
}

/**
 * What changed between two captures of the same tab. Element lines use the
 * same format as the skim; text lines report visible text that appeared or
 * went away. A full skim is requested on a new document, a changed frame set,
 * a bulk replacement of the page, or when the delta would be longer than the
 * skim itself.
 */
export function computeDelta(prev: PageModel | undefined, curr: PageModel): PageDelta {
  const base = {
    url: curr.url,
    urlChanged: prev ? prev.url !== curr.url : true,
    scrollFrom: prev?.scrollPercent ?? curr.scrollPercent,
    scrollTo: curr.scrollPercent,
  };
  if (!prev) return { ...base, full: true, reason: 'first look', lines: [] };
  if (prev.documentId !== curr.documentId) return { ...base, full: true, reason: 'new page', lines: [] };
  if (frameSet(prev) !== frameSet(curr)) return { ...base, full: true, reason: 'frames changed', lines: [] };

  const added: PageNode[] = [];
  const changed: PageNode[] = [];
  const removed: PageNode[] = [];
  for (const ref of curr.order) {
    const node = curr.byRef.get(ref);
    if (!node) continue;
    const before = prev.byRef.get(ref);
    if (!before) added.push(node);
    else if (signature(before) !== signature(node)) changed.push(node);
  }
  for (const ref of prev.order) {
    const node = prev.byRef.get(ref);
    if (node && !curr.byRef.has(ref)) removed.push(node);
  }

  const total = added.length + changed.length + removed.length;
  if (total >= MIN_BULK_CHANGES && total / Math.max(1, curr.order.length) > FULL_SKIM_CHANGE_RATIO) {
    return { ...base, full: true, reason: 'most of the page changed', lines: [] };
  }

  const elementLines = [
    ...added.map((node) => `+ ${nodeLine(node)}`),
    ...changed.map((node) => `~ ${nodeLine(node)}`),
    ...removed.map((node) => `- [${node.ref}] ${node.role}${node.name ? ` ${quote(node.name, 40)}` : ''}`),
  ];
  const lines =
    elementLines.length <= ELEMENT_LINE_CAP
      ? elementLines
      : [...elementLines.slice(0, ELEMENT_LINE_CAP), `... ${elementLines.length - ELEMENT_LINE_CAP} more element changes: look or find`];

  const elementNames = new Set([...added, ...changed].map((node) => node.name).filter(Boolean));
  lines.push(...textChanges(prev, curr, elementNames));
  if (estimateTokens(lines.join('\n')) >= renderSkim(curr).tokens) {
    return { ...base, full: true, reason: 'the change is larger than the page', lines: [] };
  }
  return { ...base, full: false, lines };
}
