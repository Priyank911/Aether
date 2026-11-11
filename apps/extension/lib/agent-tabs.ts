const GROUP_TITLE = 'Aether';
const WAITING_TITLE = 'Aether: needs you';
const PROTECTED_URL = /^(chrome|chrome-extension|devtools|edge|about):/i;

/**
 * The agent workspace: tabs in one Chrome tab group named "Aether". The agent
 * acts only on the agent tab inside it and never falls back to the person's
 * active tab. The group shares the profile's logins; it is a visibility and
 * targeting contract, not a security boundary.
 */
export class AgentTabs {
  private agentTabId?: number;
  private groupId?: number;

  public get current(): number | undefined {
    return this.agentTabId;
  }

  /** The agent tab, creating the group's first tab when there is none. */
  public async ensure(): Promise<chrome.tabs.Tab> {
    if (this.agentTabId !== undefined) {
      const tab = await chrome.tabs.get(this.agentTabId).catch(() => undefined);
      if (tab?.id !== undefined) return tab;
      this.agentTabId = undefined;
    }
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    if (tab.id === undefined) throw new Error('Chrome did not create a tab');
    await this.adopt(tab.id);
    return tab;
  }

  /** Put a tab into the Aether group and make it the agent tab. */
  public async adopt(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && PROTECTED_URL.test(tab.url) && tab.url !== 'about:blank') {
      throw new Error(`Aether cannot use ${tab.url}; open a regular web page in this tab first`);
    }
    if (this.groupId !== undefined) {
      const exists = await chrome.tabGroups.get(this.groupId).catch(() => undefined);
      if (!exists) this.groupId = undefined;
    }
    if (this.groupId === undefined) {
      this.groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(this.groupId, { title: GROUP_TITLE, color: 'blue' });
    } else {
      await chrome.tabs.group({ tabIds: [tabId], groupId: this.groupId });
    }
    this.agentTabId = tabId;
  }

  /** A tab opened from the agent tab joins the group and becomes the agent tab. */
  public async follow(tab: chrome.tabs.Tab): Promise<boolean> {
    if (tab.id === undefined || this.agentTabId === undefined || tab.openerTabId !== this.agentTabId) return false;
    await this.adopt(tab.id).catch(() => undefined);
    return true;
  }

  public forget(tabId: number): void {
    if (this.agentTabId === tabId) this.agentTabId = undefined;
  }

  /** The group title doubles as a status line in the tab strip. */
  public async markWaiting(waiting: boolean): Promise<void> {
    if (this.groupId === undefined) return;
    await chrome.tabGroups.update(this.groupId, { title: waiting ? WAITING_TITLE : GROUP_TITLE, color: waiting ? 'yellow' : 'blue' }).catch(() => undefined);
  }
}
