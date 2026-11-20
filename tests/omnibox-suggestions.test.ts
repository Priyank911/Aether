import { describe, expect, it, vi } from 'vitest';
import { OmniboxStateSchema, ShellCommandSchema } from '@aether/shared';
import { omniboxSuggestions } from '../apps/desktop/src/main/omnibox-suggestions.js';
import { resolveInput, SEARCH_URL } from '../apps/desktop/src/main/omnibox.js';
import type { NavigationMatch } from '../apps/desktop/src/main/navigation-store.js';

const matches: NavigationMatch[] = [
  { kind: 'bookmark', title: 'Saved guide', url: 'https://example.com/guide' },
  { kind: 'history', title: 'Recent guide', url: 'https://other.example/guide' },
];

describe('local omnibox suggestions', () => {
  it('offers navigation plus a locally generated Google action without making requests', () => {
    const network = vi.fn(() => { throw new Error('no network allowed'); });
    vi.stubGlobal('fetch', network);
    try {
      const items = omniboxSuggestions('example.com', matches);
      expect(items.map((item) => item.kind)).toEqual(['navigate', 'search', 'bookmark', 'history']);
      expect(items[0]?.url).toBe('https://example.com/');
      expect(items[1]?.url).toBe(`${SEARCH_URL}example.com`);
      for (const item of items) expect(resolveInput(item.input)).toEqual({ kind: 'url', url: item.url });
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('encodes search text only into an action and keeps title/URL data as plain strings', () => {
    const items = omniboxSuggestions('  quiet & fast  ', matches);
    expect(items[0]).toEqual({ kind: 'search', label: 'Search Google for quiet & fast', input: `${SEARCH_URL}quiet%20%26%20fast`, url: `${SEARCH_URL}quiet%20%26%20fast` });
    expect(items[1]?.label).toBe('Saved guide');
    expect(omniboxSuggestions('', [{ kind: 'history', title: '<script>untrusted</script>', url: 'https://example.com/' }])[0]?.label).toBe('<script>untrusted</script>');
  });

  it('shows recent local matches for an empty query, without a search action', () => {
    expect(omniboxSuggestions('   ', matches).map((item) => item.kind)).toEqual(['bookmark', 'history']);
    expect(omniboxSuggestions('', [])).toEqual([]);
  });

  it('deduplicates URLs and retains the typed actions within the eight-item limit', () => {
    const many: NavigationMatch[] = Array.from({ length: 20 }, (_, index) => ({ kind: 'history', title: '', url: `https://example.com/${index}` }));
    const items = omniboxSuggestions('example.com/0', [...many, ...many]);
    expect(items).toHaveLength(8);
    expect(items.slice(0, 2).map((item) => item.kind)).toEqual(['navigate', 'search']);
    expect(new Set(items.map((item) => item.url)).size).toBe(8);
    expect(items[2]?.label).toBe('https://example.com/1');
  });

  it('keeps maximally sized and percent-expanded input within the snapshot schema', () => {
    for (const query of ['x'.repeat(4096), `https://example.com/${'é'.repeat(2000)}`, 'é '.repeat(2048)]) {
      const state = { query, selected: 0, left: 0, width: 600, items: omniboxSuggestions(query, []) };
      expect(state.items.length).toBeGreaterThan(0);
      expect(OmniboxStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('does not turn a refused scheme into a suggested navigation or search', () => {
    expect(omniboxSuggestions('javascript:alert(1)', [])).toEqual([]);
    expect(omniboxSuggestions('file:///private', [])).toEqual([]);
  });

  it('validates the coordinated shell commands and bounded optional snapshot state', () => {
    const update = { type: 'omnibox.update', query: 'guide', selected: -1, left: 120, width: 600 };
    expect(ShellCommandSchema.parse(update)).toEqual(update);
    for (const command of [{ type: 'omnibox.close' }, { type: 'omnibox.accept', index: 7, query: 'guide', input: 'https://example.com/guide' }, { type: 'menu.open' }]) {
      expect(ShellCommandSchema.parse(command)).toEqual(command);
    }
    for (const patch of [{ query: 'x'.repeat(4097) }, { selected: 8 }, { selected: -2 }, { left: -1 }, { width: 0 }, { width: Infinity }]) {
      expect(ShellCommandSchema.safeParse({ ...update, ...patch }).success).toBe(false);
    }
    expect(ShellCommandSchema.safeParse({ type: 'omnibox.accept', index: -1 }).success).toBe(false);
    expect(ShellCommandSchema.safeParse({ type: 'omnibox.accept', index: 8 }).success).toBe(false);
    const state = { query: 'guide', selected: 0, left: 120, width: 600, items: omniboxSuggestions('guide', matches) };
    expect(OmniboxStateSchema.parse(state)).toEqual(state);
    expect(OmniboxStateSchema.safeParse({ ...state, items: Array(9).fill(state.items[0]) }).success).toBe(false);
  });
});
