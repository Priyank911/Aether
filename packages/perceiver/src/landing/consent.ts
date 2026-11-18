import { EDITABLE_ROLES } from '../roles.js';
import type { PageModel, PageNode } from '../types.js';

/*
 * Cookie consent banners (plan 3.1, section 6.1). A button counts only when
 * its name is one of the consent phrases below and cookie or consent text sits
 * in the same region or right next to it. A region holding input fields is
 * never a consent banner, so a sign-in or paywall dialog with an "Agree and
 * continue" button is never dismissed.
 */

const REJECT = [
  /^(reject|decline|refuse|deny|disagree)( all| all cookies| cookies| optional cookies| non-?essential( cookies)?| additional cookies)?$/,
  /^(only|use only|accept only|allow only|use|allow) (strictly )?(necessary|essential|required)( cookies)?( only)?$/,
  /^(strictly )?(necessary|essential|required) (cookies )?only$/,
  /^continue without (accepting|agreeing)$/,
  /^do not (accept|agree)$/,
];

const ACCEPT = [
  /^(accept|allow|agree|i agree|i accept|ok|okay|got it|yes,? i agree)( all| all cookies| cookies| and continue| & continue| and close| & close)?$/,
  /^(allow|accept) all( and| &) (continue|close)$/,
];

const SETTINGS = /^(manage|customi[sz]e|cookie settings|settings|preferences|more options|options|manage (preferences|options|cookies|settings)|cookie preferences)$/;

const CONSENT_TEXT = /\bcookies?\b|\bconsent\b|\bgdpr\b/i;
const CONTAINER_ROLES = new Set(['dialog', 'alertdialog', 'region', 'banner', 'complementary', 'contentinfo', 'form']);
const NEARBY_LINES = 10;

export interface ConsentBanner {
  /** The dialog or region holding the banner, when it has one. */
  containerRef?: string;
  /** Refuses optional cookies. */
  reject?: PageNode;
  accept?: PageNode;
  settings?: PageNode;
  /** A modal dialog: it blocks the page until answered. */
  modal: boolean;
}

function phrase(node: PageNode): string {
  return node.name.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
}

function kindOf(node: PageNode): 'reject' | 'accept' | 'settings' | undefined {
  if (node.role !== 'button' && node.role !== 'link') return undefined;
  const text = phrase(node);
  if (REJECT.some((pattern) => pattern.test(text))) return 'reject';
  if (ACCEPT.some((pattern) => pattern.test(text))) return 'accept';
  if (SETTINGS.test(text)) return 'settings';
  return undefined;
}

/** Nearest enclosing dialog or region of a ref. */
function containerOf(model: PageModel, ref: string): PageNode | undefined {
  const scope = model.scopeOf.get(ref);
  const node = scope ? model.byRef.get(scope) : undefined;
  return node && CONTAINER_ROLES.has(node.role) ? node : undefined;
}

function subtree(node: PageNode, out: PageNode[] = []): PageNode[] {
  for (const child of node.children) {
    out.push(child);
    subtree(child, out);
  }
  return out;
}

/** Text of the region, or of the lines around the button when it sits in no region. */
function contextText(model: PageModel, ref: string, container: PageNode | undefined, lineOf: Map<string, number>): string {
  if (container?.ref) {
    const scopeRef = container.ref;
    return model.lines
      .filter((line) => line.path.includes(scopeRef))
      .map((line) => line.plain)
      .join(' ')
      .concat(' ', container.name);
  }
  const at = lineOf.get(ref);
  if (at === undefined) return '';
  return model.lines
    .slice(Math.max(0, at - NEARBY_LINES), at + NEARBY_LINES + 1)
    .map((line) => line.plain)
    .join(' ');
}

function lineIndex(model: PageModel): Map<string, number> {
  const index = new Map<string, number>();
  model.lines.forEach((line, at) => {
    for (const match of line.linked.matchAll(/\]\((e\d+)\)/g)) {
      const ref = match[1];
      if (ref && !index.has(ref)) index.set(ref, at);
    }
  });
  return index;
}

/** The cookie consent banner on the page, if there is one in view. */
export function findConsentBanner(model: PageModel): ConsentBanner | undefined {
  const lineOf = lineIndex(model);
  const groups = new Map<string, ConsentBanner & { score: number }>();
  for (const ref of model.order) {
    const node = model.byRef.get(ref);
    if (node?.visibility !== 'in' || node.states.includes('disabled')) continue;
    const kind = kindOf(node);
    if (!kind) continue;
    const container = containerOf(model, ref);
    if (container && subtree(container).some((child) => EDITABLE_ROLES.has(child.role) || child.sensitive)) continue;
    if (!CONSENT_TEXT.test(contextText(model, ref, container, lineOf))) continue;
    const key = container?.ref ?? 'page';
    const group = groups.get(key) ?? { containerRef: container?.ref, modal: Boolean(container?.modal), score: 0 };
    if (!group[kind]) {
      group[kind] = node;
      group.score += kind === 'settings' ? 1 : 2;
    }
    groups.set(key, group);
  }
  const banners = [...groups.values()].filter((group) => group.accept || group.reject);
  banners.sort((a, b) => Number(b.modal) - Number(a.modal) || b.score - a.score);
  const best = banners[0];
  if (!best) return undefined;
  const { score: _score, ...banner } = best;
  return banner;
}
