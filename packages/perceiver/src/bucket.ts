import type { ListingItem } from './items.js';

export interface BucketItem extends ListingItem {
  sourceUrl: string;
  pageNumber: number;
  linkUrl?: string;
  previewSnippet?: string;
  numericPrice?: number;
  numericRating?: number;
  isSponsored: boolean;
  isOutOfStock: boolean;
}

export function parseNumericPrice(priceStr?: string): number | undefined {
  if (!priceStr) return undefined;
  // Match first currency amount e.g. $89.00, 89.00 USD, €120, etc.
  const match = /[$€£¥₹]?\s*(\d[\d,]*(?:\.\d{1,2})?)/.exec(priceStr);
  if (!match || !match[1]) return undefined;
  const cleaned = match[1].replace(/,/g, '');
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) ? val : undefined;
}

export function parseNumericRating(ratingStr?: string): number | undefined {
  if (!ratingStr) return undefined;
  const match = /(\d(?:[.,]\d)?)/.exec(ratingStr);
  if (!match || !match[1]) return undefined;
  const cleaned = match[1].replace(',', '.');
  const val = Number.parseFloat(cleaned);
  return Number.isFinite(val) ? val : undefined;
}

/**
 * Candidate item bucket that aggregates unique items discovered across pages and tabs.
 */
export class ItemBucket {
  private readonly items = new Map<string, BucketItem>();

  public add(item: BucketItem): boolean {
    if (this.items.has(item.key)) {
      return false;
    }
    this.items.set(item.key, item);
    return true;
  }

  public addListingItems(
    items: ListingItem[],
    sourceUrl: string,
    pageNumber: number,
  ): number {
    let addedCount = 0;
    for (const item of items) {
      const numericPrice = item.prices.length > 0 ? parseNumericPrice(item.prices[0]) : undefined;
      const numericRating = parseNumericRating(item.rating);
      const isSponsored = item.notes.some((n) => /sponsored|promoted|ad/i.test(n));
      const isOutOfStock = item.notes.some((n) => /out of stock|unavailable|sold out/i.test(n));

      // Resolve linkUrl if key is a valid path/URL
      let linkUrl: string | undefined;
      try {
        linkUrl = item.key.startsWith('http') ? item.key : `http://${item.key}`;
      } catch {
        linkUrl = undefined;
      }

      const bucketItem: BucketItem = {
        ...item,
        sourceUrl,
        pageNumber,
        linkUrl,
        numericPrice,
        numericRating,
        isSponsored,
        isOutOfStock,
      };

      if (this.add(bucketItem)) {
        addedCount++;
      }
    }
    return addedCount;
  }

  public getAll(): BucketItem[] {
    return Array.from(this.items.values());
  }

  public get(key: string): BucketItem | undefined {
    return this.items.get(key);
  }

  public get size(): number {
    return this.items.size;
  }

  public clear(): void {
    this.items.clear();
  }
}
