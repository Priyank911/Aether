# Perception: how pages become compact views

This file records the scoring and budgets the plan (section 6.2) leaves to
implementation. Everything here is deterministic; no model tokens are spent
on perception itself.

## Views and budgets

| View | SDK | Budget |
|---|---|---|
| Skim | `space.skim()` | 1,200 tokens |
| Focus | `space.focus(ref, { after })` | 1,500 |
| Text | `space.text(ref?, { after })` | 2,000 |
| Items | `space.items()` | 2,200 |
| Survey | `space.survey(...)` | 400 to 600 |
| Find | `space.find(query, role?)` | ranked list |
| Delta | returned by `space.act()` | — |

All page-derived text leaves the engine inside
`<page untrusted nonce=... origins="...">` (rule 5).

## Items (`space.items`)

`packages/perceiver/src/items.ts` scrolls the listing with trusted wheel
input, segments repeated cards by URL pattern, and attaches JSON-LD product
facts (name, price, availability, rating, seller) when the page exposes
them. Each `BucketItem` carries `prices`, `numericPrice`, `numericRating`,
`sponsored`/`outOfStock` flags, `linkUrl`, `sourceUrl` and `pageNumber`.

## Survey (`space.survey`) and ProductGraphMatcher

`space.survey({ query, budget, minRating, maxPages })` harvests items across
up to `maxPages` listing pages into an `ItemBucket`, then ranks them with
`ProductGraphMatcher.evaluate` (`packages/perceiver/src/graph-matcher.ts`).
The plan calls this "Jaccard centrality"; the exact scoring, as
implemented:

**Step 1 — hard pruning.** An item is removed, with a recorded reason, when
it matches a negative term (from `negativeTerms` or "no/without/exclude"
phrases in the query), exceeds `budget`, is out of stock, or scores below
`minRating`. Surviving items form the candidate set.

**Step 2 — cluster centrality.** Each candidate's title is tokenized
(lowercase alphanumeric words of length > 1). For every pair of candidates
the Jaccard similarity `|A∩B| / |A∪B|` is computed; an item's centrality is
the mean similarity to all other candidates — items that look like the
"pattern" of the result set score higher.

**Step 3 — composite score.**

```
score = 0.40 * queryScore      // fraction of query terms present in the title (0.5 when no query)
      + 0.25 * ratingScore     // numericRating / 5, clamped to [0,1]; missing rating counts as 3.5
      + 0.20 * clusterScore    // centrality from step 2 (0.5 fallback)
      + 0.15 * priceScore      // 1 - price/budget * 0.5, clamped to [0.2, 1]; 0.7 when unconstrained
      - 0.08                  // when the item is sponsored
```

`budget` defaults to a number parsed from the query text ("under $120",
"max 50", ...). The top `topK` (default 3) become the shortlist; the rest
are reported as `pruned` with reasons. The serialized result is capped near
600 tokens.

## Smart Landing notes

Every navigation settles (DOM ready, network quiet or stable AX hash,
250 ms target / 2.5 s cap), applies the `cookieBanners` setting
(`reject` default, `accept`, `off`), and tags the page archetype
(`listing`, `product`, `form`, `article`, `auth_gate`, `captcha`,
`other`). Notes appear in `PageBrief.landing` and as milestones.
