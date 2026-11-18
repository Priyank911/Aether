import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { session as electronSession, type WebContentsView } from 'electron';
import type { ElectronDebuggerTransport } from '@aether/cdp';
import type { SpaceStore } from '@aether/memory';
import { HUMAN_SPACE_ID, spaceIdFromName, type Milestone, type MilestoneStatus, type Space, type SpacePartition } from '@aether/shared';
import type { AgentHost } from './agent-host.js';
import { Tab } from './tab.js';

/*
 * Spaces and their tabs (plan 3.1, sections 5.1 and 5.2). The Human Space
 * "Personal" always exists; Agent Spaces are made per task. Where a live
 * page sits:
 * - the active tab of the Space the person is looking at: the main window;
 * - other live Agent tabs: the agent host window, so they keep rendering;
 * - other live Human tabs: attached nowhere, throttled like background tabs in Chrome.
 * Only Agent tabs are ever registered with the engine's CDP transport: the
 * debugger is never attached to the person's own tabs (section 9.7).
 *
 * Event: 'changed' whenever anything the shell draws has changed.
 */

export const PERSIST_PARTITION = 'persist:aether';

export interface MainDisplay {
  /** Show this view in the main viewport, or nothing. */
  show(view: WebContentsView | undefined): void;
  viewportSize(): { width: number; height: number };
}

interface SpaceEntry {
  record: Space;
  tabs: Tab[];
  activeTabId?: string;
}

export interface OpenTabsResult {
  tabIds: string[];
  live: number;
  hibernated: number;
}

export interface SpaceManagerOptions {
  store: SpaceStore;
  host: AgentHost;
  display: MainDisplay;
  transport: ElectronDebuggerTransport;
  /** How many more pages may be live right now (concurrency.ts). */
  slots: () => number;
}

const SAVE_DELAY_MS = 300;
/** A tab just woken is not put to sleep for this long, so an agent can read it first. */
export const WAKE_GRACE_MS = 30_000;
const SWEPT_STORAGES = ['serviceworkers', 'cachestorage', 'shadercache'] as const;

function partitionFor(spaceId: string, partition: SpacePartition): string {
  // A partition without the persist: prefix lives in memory only and is gone with the app or the Space.
  return partition === 'persist' ? PERSIST_PARTITION : `aether-ephemeral-${spaceId}`;
}

function originOf(url: string): string | undefined {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

export class SpaceManager extends EventEmitter {
  private readonly spaces = new Map<string, SpaceEntry>();
  private readonly options: SpaceManagerOptions;
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private visible = HUMAN_SPACE_ID;
  private readonly closedTabs: Array<{ spaceId: string; url: string }> = [];
  private readonly milestones = new Map<string, Milestone[]>();
  private milestoneSeq = 0;

  public constructor(options: SpaceManagerOptions) {
    super();
    this.options = options;
  }

  /** Load Spaces and tabs from storage. Every tab starts asleep except the Human Space's active tab. */
  public restore(): void {
    const { store } = this.options;
    for (const stored of store.spaces()) {
      if (stored.archived && stored.kind === 'agent') continue;
      const entry = this.adopt({ ...stored, state: 'idle' });
      for (const tab of store.tabs(stored.id)) entry.tabs.push(this.makeTab(entry, tab.url, tab));
      entry.activeTabId = entry.tabs.some((tab) => tab.id === stored.activeTab) ? stored.activeTab : entry.tabs[0]?.id;
    }
    if (!this.spaces.has(HUMAN_SPACE_ID)) {
      const personal = this.adopt({ id: HUMAN_SPACE_ID, name: 'Personal', kind: 'human', partition: 'persist', state: 'idle', createdAt: Date.now(), archived: false });
      store.saveSpace(personal.record);
    }
    const personal = this.entry(HUMAN_SPACE_ID);
    if (personal.tabs.length === 0) this.openTab(HUMAN_SPACE_ID, 'about:blank', { activate: true });
    this.showSpace(HUMAN_SPACE_ID);
  }

  public list(): ReadonlyArray<{ record: Space; tabs: ReadonlyArray<Tab>; activeTabId?: string }> {
    return [...this.spaces.values()];
  }

  public get visibleSpaceId(): string {
    return this.visible;
  }

  public tab(tabId: string): Tab | undefined {
    for (const entry of this.spaces.values()) {
      const found = entry.tabs.find((tab) => tab.id === tabId);
      if (found) return found;
    }
    return undefined;
  }

  /** The Agent Space with this name, created if new; an existing one is reused. */
  public agentSpace(name: string, partition: SpacePartition = 'persist'): Space {
    const id = spaceIdFromName(name);
    const existing = this.spaces.get(id);
    if (existing) return existing.record;
    const entry = this.adopt({ id, name: name.trim().slice(0, 60) || 'Task', kind: 'agent', partition, state: 'idle', createdAt: Date.now(), archived: false });
    this.options.store.saveSpace(entry.record);
    this.changed(id);
    return entry.record;
  }

  public openTab(spaceId: string, url: string, options: { activate?: boolean; live?: boolean } = {}): Tab {
    const entry = this.entry(spaceId);
    const tab = this.makeTab(entry, url);
    entry.tabs.push(tab);
    if (options.activate || !entry.activeTabId) this.activate(entry, tab);
    else if (options.live) this.wake(tab);
    this.changed(spaceId);
    return tab;
  }

  /**
   * Open several pages (plan 3.1, section 5.2). The first one loads; with
   * `lazy` the rest are created asleep, otherwise as many load as memory
   * allows and the rest sleep. Returns a short receipt, never page content.
   */
  public openTabs(spaceId: string, urls: readonly string[], options: { lazy?: boolean } = {}): OpenTabsResult {
    const entry = this.entry(spaceId);
    const tabIds: string[] = [];
    let live = 0;
    let budget = options.lazy ? 1 : Math.max(1, this.options.slots());
    urls.forEach((url, index) => {
      const tab = this.makeTab(entry, url);
      entry.tabs.push(tab);
      tabIds.push(tab.id);
      if (index === 0 && !entry.activeTabId) this.activate(entry, tab);
      else if (budget > 0) this.wake(tab);
      if (tab.view) {
        live++;
        budget--;
      }
    });
    this.changed(spaceId);
    return { tabIds, live, hibernated: tabIds.length - live };
  }

  public activateTab(tabId: string): void {
    const tab = this.require(tabId);
    this.activate(this.entry(tab.spaceId), tab);
    this.changed(tab.spaceId);
  }

  /** Show a Space in the main window; its active tab wakes if it was asleep. */
  public showSpace(spaceId: string): void {
    const entry = this.entry(spaceId);
    const previous = this.spaces.get(this.visible);
    this.visible = spaceId;
    if (previous && previous !== entry) {
      const shown = previous.tabs.find((tab) => tab.id === previous.activeTabId);
      if (shown) this.place(shown);
    }
    const active = entry.tabs.find((tab) => tab.id === entry.activeTabId);
    if (active) this.activate(entry, active);
    else this.options.display.show(undefined);
    this.emit('changed');
  }

  public async hibernateTab(tabId: string): Promise<void> {
    const tab = this.require(tabId);
    await tab.hibernate();
    this.changed(tab.spaceId);
  }

  public closeTab(tabId: string): void {
    const tab = this.require(tabId);
    const entry = this.entry(tab.spaceId);
    const index = entry.tabs.indexOf(tab);
    entry.tabs.splice(index, 1);
    this.closedTabs.push({ spaceId: tab.spaceId, url: tab.url });
    if (this.closedTabs.length > 25) this.closedTabs.shift();
    tab.close();
    if (entry.activeTabId === tab.id) {
      entry.activeTabId = undefined;
      const next = entry.tabs[Math.min(index, entry.tabs.length - 1)];
      if (next) this.activate(entry, next);
      else if (entry.record.kind === 'human') this.openTab(entry.record.id, 'about:blank', { activate: true });
      else if (this.visible === entry.record.id) this.options.display.show(undefined);
    }
    this.changed(entry.record.id);
  }

  /** Bring back the most recently closed tab of a Space. */
  public reopenTab(spaceId: string): Tab | undefined {
    for (let index = this.closedTabs.length - 1; index >= 0; index--) {
      const closed = this.closedTabs[index];
      if (closed?.spaceId === spaceId) {
        this.closedTabs.splice(index, 1);
        return this.openTab(spaceId, closed.url, { activate: true });
      }
    }
    return undefined;
  }

  /**
   * Delete an Agent Space (plan 3.1, section 11.3). Its tabs close; for
   * origins only this Space used, service workers, cache storage and shader
   * cache are cleared while cookies and local storage stay, so the person
   * stays signed in. An ephemeral Space's partition is cleared whole.
   */
  public async closeSpace(spaceId: string): Promise<{ sweptOrigins: string[] }> {
    if (spaceId === HUMAN_SPACE_ID) throw new Error('The Personal Space cannot be closed');
    const entry = this.entry(spaceId);
    const own = new Set(entry.tabs.map((tab) => originOf(tab.url)).filter((origin): origin is string => Boolean(origin)));
    for (const other of this.spaces.values()) {
      if (other === entry || other.record.partition !== entry.record.partition) continue;
      for (const tab of other.tabs) {
        const origin = originOf(tab.url);
        if (origin) own.delete(origin);
      }
    }
    for (const tab of entry.tabs) tab.close();
    entry.tabs.length = 0;
    this.spaces.delete(spaceId);
    clearTimeout(this.saveTimers.get(spaceId));
    this.options.store.deleteSpace(spaceId);
    const ses = electronSession.fromPartition(partitionFor(spaceId, entry.record.partition));
    const swept: string[] = [];
    if (entry.record.partition === 'ephemeral') {
      await ses.clearStorageData();
      await ses.clearCache();
    } else {
      for (const origin of own) {
        await ses.clearStorageData({ origin, storages: [...SWEPT_STORAGES] });
        swept.push(origin);
      }
    }
    if (this.visible === spaceId) this.showSpace(HUMAN_SPACE_ID);
    this.emit('changed');
    return { sweptOrigins: swept };
  }

  /**
   * Live tabs nobody is using, least recently viewed first: what the watchdog
   * may put to sleep. Never the tab on screen, never a Space's active tab (the
   * one its agent works in), and never a tab woken less than WAKE_GRACE_MS ago,
   * so a page an agent just opened is not put to sleep before it is read.
   */
  public sleepCandidates(now = Date.now()): Tab[] {
    const shown = this.shownTab();
    const tabs: Tab[] = [];
    for (const entry of this.spaces.values()) {
      for (const tab of entry.tabs) {
        if (!tab.view || tab === shown || tab.id === entry.activeTabId || now - tab.wokenAt < WAKE_GRACE_MS) continue;
        tabs.push(tab);
      }
    }
    return tabs.sort((a, b) => a.lastViewedAt - b.lastViewedAt);
  }

  /**
   * One line of agent progress for the Activity panel (plan 3.2, task 3.2):
   * the host's thought, logStep lines and engine receipts. Kept in memory
   * only; the text is engine or script text, drawn as text, never as markup.
   */
  public addMilestone(spaceId: string, text: string, source: Milestone['source'], status: MilestoneStatus = 'done'): Milestone {
    const milestone: Milestone = { id: `m${++this.milestoneSeq}`, spaceId, text: text.slice(0, 200), status, source, startedAt: Date.now() };
    const list = this.milestones.get(spaceId);
    if (list) {
      list.push(milestone);
      if (list.length > 50) list.splice(0, list.length - 50);
    } else {
      this.milestones.set(spaceId, [milestone]);
    }
    this.emit('changed');
    return milestone;
  }

  public milestonesFor(spaceId: string): Milestone[] {
    return this.milestones.get(spaceId) ?? [];
  }

  public shownTab(): Tab | undefined {
    const entry = this.spaces.get(this.visible);
    return entry?.tabs.find((tab) => tab.id === entry.activeTabId && tab.view);
  }

  /** Save everything now, for a clean exit. */
  public flush(): void {
    for (const [spaceId, timer] of this.saveTimers) {
      clearTimeout(timer);
      this.save(spaceId);
    }
    this.saveTimers.clear();
  }

  public closeAll(): void {
    this.flush();
    for (const entry of this.spaces.values()) for (const tab of entry.tabs) tab.close();
  }

  private adopt(record: Space): SpaceEntry {
    const entry: SpaceEntry = { record, tabs: [] };
    this.spaces.set(record.id, entry);
    return entry;
  }

  private makeTab(entry: SpaceEntry, url: string, stored?: { id: string; title: string; favicon?: string; scrollY: number; lastViewedAt: number }): Tab {
    const tab = new Tab({
      id: stored?.id ?? `t${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      spaceId: entry.record.id,
      kind: entry.record.kind,
      partition: partitionFor(entry.record.id, entry.record.partition),
      url,
      title: stored?.title,
      favicon: stored?.favicon,
      scrollY: stored?.scrollY,
      lastViewedAt: stored?.lastViewedAt,
    });
    tab.on('changed', () => this.changed(entry.record.id));
    tab.on('opened', (target: string) => {
      if (this.spaces.get(entry.record.id) === entry) this.openTab(entry.record.id, target, { activate: entry.record.kind === 'human', live: true });
    });
    tab.on('released', (view: WebContentsView) => {
      this.options.host.remove(view);
      this.options.transport.removeTarget(tab.id, tab.state === 'crashed' ? 'renderer crashed' : 'tab asleep');
      if (this.shownTab() === undefined && this.visible === entry.record.id && entry.activeTabId === tab.id) this.options.display.show(undefined);
    });
    return tab;
  }

  private activate(entry: SpaceEntry, tab: Tab): void {
    const previous = entry.tabs.find((candidate) => candidate.id === entry.activeTabId);
    entry.activeTabId = tab.id;
    tab.markViewed();
    this.wake(tab);
    if (previous && previous !== tab) this.place(previous);
  }

  private wake(tab: Tab): void {
    const fresh = tab.view === undefined;
    const view = tab.wake();
    if (fresh && tab.kind === 'agent') {
      this.options.transport.addTarget(tab.id, view.webContents.debugger, () => ({ title: tab.title, url: tab.url }));
    }
    this.place(tab);
  }

  private place(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    const entry = this.spaces.get(tab.spaceId);
    const shown = this.visible === tab.spaceId && entry?.activeTabId === tab.id;
    if (shown) {
      this.options.host.remove(view);
      this.options.display.show(view);
      return;
    }
    if (tab.kind === 'agent') this.options.host.add(view);
    else this.options.host.remove(view);
  }

  private changed(spaceId: string): void {
    // At most one save per delay: a timer already waiting is left alone, so a Space whose pages keep
    // changing (titles, loading) is still saved every SAVE_DELAY_MS instead of being put off forever.
    if (this.saveTimers.has(spaceId)) {
      this.emit('changed');
      return;
    }
    this.saveTimers.set(
      spaceId,
      setTimeout(() => {
        this.saveTimers.delete(spaceId);
        this.save(spaceId);
      }, SAVE_DELAY_MS),
    );
    this.emit('changed');
  }

  private save(spaceId: string): void {
    const entry = this.spaces.get(spaceId);
    if (!entry) return;
    this.options.store.saveSpace(entry.record);
    this.options.store.saveTabs(
      spaceId,
      entry.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, favicon: tab.favicon, scrollY: tab.scrollY, lastViewedAt: tab.lastViewedAt })),
      entry.activeTabId,
    );
  }

  private entry(spaceId: string): SpaceEntry {
    const entry = this.spaces.get(spaceId);
    if (!entry) throw new Error(`No Space with id ${spaceId}`);
    return entry;
  }

  private require(tabId: string): Tab {
    const tab = this.tab(tabId);
    if (!tab) throw new Error(`No tab with id ${tabId}`);
    return tab;
  }
}
