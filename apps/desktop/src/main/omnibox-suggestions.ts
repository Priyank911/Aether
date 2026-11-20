import type { OmniboxItem } from '@aether/shared';
import type { NavigationMatch } from './navigation-store.js';
import { resolveInput, SEARCH_URL } from './omnibox.js';

/** Pure and local: generating a search action does not send the query to Google. */
export function omniboxSuggestions(query: string, matches: readonly NavigationMatch[]): OmniboxItem[] {
  const text = query.trim();
  const items: OmniboxItem[] = [];
  if (text) {
    const resolved = resolveInput(text);
    if (resolved.kind === 'url') {
      items.push({ kind: 'navigate', label: text, input: text, ...(resolved.url.length <= 4096 ? { url: resolved.url } : {}) });
    }
    if (resolved.kind !== 'refused') {
      const url = `${SEARCH_URL}${encodeURIComponent(text)}`;
      if (url.length <= 4096) items.push({ kind: 'search', label: `Search Google for ${text}`.slice(0, 4096), input: url, url });
      else if (resolved.kind === 'search') items.push({ kind: 'search', label: `Search Google for ${text}`.slice(0, 4096), input: text });
    }
  }
  // Always retain the typed action(s), leaving the rest for local matches.
  const seen = new Set(items.map((item) => item.url));
  for (const match of matches) {
    if (items.length >= 8) break;
    if (seen.has(match.url)) continue;
    seen.add(match.url);
    items.push({ kind: match.kind, label: match.title || match.url, input: match.url, url: match.url });
  }
  return items;
}
