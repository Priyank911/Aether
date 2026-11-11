import type { PolicyDecision } from '@aether/shared';
import { classifyNavigation } from './classifier.js';

/** What the run has seen so far, for deciding whether a URL could carry page data out. */
export interface NavigationContext {
  /** Origins the run has already loaded. */
  visitedOrigins: ReadonlySet<string>;
  /** Absolute link targets observed on pages in this run. */
  seenLinks: ReadonlySet<string>;
  /** True once any page content has been returned to the model. */
  hasReadPages: boolean;
}

function withoutHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/**
 * URL provenance (plan section 8.6). A model-built URL that carries data to a
 * new origin is how page content gets exfiltrated after an injection, so it
 * needs approval. Allowed without asking: anything before the run has read a
 * page, origins already visited, URLs observed as links, and URLs with no
 * query string or fragment.
 */
export function classifyOpen(url: string, context: NavigationContext): PolicyDecision {
  const base = classifyNavigation(url);
  if (base.outcome !== 'allow' || url.trim() === 'about:blank') return base;
  const parsed = new URL(url);
  if (!context.hasReadPages) return { outcome: 'allow', reason: 'first page of the run' };
  if (context.visitedOrigins.has(parsed.origin)) return { outcome: 'allow', reason: 'origin already visited' };
  if (context.seenLinks.has(parsed.href) || context.seenLinks.has(withoutHash(parsed))) {
    return { outcome: 'allow', reason: 'link seen on a page' };
  }
  if (!parsed.search && !parsed.hash) return { outcome: 'allow', reason: 'no data in the URL' };
  const data = `${parsed.search}${parsed.hash}`.slice(0, 120);
  return {
    outcome: 'needs_approval',
    reason: `${parsed.origin} is new to this run and the URL carries data (${data}) that did not come from a link on a page`,
  };
}
