/*
 * A small shop for the shopping method: a two-page listing whose first page
 * loads its second half only after scrolling, and product pages that declare
 * schema.org Product data. The cheapest shoe that fits sits below the fold
 * and the best rated one on page 2, so a choice made from the first screen
 * is wrong.
 */

export interface ShopItem {
  id: number;
  name: string;
  price: number;
  rating: number;
  reviews: number;
  stock: 'In stock' | 'Out of stock' | 'Only 2 left';
  sponsored?: boolean;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 1, name: 'Trail Runner One', price: 129, rating: 4.1, reviews: 310, stock: 'In stock', sponsored: true },
  { id: 2, name: 'Road Glide', price: 119, rating: 4.3, reviews: 1204, stock: 'In stock' },
  { id: 3, name: 'Tempo Flyer', price: 139, rating: 4.0, reviews: 88, stock: 'In stock' },
  { id: 4, name: 'Cloud Step', price: 149, rating: 4.4, reviews: 642, stock: 'Out of stock' },
  { id: 5, name: 'Pace Lite', price: 109, rating: 3.9, reviews: 57, stock: 'In stock' },
  { id: 6, name: 'Ridge Grip', price: 135, rating: 4.2, reviews: 230, stock: 'In stock' },
  { id: 7, name: 'Metro Knit', price: 99, rating: 3.7, reviews: 41, stock: 'In stock' },
  { id: 8, name: 'Summit Pro', price: 159, rating: 4.5, reviews: 980, stock: 'In stock' },
  // Loaded only after the person scrolls to the end of page 1.
  { id: 9, name: 'Harbor Run', price: 89, rating: 4.4, reviews: 1530, stock: 'In stock' },
  { id: 10, name: 'Delta Sprint', price: 124, rating: 4.0, reviews: 120, stock: 'Only 2 left' },
  { id: 11, name: 'Canyon Trek', price: 145, rating: 4.1, reviews: 300, stock: 'In stock' },
  { id: 12, name: 'Lumen Daily', price: 94, rating: 3.8, reviews: 66, stock: 'In stock' },
  // Page 2.
  { id: 13, name: 'Aurora Max', price: 99, rating: 4.8, reviews: 2210, stock: 'In stock' },
  { id: 14, name: 'Pebble Walk', price: 79, rating: 3.5, reviews: 19, stock: 'In stock' },
  { id: 15, name: 'Vista Climb', price: 169, rating: 4.6, reviews: 410, stock: 'In stock' },
  { id: 16, name: 'Echo Stride', price: 114, rating: 4.2, reviews: 505, stock: 'Out of stock' },
];

const FIRST_SCREEN = 8;
const PAGE_ONE = 12;

function card(item: ShopItem): string {
  return `<article class="card">
  ${item.sponsored ? '<span>Sponsored</span>' : ''}
  <h3><a href="/shop/item/${item.id}">${item.name} running shoe</a></h3>
  <p>$${item.price.toFixed(2)}</p>
  <p>${item.rating} out of 5 stars (${item.reviews.toLocaleString('en-US')} ratings)</p>
  <p>${item.stock}</p>
  <button type="button">Add to cart</button>
</article>`;
}

const STYLE = `<style>
  body { font-family: sans-serif; margin: 0; }
  header, nav { padding: 8px 16px; }
  main { padding: 0 16px; }
  .card { height: 230px; border-bottom: 1px solid #ccc; padding: 8px 0; }
</style>`;

const NAV = `<header><nav aria-label="Site">
  <a href="/shop/help">Help</a> <a href="/shop/cart">Cart</a> <a href="/shop/deals">Deals</a> <a href="/shop/account">Account</a>
</nav></header>`;

/** Listing page 1 or 2. Page 1 renders 8 cards and appends 4 more once scrolled to the end. */
export function SHOP_LISTING_HTML(page: number): string {
  const first = page === 1 ? SHOP_ITEMS.slice(0, FIRST_SCREEN) : SHOP_ITEMS.slice(PAGE_ONE);
  const later = page === 1 ? SHOP_ITEMS.slice(FIRST_SCREEN, PAGE_ONE) : [];
  const range = page === 1 ? '1-12' : '13-16';
  return `<!DOCTYPE html>
<html><head><title>Running shoes - page ${page}</title>${STYLE}</head>
<body>
${NAV}
<main>
  <h1>Running shoes</h1>
  <p>${range} of 16 results</p>
  <label>Sort by <select id="sort"><option>Featured</option><option>Price: low to high</option><option>Avg. rating</option></select></label>
  <section id="results">
${first.map(card).join('\n')}
  </section>
  ${page === 1 ? '<a href="/shop/list?page=2">Next</a>' : '<a href="/shop/list?page=1">Previous</a>'}
</main>
<script>
  const later = ${JSON.stringify(later.map(card))};
  let loaded = later.length === 0;
  window.addEventListener('scroll', () => {
    if (loaded || window.innerHeight + window.scrollY < document.body.scrollHeight - 300) return;
    loaded = true;
    setTimeout(() => {
      document.getElementById('results').insertAdjacentHTML('beforeend', later.join(''));
    }, 100);
  });
</script>
</body></html>`;
}

/** Product detail page with schema.org Product JSON-LD. */
export function SHOP_PRODUCT_HTML(id: number): string | undefined {
  const item = SHOP_ITEMS.find((entry) => entry.id === id);
  if (!item) return undefined;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${item.name} running shoe`,
    brand: { '@type': 'Brand', name: 'Fixture Athletics' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: item.rating, reviewCount: item.reviews },
    offers: {
      '@type': 'Offer',
      price: item.price.toFixed(2),
      priceCurrency: 'USD',
      availability: item.stock === 'Out of stock' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'Fixture Shop' },
    },
  };
  return `<!DOCTYPE html>
<html><head><title>${item.name}</title>${STYLE}
<script type="application/ld+json">${JSON.stringify(data)}</script></head>
<body>
${NAV}
<main>
  <h1>${item.name} running shoe</h1>
  <p>$${item.price.toFixed(2)}</p>
  <label>Size <select><option>8</option><option>9</option><option>10</option></select></label>
  <button type="button">Add to cart</button>
</main>
</body></html>`;
}
