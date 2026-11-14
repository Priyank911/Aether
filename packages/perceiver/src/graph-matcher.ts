import type { BucketItem } from './bucket.js';
import { estimateTokens, quote } from './format.js';

export interface SurveyCriteria {
  query?: string;
  budget?: number;
  minRating?: number;
  negativeTerms?: string[];
  topK?: number;
}

export interface PrunedItem {
  key: string;
  title: string;
  price?: string;
  reason: string;
}

export interface CandidateMatch {
  item: BucketItem;
  score: number;
  highlights: string[];
  previewLink?: string;
}

export interface SurveyMatchResult {
  shortlist: CandidateMatch[];
  pruned: PrunedItem[];
  stats: {
    totalHarvested: number;
    prunedCount: number;
    candidateCount: number;
  };
  text: string;
  tokens: number;
}

function tokenize(text: string): Set<string> {
  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return new Set(terms);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export class ProductGraphMatcher {
  public static evaluate(
    items: BucketItem[],
    criteria: SurveyCriteria = {},
  ): SurveyMatchResult {
    const topK = criteria.topK ?? 3;
    let budget = criteria.budget;
    const negativeTokens = (criteria.negativeTerms ?? []).map((t) => t.toLowerCase());

    if (criteria.query) {
      if (budget === undefined) {
        const bMatch = /(?:under|below|budget|max|<=?|\$)\s?(\d+(?:\.\d+)?)/i.exec(criteria.query);
        if (bMatch?.[1]) budget = Number.parseFloat(bMatch[1]);
      }
      const negMatch = /(?:no|without|exclude|not)\s+([a-z0-9\s,]+)/i.exec(criteria.query);
      if (negMatch?.[1]) {
        const terms = negMatch[1].toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2);
        negativeTokens.push(...terms);
      }
    }

    const queryTokens = criteria.query ? tokenize(criteria.query) : new Set<string>();
    for (const neg of negativeTokens) {
      queryTokens.delete(neg);
    }

    const pruned: PrunedItem[] = [];
    const validCandidates: Array<{ item: BucketItem; tokens: Set<string> }> = [];

    // Step 1: Constraint & Rule Filtering (Pruning Noise & Outliers)
    for (const item of items) {
      const titleLower = item.title.toLowerCase();

      // Negative keyword check
      const matchedNegative = negativeTokens.find((term) => titleLower.includes(term));
      if (matchedNegative) {
        pruned.push({
          key: item.key,
          title: item.title,
          price: item.prices[0],
          reason: `matches negative term "${matchedNegative}"`,
        });
        continue;
      }

      // Budget ceiling check
      if (budget !== undefined && item.numericPrice !== undefined && item.numericPrice > budget) {
        pruned.push({
          key: item.key,
          title: item.title,
          price: item.prices[0],
          reason: `price $${item.numericPrice.toFixed(2)} exceeds budget limit $${budget.toFixed(2)}`,
        });
        continue;
      }

      // Out of stock check
      if (item.isOutOfStock) {
        pruned.push({
          key: item.key,
          title: item.title,
          price: item.prices[0],
          reason: 'out of stock',
        });
        continue;
      }

      // Rating threshold check
      if (criteria.minRating !== undefined && item.numericRating !== undefined && item.numericRating < criteria.minRating) {
        pruned.push({
          key: item.key,
          title: item.title,
          price: item.prices[0],
          reason: `rating ${item.numericRating}/5 below required ${criteria.minRating}/5`,
        });
        continue;
      }

      validCandidates.push({
        item,
        tokens: tokenize(item.title),
      });
    }

    // Step 2: Connected Graph Similarity & Pattern Clustering
    // Construct similarity graph among candidate products to find dense core cluster
    const clusterCentrality = new Map<string, number>();
    for (let i = 0; i < validCandidates.length; i++) {
      let sumSim = 0;
      const candA = validCandidates[i];
      if (!candA) continue;

      for (let j = 0; j < validCandidates.length; j++) {
        if (i === j) continue;
        const candB = validCandidates[j];
        if (!candB) continue;
        sumSim += jaccardSimilarity(candA.tokens, candB.tokens);
      }
      const density = validCandidates.length > 1 ? sumSim / (validCandidates.length - 1) : 1;
      clusterCentrality.set(candA.item.key, density);
    }

    // Step 3: Composite Scoring
    const scoredMatches: CandidateMatch[] = validCandidates.map(({ item, tokens }) => {
      const highlights: string[] = [];

      // Query term overlap
      let queryScore = 0.5;
      if (queryTokens.size > 0) {
        let matchedTerms = 0;
        for (const q of queryTokens) {
          if (tokens.has(q)) {
            matchedTerms++;
            highlights.push(`matches "${q}"`);
          }
        }
        queryScore = matchedTerms / queryTokens.size;
      }

      // Rating score
      const rating = item.numericRating ?? 3.5;
      const ratingScore = Math.min(1, Math.max(0, rating / 5.0));
      if (rating >= 4.4) highlights.push(`highly rated: ${rating}/5`);

      // Price score (within budget bonus)
      let priceScore = 0.7;
      if (budget !== undefined && item.numericPrice !== undefined) {
        // Cheaper items within budget get a favorable value curve
        priceScore = Math.max(0.2, 1 - (item.numericPrice / budget) * 0.5);
        highlights.push(`within budget: $${item.numericPrice.toFixed(2)}`);
      }

      // Graph cluster score
      const clusterScore = clusterCentrality.get(item.key) ?? 0.5;

      // Sponsored penalty
      const sponsoredPenalty = item.isSponsored ? 0.08 : 0;

      const finalScore = Number(
        (queryScore * 0.4 + ratingScore * 0.25 + clusterScore * 0.2 + priceScore * 0.15 - sponsoredPenalty).toFixed(3),
      );

      return {
        item,
        score: finalScore,
        highlights,
        previewLink: item.linkUrl,
      };
    });

    // Sort by score descending
    scoredMatches.sort((a, b) => b.score - a.score);
    const shortlist = scoredMatches.slice(0, topK);

    // Step 4: Serialize Compact Structured Output
    const lines: string[] = [];
    lines.push(`SURVEY SUMMARY: ${items.length} items harvested across pages.`);
    lines.push(
      `Filtered & Graph-Matched: ${pruned.length} pruned as outliers/mismatches | ${validCandidates.length} in target pattern cluster.`,
    );

    if (shortlist.length > 0) {
      lines.push(`\nTOP ${shortlist.length} SHORTLISTED CANDIDATES (Ranked by pattern similarity):`);
      shortlist.forEach((match, idx) => {
        const item = match.item;
        const price = item.prices.join(' / ') || 'Price unlisted';
        const rating = item.rating ? `${item.rating}/5` : 'No rating';
        const reviews = item.reviews ? ` (${item.reviews} reviews)` : '';
        const preview = match.previewLink ? ` | link: ${match.previewLink}` : '';

        lines.push(
          `${idx + 1}. [${item.ref}] ${quote(item.title, 80)} | ${price} | ${rating}${reviews}${preview} | score: ${match.score}`,
        );
        if (match.highlights.length > 0) {
          lines.push(`   * ${match.highlights.join('; ')}`);
        }
      });
    } else {
      lines.push('\nNo candidate items matched the required criteria and budget.');
    }

    if (pruned.length > 0) {
      // Group prune reasons into compact summary
      const reasonsCount = new Map<string, number>();
      for (const p of pruned) {
        const key = p.reason.split('(')[0]?.trim() || p.reason;
        reasonsCount.set(key, (reasonsCount.get(key) ?? 0) + 1);
      }
      const summaryParts = Array.from(reasonsCount.entries()).map(([reason, count]) => `${count} ${reason}`);
      lines.push(`\nPruned ${pruned.length} items (${summaryParts.join(', ')}).`);
    }

    const text = lines.join('\n');
    return {
      shortlist,
      pruned,
      stats: {
        totalHarvested: items.length,
        prunedCount: pruned.length,
        candidateCount: validCandidates.length,
      },
      text,
      tokens: estimateTokens(text),
    };
  }
}
