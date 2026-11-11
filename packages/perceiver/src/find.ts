import { captureWarnings, estimateTokens, nodeLine, quote, visibilityNote } from './format.js';
import type { PageModel, PageNode, RenderResult, Visibility } from './types.js';

export const FIND_LIMIT = 12;

interface Hit {
  score: number;
  isElement: boolean;
  visibility: Visibility;
  order: number;
  ref?: string;
  text: string;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scopeLabel(model: PageModel, ref: string | undefined): string {
  if (!ref) return '';
  const node = model.byRef.get(ref);
  return node ? ` in [${ref}] ${node.role}` : '';
}

function snippet(text: string, query: string): string {
  const position = text.toLocaleLowerCase().indexOf(query);
  if (position < 0) return text;
  const start = Math.max(0, position - 30);
  return `${start > 0 ? '...' : ''}${text.slice(start, position + query.length + 50)}`;
}

/**
 * Search names, values and text across all frames, including content outside
 * the viewport and past any budget. Exact match ranks above word match above
 * substring; elements rank above text on a tie.
 */
export function renderFind(model: PageModel, query: string, role?: string, limit = FIND_LIMIT): RenderResult {
  const needle = normalize(query);
  if (!needle) throw new Error('find needs a non-empty query');
  const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?:$|[^\\p{L}\\p{N}])`, 'u');
  const score = (candidate: string | undefined): number => {
    if (!candidate) return 0;
    const text = normalize(candidate);
    if (text === needle) return 3;
    if (word.test(text)) return 2;
    return text.includes(needle) ? 1 : 0;
  };

  const hits: Hit[] = [];
  const matchedRefs = new Set<string>();
  model.order.forEach((ref, order) => {
    const node: PageNode | undefined = model.byRef.get(ref);
    if (!node || (role && node.role !== role)) return;
    const best = Math.max(score(node.name), node.sensitive ? 0 : score(node.value));
    if (best === 0) return;
    matchedRefs.add(ref);
    hits.push({
      score: best,
      isElement: true,
      visibility: node.visibility,
      order,
      ref,
      text: `${nodeLine(node)}${visibilityNote(node.visibility)}${scopeLabel(model, model.scopeOf.get(ref))}`,
    });
  });

  if (!role || role === 'text') {
    const seenSnippets = new Set<string>();
    model.lines.forEach((line, order) => {
      const best = score(line.plain);
      if (best === 0) return;
      const anchor = line.path[line.path.length - 1];
      if (anchor && matchedRefs.has(anchor)) return;
      const shown = snippet(line.plain, needle);
      if (seenSnippets.has(shown)) return;
      seenSnippets.add(shown);
      hits.push({
        score: best,
        isElement: false,
        visibility: line.visibility,
        order: model.order.length + order,
        text: `text ${quote(shown, 100)}${visibilityNote(line.visibility)}${scopeLabel(model, anchor)}`,
      });
    });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.isElement) - Number(a.isElement) ||
      Number(b.visibility === 'in') - Number(a.visibility === 'in') ||
      a.order - b.order,
  );

  const shown = hits.slice(0, limit);
  const head =
    hits.length === 0
      ? `find ${quote(query)}: no match`
      : `find ${quote(query)}: ${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > limit ? `, best ${limit} shown` : ''}`;
  const text = [head, ...shown.map((hit) => hit.text)].join('\n');
  return { text, tokens: estimateTokens(text), warnings: captureWarnings(model) };
}
