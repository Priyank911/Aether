import type { CDPClient } from '@aether/cdp';
import { AgentTab, type SessionTabController, type SessionTabInfo } from '@aether/engine';
import type { SpaceManager } from '../space-manager.js';
import type { Tab } from '../tab.js';

interface SpaceEntryView {
  record: { id: string };
  tabs: ReadonlyArray<Tab>;
  activeTabId?: string;
}

/*
 * The tabs of one Agent Space for the engine (plan 3.2, task 3.2). The
 * session asks here for the tab to work in; the SpaceManager decides where
 * the view lives (main window or agent host window) and what sleeps, and
 * only Agent tabs are ever attached to the CDP transport (section 9.7).
 */

export class SpaceTabController implements SessionTabController {
  public readonly multiTab = true;
  private readonly attached = new Map<string, AgentTab>();
  /** Tabs the engine itself created, so followOpener only reports page-opened ones. */
  private readonly known = new Set<string>();

  public constructor(
    private readonly spaceId: string,
    private readonly manager: SpaceManager,
    private readonly client: CDPClient,
  ) {
    for (const tab of this.spaceEntry().tabs) this.known.add(tab.id);
  }

  public takeCertificateRefusal(): boolean {
    const tab = this.spaceEntry().tabs.find((candidate) => candidate.certificateRefused);
    if (!tab) return false;
    tab.certificateRefused = false;
    return true;
  }

  public takeAuthRequirement(): boolean {
    const tab = this.spaceEntry().tabs.find((candidate) => candidate.authenticationRequired);
    if (!tab) return false;
    tab.authenticationRequired = false;
    return true;
  }

  public async current(): Promise<AgentTab> {
    const entry = this.spaceEntry();
    const active = entry.tabs.find((tab) => tab.id === entry.activeTabId);
    if (active) return this.attach(active.id);
    // The Space has no tab yet; the engine's first open creates one.
    return this.create();
  }

  public async attach(targetId: string): Promise<AgentTab> {
    const cached = this.attached.get(targetId);
    if (cached?.isAlive) return cached;
    this.attached.delete(targetId);
    const tab = await AgentTab.attach(this.client, targetId);
    tab.actor.onActionTarget = (point) => this.manager.emit('action-target', point ? { tabId: targetId, ...point, timestamp: Date.now() } : undefined);
    this.attached.set(targetId, tab);
    return tab;
  }

  public async create(): Promise<AgentTab> {
    const tab = this.manager.openTab(this.spaceId, 'about:blank', { activate: true });
    this.known.add(tab.id);
    return this.attach(tab.id);
  }

  public async followOpener(): Promise<string | undefined> {
    const entry = this.spaceEntry();
    const fresh = entry.tabs.find((tab) => !this.known.has(tab.id));
    if (!fresh) return undefined;
    this.known.add(fresh.id);
    return fresh.id;
  }

  public async openTabs(urls: readonly string[], lazy: boolean): Promise<{ tabIds: string[]; live: number; hibernated: number }> {
    const receipt = this.manager.openTabs(this.spaceId, urls, { lazy });
    for (const id of receipt.tabIds) this.known.add(id);
    return receipt;
  }

  public async switchTo(tabId: string): Promise<AgentTab> {
    const tab = this.manager.tab(tabId);
    if (!tab || tab.spaceId !== this.spaceId) throw new Error(`No tab ${tabId} in this Space`);
    this.manager.activateTab(tabId);
    this.known.add(tabId);
    return this.attach(tabId);
  }

  public list(): SessionTabInfo[] {
    return this.spaceEntry().tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, state: tab.state }));
  }

  /** The run ended: pages the engine opened for reading sleep, the last page stays for the person. */
  public runEnded(): void {
    const entry = this.spaceEntry();
    for (const tab of entry.tabs) {
      if (tab.id === entry.activeTabId || !tab.view) continue;
      void this.manager.hibernateTab(tab.id).catch(() => undefined);
    }
  }

  private spaceEntry(): SpaceEntryView {
    const entry = this.manager.list().find((candidate) => candidate.record.id === this.spaceId);
    if (!entry) throw new Error(`No Space with id ${this.spaceId}`);
    return entry;
  }
}
