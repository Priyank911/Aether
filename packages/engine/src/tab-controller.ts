import type { CDPClient } from '@aether/cdp';
import { AgentTab } from './agent-tab.js';

/*
 * Where a browser session finds its tabs. The default controller talks to a
 * CDP endpoint that owns its browser (headless Chrome, or the extension
 * bridge): it discovers targets and creates tabs over CDP. A host with its
 * own tab management, such as Aether Desktop's SpaceManager, supplies its
 * own controller instead, so open, openTabs, switchTab and mapPages work on
 * real Space tabs (plan 3.2, task 3.2).
 */

export interface SessionTabInfo {
  id: string;
  title: string;
  url: string;
  state: 'live' | 'loading' | 'hibernated' | 'crashed';
}

export interface SessionTabController {
  /** The host can hold several tabs at once (openTabs, switchTab, per-page tabs in mapPages). */
  readonly multiTab: boolean;
  /** Native HTTP authentication was refused to the agent; a person must sign in. */
  takeAuthRequirement?(): boolean;
  takeCertificateRefusal?(): boolean;
  /** The tab the agent works in now, attached and alive. */
  current(): Promise<AgentTab>;
  /** Attach to a known tab. */
  attach(targetId: string): Promise<AgentTab>;
  /** A new tab for the Space, attached, showing about:blank; the caller navigates it. */
  create(): Promise<AgentTab>;
  /** A target the current page opened during the last step, or undefined. */
  followOpener(): Promise<string | undefined>;
  /** The Space's tabs, when the host keeps several. */
  list?(): SessionTabInfo[];
  /** Open a batch of already-approved URLs as Space tabs. */
  openTabs?(urls: readonly string[], lazy: boolean): Promise<{ tabIds: string[]; live: number; hibernated: number }>;
  /** Make another tab of the Space the one the agent works in. */
  switchTo?(tabId: string): Promise<AgentTab>;
  /** The run ended: pages opened only for reading may sleep now. */
  runEnded?(): void;
}

/** The default: tabs over a CDP endpoint that owns its browser. */
export class CdpTabController implements SessionTabController {
  public readonly multiTab = false;
  private readonly openedByClient: string[] = [];

  public constructor(private readonly client: CDPClient) {
    client.on('Target.targetCreated', (params: { targetInfo: { targetId: string; type: string; openerId?: string } }) => {
      const info = params.targetInfo;
      if (info.type === 'page' && info.openerId) this.openedByClient.push(info.targetId);
    });
  }

  public async current(): Promise<AgentTab> {
    const { targetInfos } = await this.client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string; url?: string; title?: string }> }>('Target.getTargets');
    const pageTarget = targetInfos.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('No Chrome page is available');
    if (pageTarget.url && /^(chrome|chrome-extension|devtools):/i.test(pageTarget.url)) {
      throw new Error(`The active tab is a protected Chrome page (${pageTarget.title || pageTarget.url}). Switch to a regular http(s) tab and retry.`);
    }
    try {
      return await AgentTab.attach(this.client, pageTarget.targetId);
    } catch (error) {
      throw new Error(`Could not attach to the Chrome tab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async attach(targetId: string): Promise<AgentTab> {
    return AgentTab.attach(this.client, targetId);
  }

  public async create(): Promise<AgentTab> {
    let targetId: string;
    try {
      ({ targetId } = await this.client.sendCommand<{ targetId: string }>('Target.createTarget', { url: 'about:blank' }));
    } catch {
      throw new Error('new_tab is not available through the extension yet; open the URL in the current tab');
    }
    return AgentTab.attach(this.client, targetId);
  }

  public async followOpener(): Promise<string | undefined> {
    const targetId = this.openedByClient.pop();
    this.openedByClient.length = 0;
    return targetId;
  }
}
