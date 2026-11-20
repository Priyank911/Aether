import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SpaceStore, type DatabaseHandle } from '@aether/memory';
import { NavigationStore } from '../apps/desktop/src/main/navigation-store.js';

const databases: DatabaseHandle[] = [];
const directories: string[] = [];
function fresh(file = ':memory:'): { db: DatabaseHandle; store: NavigationStore; spaces: SpaceStore } {
  const db = openDatabase(file);
  databases.push(db);
  const spaces = new SpaceStore(db);
  for (const id of ['personal', 'agent-one', 'agent-two']) {
    spaces.saveSpace({ id, name: id, kind: id === 'personal' ? 'human' : 'agent', partition: 'persist', createdAt: 1, archived: false });
  }
  return { db, store: new NavigationStore(db), spaces };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('local navigation store', () => {
  it('isolates both history and bookmarks between Personal and every Agent Space', () => {
    const { store } = fresh();
    for (const spaceId of ['personal', 'agent-one', 'agent-two']) {
      store.record({ spaceId, url: `https://${spaceId}.example/history`, title: `History ${spaceId}` });
      store.bookmark({ spaceId, url: `https://${spaceId}.example/bookmark`, title: `Bookmark ${spaceId}` });
    }
    for (const spaceId of ['personal', 'agent-one', 'agent-two']) {
      expect(store.suggestions(spaceId, '').map((match) => match.title)).toEqual([`Bookmark ${spaceId}`, `History ${spaceId}`]);
    }
    expect(store.suggestions('unknown', '')).toEqual([]);
  });

  it('matches URL or title case-insensitively and treats SQL metacharacters literally', () => {
    const { store } = fresh();
    store.record({ spaceId: 'personal', url: 'https://example.com/guide', title: "A 100%_ guide's title" });
    expect(store.suggestions('personal', 'GUIDE')).toHaveLength(1);
    expect(store.suggestions('personal', 'EXAMPLE.COM')).toHaveLength(1);
    expect(store.suggestions('personal', '%_')).toHaveLength(1);
    expect(store.suggestions('personal', "' OR 1=1 --")).toEqual([]);
  });

  it('ranks bookmarks before frequent then recent history and deduplicates URLs', () => {
    const { store } = fresh();
    store.record({ spaceId: 'personal', url: 'https://frequent.example/', title: 'First title', at: 1 });
    store.record({ spaceId: 'personal', url: 'https://frequent.example/', title: 'Frequent', at: 2 });
    store.record({ spaceId: 'personal', url: 'https://recent.example/', title: 'Recent', at: 10 });
    store.record({ spaceId: 'personal', url: 'https://saved.example/', title: 'History title', at: 20 });
    store.bookmark({ spaceId: 'personal', url: 'https://saved.example/', title: 'Saved', at: 0 });
    expect(store.suggestions('personal', '').map((match) => [match.kind, match.title])).toEqual([
      ['bookmark', 'Saved'], ['history', 'Frequent'], ['history', 'Recent'],
    ]);
  });

  it('updates only an existing committed history title, scoped to its Space', () => {
    const { store } = fresh();
    const url = 'https://shared.example/';
    store.record({ spaceId: 'personal', url, title: 'Original', at: 1 });
    store.record({ spaceId: 'agent-one', url, title: 'Agent', at: 1 });
    store.updateTitle('personal', url, 'Updated');
    store.updateTitle('personal', 'https://unvisited.example/', 'Not a visit');
    expect(store.suggestions('personal', '').map((match) => match.title)).toEqual(['Updated']);
    expect(store.suggestions('agent-one', '')[0]?.title).toBe('Agent');
  });

  it('limits results to eight and rejects unsafe schemes', () => {
    const { store } = fresh();
    for (let index = 0; index < 20; index++) store.record({ spaceId: 'personal', url: `https://example.com/${index}`, title: '', at: index });
    expect(store.suggestions('personal', '')).toHaveLength(8);
    for (const url of ['javascript:alert(1)', 'file:///secret', 'about:blank', 'not a URL']) {
      expect(() => store.record({ spaceId: 'personal', url, title: '' })).toThrow();
      expect(() => store.bookmark({ spaceId: 'personal', url, title: '' })).toThrow();
    }
  });

  it('toggles bookmarks and isolates stored site zoom by Space', () => {
    const { store } = fresh();
    const entry = { spaceId: 'personal', url: 'https://saved.example/', title: 'Saved' };
    expect(store.toggleBookmark(entry)).toBe(true);
    expect(store.list('personal', 'bookmark')).toEqual([expect.objectContaining(entry)]);
    expect(store.list('agent-one', 'bookmark')).toEqual([]);
    expect(store.toggleBookmark(entry)).toBe(false);
    expect(store.list('personal', 'bookmark')).toEqual([]);
    store.saveZoom('personal', 'https://saved.example', 1.5);
    expect(store.zoom('personal', 'https://saved.example')).toBe(1.5);
    expect(store.zoom('agent-one', 'https://saved.example')).toBe(0);
  });

  it('persists its own tables across reopen and cascades deletion with the Space', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aether-navigation-'));
    directories.push(directory);
    const file = path.join(directory, 'navigation.db');
    const first = fresh(file);
    first.store.record({ spaceId: 'personal', url: 'https://history.example/', title: 'History' });
    first.store.bookmark({ spaceId: 'personal', url: 'https://bookmark.example/', title: 'Bookmark' });
    first.store.bookmarksVisible = true;
    first.store.saveZoom('personal', 'https://history.example', 1);
    first.db.close();
    databases.splice(databases.indexOf(first.db), 1);
    const second = fresh(file);
    expect(second.store.suggestions('personal', '')).toHaveLength(2);
    expect(second.store.bookmarksVisible).toBe(true);
    expect(second.store.zoom('personal', 'https://history.example')).toBe(1);
    second.spaces.deleteSpace('personal');
    expect(second.store.suggestions('personal', '')).toEqual([]);
  });
});
