import { captureWarnings, estimateTokens, nodeLine, quote, truncate } from './format.js';
import type { PageModel, PageNode, RenderResult, TextLine } from './types.js';

export const ITEMS_BUDGET = 2200;
const MIN_ITEMS = 3;
const MAX_SEGMENT_LINES = 14;
const NAV_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search']);

const PRICE = /(?:[$€£¥₹]|US\$|USD|EUR|GBP|INR|Rs\.?)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,.]*\s?(?:USD|EUR|GBP|INR|€|zł|kr|₹)/g;
const RATING = /(\d(?:[.,]\d)?)\s*(?:out of 5|\/\s*5|of 5 stars|stars?)/i;
const REVIEWS = /\(?\s*([\d,.]+\s?[kK]?)\s*(?:ratings?|reviews?|global ratings)\s*\)?/i;
const STOCK = /(out of stock|in stock|only \d+ left(?: in stock)?|currently unavailable|unavailable|sold out|pre-?order)/i;
/** A label line that precedes the card title and belongs to the next item. */
const LEADING_LABEL = /^\s*(sponsored|promoted|ad|best ?seller|deal|new)\s*$/i;
const DELIVERY = /((?:free|fast|next[- ]day|same[- ]day)\s+(?:delivery|shipping)[^.|]{0,28}|delivery\s+(?:by|on|tomorrow)[^.|]{0,24})/i;
const SPONSORED = /\b(sponsored|promoted)\b/i;
export const NEXT_PAGE = /^(next|next page|next ?[›»>→]|[›»→]|go to next page|next results?)$/i;
const MORE = /^(load|show|see|view) more( results| items| products)?$/i;
const RESULT_COUNT = /(\d[\d,.]*\s*(?:\+\s*)?(?:results?|items?|products?|listings?|hotels?|flights?|properties))/i;

/** One listing item found on the page. */
export interface ListingItem {
  key: string;
  ref: string;
  title: string;
  prices: string[];
  rating?: string;
  reviews?: string;
  notes: string[];
  action?: string;
}

/** Facts a product page states about itself in schema.org JSON-LD. */
export interface ProductFacts {
  name?: string;
  brand?: string;
  price?: string;
  priceRange?: string;
  availability?: string;
  rating?: string;
  reviewCount?: string;
  seller?: string;
  offers?: number;
}

/** Path shape of a link, so links to items of one kind group together: /dp/B0XYZ and /itm/123 shapes. */
function shapeOf(href: string): string | undefined {
  try {
    const url = new URL(href);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;
    const kinds = segments.map((segment) => {
      if (/^\d+$/.test(segment)) return '#';
      if (/^[a-z]{2,12}$/i.test(segment) && segments.length > 1) return segment.toLowerCase();
      return '*';
    });
    return `${url.host}/${kinds.join('/')}`;
  } catch {
    return undefined;
  }
}

function itemKey(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname}`;
  } catch {
    return href;
  }
}

function descendantRefs(node: PageNode, out: string[] = []): string[] {
  for (const child of node.children) {
    if (child.ref) out.push(child.ref);
    descendantRefs(child, out);
  }
  return out;
}

/**
 * Refs a text line carries. A heading line prints only its text, so the links
 * inside it, the usual product card title, are taken from the heading node.
 */
function refsIn(model: PageModel, line: TextLine): string[] {
  const refs = [...line.linked.matchAll(/\]\((e\d+)\)/g)].map((match) => match[1] ?? '').filter(Boolean);
  const owner = line.path.at(-1);
  const node = owner ? model.byRef.get(owner) : undefined;
  if (node?.role === 'heading') refs.push(...descendantRefs(node));
  return refs;
}

function insideNavigation(model: PageModel, ref: string): boolean {
  const scope = model.scopeOf.get(ref);
  const node = scope ? model.byRef.get(scope) : undefined;
  return Boolean(node && NAV_ROLES.has(node.role));
}

interface Candidate {
  shape: string;
  refs: Map<string, string>;
  hrefs: Set<string>;
}

/** Group item-like links by path shape, outside navigation regions. */
function candidates(model: PageModel): Candidate[] {
  const groups = new Map<string, Candidate>();
  for (const ref of model.order) {
    const node = model.byRef.get(ref);
    if (!node?.href || node.role !== 'link' || insideNavigation(model, ref)) continue;
    const shape = shapeOf(node.href);
    if (!shape) continue;
    const group = groups.get(shape) ?? { shape, refs: new Map(), hrefs: new Set() };
    group.refs.set(ref, itemKey(node.href));
    group.hrefs.add(itemKey(node.href));
    groups.set(shape, group);
  }
  return [...groups.values()].filter((group) => group.hrefs.size >= MIN_ITEMS);
}

function segment(model: PageModel, group: Candidate): ListingItem[] {
  const items: ListingItem[] = [];
  let current: (ListingItem & { text: string[]; lines: number }) | undefined;
  let carried: string[] = [];
  const finish = (): void => {
    if (!current) return;
    const text = current.text.join(' ');
    current.prices = [...new Set(text.match(PRICE) ?? [])].slice(0, 2);
    current.rating = RATING.exec(text)?.[1];
    current.reviews = REVIEWS.exec(text)?.[1]?.trim();
    const notes = [SPONSORED.exec(text)?.[1]?.toLowerCase(), STOCK.exec(text)?.[1]?.toLowerCase(), DELIVERY.exec(text)?.[1]?.trim()];
    current.notes = notes.filter((note): note is string => Boolean(note));
    const { text: _text, lines: _lines, ...item } = current;
    items.push(item);
    current = undefined;
  };
  for (const line of model.lines) {
    const refs = refsIn(model, line);
    const anchorRef = refs.find((ref) => group.refs.has(ref));
    const key = anchorRef ? group.refs.get(anchorRef) : undefined;
    if (anchorRef && key && key !== current?.key) {
      finish();
      const node = model.byRef.get(anchorRef);
      current = { key, ref: anchorRef, title: node?.name ?? '', prices: [], notes: [], text: carried, lines: 0 };
      carried = [];
    }
    if (!anchorRef && LEADING_LABEL.test(line.plain)) {
      carried.push(line.plain);
      continue;
    }
    if (!current) continue;
    if (anchorRef && key === current.key) {
      const name = model.byRef.get(anchorRef)?.name ?? '';
      if (name.length > current.title.length) {
        current.title = name;
        current.ref = anchorRef;
      }
    }
    current.text.push(line.plain);
    current.lines++;
    if (!current.action) {
      const control = refs.map((ref) => model.byRef.get(ref)).find((node) => node?.role === 'button' && /add|cart|basket|buy|select|choose|book/i.test(node.name));
      if (control?.ref) current.action = control.ref;
    }
    if (current.lines >= MAX_SEGMENT_LINES) finish();
  }
  finish();
  return items.filter((item) => item.title.trim().length > 0);
}

/** The best item group: the one whose segments carry the most item details. */
export function findItems(model: PageModel): ListingItem[] {
  let best: ListingItem[] = [];
  let bestScore = 0;
  for (const group of candidates(model)) {
    const items = segment(model, group);
    const score = items.reduce((sum, item) => sum + 1 + (item.prices.length > 0 ? 2 : 0) + (item.rating ? 1 : 0) + (item.action ? 1 : 0), 0);
    if (score > bestScore) {
      best = items;
      bestScore = score;
    }
  }
  return best;
}

export function findControl(model: PageModel, test: (node: PageNode) => boolean): PageNode | undefined {
  for (const ref of model.order) {
    const node = model.byRef.get(ref);
    if (node && test(node)) return node;
  }
  return undefined;
}

function itemLine(item: ListingItem, index: number): string {
  const parts = [`${index}. [${item.ref}] ${quote(item.title, 90)}`];
  if (item.prices.length > 0) parts.push(item.prices.join(' / '));
  if (item.rating) parts.push(`${item.rating}/5${item.reviews ? ` (${item.reviews})` : ''}`);
  parts.push(...item.notes.map((note) => truncate(note, 40)));
  if (item.action) parts.push(`action [${item.action}]`);
  return parts.join(' | ');
}

function productLines(product: ProductFacts): string[] {
  const facts = [
    product.name && `name: ${product.name}`,
    product.brand && `brand: ${product.brand}`,
    product.price && `price: ${product.price}`,
    product.priceRange && `price range: ${product.priceRange}`,
    product.offers && `offers: ${product.offers}`,
    product.availability && `availability: ${product.availability}`,
    product.rating && `rating: ${product.rating}/5${product.reviewCount ? ` from ${product.reviewCount} reviews` : ''}`,
    product.seller && `seller: ${product.seller}`,
  ].filter((fact): fact is string => Boolean(fact));
  return facts.length > 0 ? ['product data the page declares:', ...facts.map((fact) => `  ${truncate(fact, 140)}`)] : [];
}

export interface ItemsContext {
  product?: ProductFacts;
  /** Distinct items seen in this run before this page. */
  seenBefore?: ReadonlySet<string>;
}

/**
 * Every listing item on the page, one line each, with price, rating, stock and
 * an action ref, plus the controls a careful shopper uses next: result count,
 * sort, filters, next page. On a product page, the product facts it declares.
 */
export function renderItems(model: PageModel, context: ItemsContext = {}, budget = ITEMS_BUDGET): RenderResult {
  const items = findItems(model);
  const out: string[] = [];
  const count = model.lines.map((line) => RESULT_COUNT.exec(line.plain)?.[1]).find(Boolean);
  const fresh = context.seenBefore ? items.filter((item) => !context.seenBefore?.has(item.key)).length : items.length;
  out.push(
    `items on ${truncate(model.url, 160)}: ${items.length} found${count ? `; page says ${count}` : ''}${context.seenBefore ? `; ${fresh} new this run` : ''}`,
  );

  const sort = findControl(model, (node) => (node.role === 'combobox' || node.role === 'button') && /\bsort\b/i.test(node.name));
  if (sort) out.push(`sort: ${nodeLine(sort)}`);
  const next = findControl(model, (node) => (node.role === 'link' || node.role === 'button') && NEXT_PAGE.test(node.name.trim()));
  if (next) out.push(`next page: ${nodeLine(next)}`);
  const more = findControl(model, (node) => node.role === 'button' && MORE.test(node.name.trim()));
  if (more) out.push(`more: ${nodeLine(more)}`);
  if (!next && !more && items.length > 0) out.push('next page: none found on this page');

  out.push(...productLines(context.product ?? {}));

  let used = estimateTokens(out.join('\n'));
  let index = 0;
  for (const item of items) {
    const line = itemLine(item, index + 1);
    const cost = estimateTokens(line) + 1;
    if (used + cost > budget - 30) {
      out.push(`... ${items.length - index} more items: use find, or look ref=<region> for the rest`);
      break;
    }
    out.push(line);
    used += cost;
    index++;
  }
  if (items.length === 0 && !context.product) out.push('no repeated items found; use look or look as=text');

  const text = out.join('\n');
  return { text, tokens: estimateTokens(text), warnings: captureWarnings(model) };
}
