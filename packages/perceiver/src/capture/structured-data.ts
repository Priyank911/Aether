import type { CDPSession } from '@aether/cdp';
import type { ProductFacts } from '../items.js';

const READ_JSON_LD = `Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20).map((script) => script.textContent || '')`;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  const record = asRecord(value);
  return record ? text(record.name) : undefined;
}

function isProduct(node: Json): boolean {
  const type = node['@type'];
  return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
}

/** Every object in a JSON-LD document, including inside @graph and arrays. */
function flatten(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) {
    for (const entry of value) flatten(entry, out);
    return out;
  }
  const record = asRecord(value);
  if (!record) return out;
  out.push(record);
  if (Array.isArray(record['@graph'])) flatten(record['@graph'], out);
  return out;
}

function availability(value: unknown): string | undefined {
  const raw = text(value);
  return raw?.replace(/^https?:\/\/schema\.org\//i, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function offerFacts(offers: unknown): Pick<ProductFacts, 'price' | 'priceRange' | 'availability' | 'seller' | 'offers'> {
  const list = Array.isArray(offers) ? offers.map(asRecord).filter((offer): offer is Json => Boolean(offer)) : [asRecord(offers)].filter((offer): offer is Json => Boolean(offer));
  const first = list[0];
  if (!first) return {};
  const currency = text(first.priceCurrency) ?? '';
  if (first['@type'] === 'AggregateOffer') {
    const low = text(first.lowPrice);
    const high = text(first.highPrice);
    return {
      priceRange: low && high ? `${currency} ${low} to ${high}`.trim() : undefined,
      price: !high ? (low ? `${currency} ${low}`.trim() : undefined) : undefined,
      offers: Number(text(first.offerCount)) || undefined,
      availability: availability(first.availability),
    };
  }
  const price = text(first.price) ?? text(asRecord(first.priceSpecification)?.price);
  return {
    price: price ? `${currency} ${price}`.trim() : undefined,
    availability: availability(first.availability),
    seller: text(first.seller),
    offers: list.length > 1 ? list.length : undefined,
  };
}

/**
 * The schema.org Product a page declares in JSON-LD, if any. Present on many
 * product detail pages, rarely on listings; page-declared, so it is treated as
 * untrusted page content like everything else.
 */
export async function readProductFacts(session: CDPSession): Promise<ProductFacts | undefined> {
  let documents: string[] = [];
  try {
    const result = await session.send<{ result: { value?: string[] } }>('Runtime.evaluate', { expression: READ_JSON_LD, returnByValue: true });
    documents = result.result.value ?? [];
  } catch {
    return undefined;
  }
  for (const raw of documents) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const product = flatten(parsed).find(isProduct);
    if (!product) continue;
    const rating = asRecord(product.aggregateRating);
    return {
      name: text(product.name),
      brand: text(product.brand),
      rating: text(rating?.ratingValue),
      reviewCount: text(rating?.reviewCount) ?? text(rating?.ratingCount),
      ...offerFacts(product.offers),
    };
  }
  return undefined;
}
