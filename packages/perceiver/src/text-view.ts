import { captureWarnings, estimateTokens, truncate } from './format.js';
import { StaleRefError } from './stale.js';
import type { PageModel, RenderResult } from './types.js';

export const TEXT_BUDGET = 2000;

function parseCursor(after: string | undefined): number {
  if (after === undefined) return 0;
  const match = /^t(\d+)$/.exec(after);
  if (!match?.[1]) throw new Error(`after for text must be a cursor like t40, got ${after}`);
  return Number.parseInt(match[1], 10);
}

/** Readable text of the page or of one region, with refs on links and controls, paged by line cursor. */
export function renderText(model: PageModel, ref?: string, after?: string, budget = TEXT_BUDGET): RenderResult {
  if (ref && !model.byRef.has(ref)) throw new StaleRefError(ref);
  const lines = ref ? model.lines.filter((line) => line.path.includes(ref)) : model.lines;
  const start = parseCursor(after);

  const out = [`text of ${ref ? `[${ref}]` : truncate(model.url, 200)}${start > 0 ? ` from t${start}` : ''}`];
  let used = estimateTokens(out[0] ?? '');
  let previous = '';
  let index = start;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (!line) break;
    if (line.linked === previous) continue;
    const cost = estimateTokens(line.linked) + 1;
    if (used + cost > budget - 20 && index > start) break;
    out.push(line.linked);
    used += cost;
    previous = line.linked;
  }
  if (out.length === 1) out.push('(no text)');
  if (index < lines.length) {
    out.push(`... more text: look${ref ? ` ref=${ref}` : ''} as=text after=t${index}`);
  }
  const text = out.join('\n');
  return { text, tokens: estimateTokens(text), warnings: captureWarnings(model) };
}
