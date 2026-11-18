import { describe, expect, it } from 'vitest';
import { openDatabase, SpaceStore } from '@aether/memory';
import { isBlockedHost } from '@aether/policy';
import { Gate, pageSlots, underPressure } from '../src/main/concurrency.js';
import { resolveInput, SEARCH_URL } from '../src/main/omnibox.js';

const GB = 1024 ** 3;

describe('address bar input', () => {
  it('loads URLs and hosts, and searches everything else', () => {
    expect(resolveInput('https://example.com/a?b=1')).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' });
    expect(resolveInput('example.com')).toEqual({ kind: 'url', url: 'https://example.com/' });
    expect(resolveInput('shop.example.co.uk/item/9')).toEqual({ kind: 'url', url: 'https://shop.example.co.uk/item/9' });
    expect(resolveInput('localhost:4101/form.html')).toEqual({ kind: 'url', url: 'http://localhost:4101/form.html' });
    expect(resolveInput('192.168.1.10')).toEqual({ kind: 'url', url: 'http://192.168.1.10/' });
    expect(resolveInput('running shoes under 120')).toEqual({ kind: 'search', url: `${SEARCH_URL}running%20shoes%20under%20120` });
    expect(resolveInput('aether')).toEqual({ kind: 'search', url: `${SEARCH_URL}aether` });
  });

  it('never loads script, file or data addresses from the address bar', () => {
    expect(resolveInput('javascript:alert(1)').kind).toBe('refused');
    expect(resolveInput('file:///C:/Windows/win.ini').kind).toBe('refused');
    expect(resolveInput('data:text/html,hi').kind).toBe('refused');
    expect(resolveInput('   ').kind).toBe('refused');
  });
});

describe('page concurrency from free memory', () => {
  it('scales with free memory above the reserve, bounded by cores, never below one', () => {
    expect(pageSlots({ free: 28 * GB, total: 32 * GB, reserveRatio: 0.2, cores: 16 })).toBe(15);
    expect(pageSlots({ free: 8 * GB, total: 32 * GB, reserveRatio: 0.2, cores: 16 })).toBe(10);
    expect(pageSlots({ free: 6 * GB, total: 32 * GB, reserveRatio: 0.2, cores: 16 })).toBe(1);
    expect(pageSlots({ free: 28 * GB, total: 32 * GB, reserveRatio: 0.2, cores: 4 })).toBe(3);
    expect(pageSlots({ free: 3 * GB, total: 8 * GB, reserveRatio: 0.2, cores: 8, pageBytes: 300 * 1024 ** 2 })).toBe(4);
    expect(underPressure({ free: 1 * GB, total: 8 * GB }, 0.2)).toBe(true);
    expect(underPressure({ free: 4 * GB, total: 8 * GB }, 0.2)).toBe(false);
  });

  it('lets no more than the current limit run at once, and re-reads the limit as work finishes', async () => {
    let limit = 2;
    let running = 0;
    let peak = 0;
    const gate = new Gate(() => limit);
    const job = () =>
      gate.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        running--;
      });
    const first = Promise.all([job(), job(), job(), job()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    limit = 1;
    await first;
    expect(peak).toBe(2);
    peak = 0;
    await Promise.all([job(), job(), job()]);
    expect(peak).toBe(1);
  });
});

describe('Space and tab storage', () => {
  it('keeps tab order, the active tab and only short metadata, and deletes a Space with its tabs', () => {
    const store = new SpaceStore(openDatabase(':memory:'));
    store.saveSpace({ id: 'shoe-hunt', name: 'Shoe hunt', kind: 'agent', partition: 'persist', createdAt: 1, archived: false });
    store.saveTabs(
      'shoe-hunt',
      [
        { id: 'a', url: 'https://shop.example/list', title: 'List', scrollY: 120, lastViewedAt: 5 },
        { id: 'b', url: 'https://shop.example/item/9', title: 'Item', favicon: `data:image/png;base64,${'A'.repeat(2000)}`, scrollY: 0, lastViewedAt: 6 },
      ],
      'b',
    );
    expect(store.spaces()).toEqual([{ id: 'shoe-hunt', name: 'Shoe hunt', kind: 'agent', partition: 'persist', createdAt: 1, archived: false, activeTab: 'b' }]);
    const tabs = store.tabs('shoe-hunt');
    expect(tabs.map((tab) => [tab.id, tab.position, tab.scrollY])).toEqual([['a', 0, 120], ['b', 1, 0]]);
    expect(tabs[1]?.favicon).toBeUndefined();
    expect(store.tabBytes('shoe-hunt')).toBeLessThan(300);
    store.deleteSpace('shoe-hunt');
    expect(store.spaces()).toEqual([]);
    expect(store.tabs('shoe-hunt')).toEqual([]);
  });
});

describe('Agent request blocklist', () => {
  it('blocks listed ad and tracking hosts and their subdomains only', () => {
    expect(isBlockedHost('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).toBe(true);
    expect(isBlockedHost('https://www.google-analytics.com/g/collect')).toBe(true);
    expect(isBlockedHost('https://notdoubleclick.net/')).toBe(false);
    expect(isBlockedHost('https://www.amazon.com/dp/B0')).toBe(false);
    expect(isBlockedHost('not a url')).toBe(false);
  });
});
