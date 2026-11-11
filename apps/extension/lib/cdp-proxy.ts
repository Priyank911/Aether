import type { ExtensionMessage } from '@aether/shared';
import type { AgentTabs } from './agent-tabs.js';

/** The engine sees each tab's root debugger session as tab-<id>; child sessions keep Chrome's ids. */
export function rootSession(tabId: number): string {
  return `tab-${tabId}`;
}

function tabOfRoot(sessionId: string | undefined): number | undefined {
  const match = sessionId ? /^tab-(\d+)$/.exec(sessionId) : null;
  return match?.[1] ? Number(match[1]) : undefined;
}
const PROTOCOL_VERSION = '1.3';
/** A tab opened by the agent tab is followed only this soon after the agent's own input. */
const FOLLOW_WINDOW_MS = 3000;
const NOT_FOLLOWED = /^(chrome|chrome-extension|devtools|edge):/i;

export interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

type Send = (message: ExtensionMessage) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetInfo(tab: chrome.tabs.Tab): Record<string, unknown> {
  return { targetId: String(tab.id), type: 'page', title: tab.title ?? '', url: tab.url ?? '', attached: true, openerId: tab.openerTabId === undefined ? undefined : String(tab.openerTabId) };
}

/**
 * Carries CDP between the engine and chrome.debugger on the agent tab. Target
 * domain calls are answered from the tab group, since an extension debugs one
 * tab at a time; everything else goes to the attached tab, including flat child
 * sessions for out-of-process frames.
 */
export class CdpProxy {
  private readonly tabs: AgentTabs;
  private readonly send: Send;
  private attachedTabId?: number;
  private lastInputAt = 0;

  constructor(tabs: AgentTabs, send: Send) {
    this.tabs = tabs;
    this.send = send;
  }

  public start(): void {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined || source.tabId !== this.attachedTabId) return;
      this.send({ method, params: isRecord(params) ? params : undefined, sessionId: source.sessionId ?? rootSession(source.tabId) });
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId === undefined || source.tabId !== this.attachedTabId) return;
      this.attachedTabId = undefined;
      this.send({ type: 'aether.detached', reason });
    });
    chrome.tabs.onCreated.addListener((tab) => {
      // A tab the person opens (Ctrl+T, a bookmark) must never become the agent tab.
      if (Date.now() - this.lastInputAt > FOLLOW_WINDOW_MS) return;
      if (NOT_FOLLOWED.test(tab.pendingUrl ?? tab.url ?? '')) return;
      void this.tabs.follow(tab).then((followed) => {
        if (followed) this.send({ method: 'Target.targetCreated', params: { targetInfo: targetInfo(tab) } });
      });
    });
    chrome.tabs.onRemoved.addListener((tabId) => this.tabs.forget(tabId));
  }

  public async handle(request: CdpRequest): Promise<void> {
    const reply = (body: { result: Record<string, unknown> } | { error: { code: number; message: string } }): void => {
      this.send({ id: request.id, ...body, ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
    };
    try {
      reply({ result: await this.dispatch(request) });
    } catch (error) {
      reply({ error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private async dispatch(request: CdpRequest): Promise<Record<string, unknown>> {
    switch (request.method) {
      case 'Target.getTargets':
        return { targetInfos: [targetInfo(await this.tabs.ensure())] };
      case 'Target.attachToTarget': {
        const tabId = Number(request.params?.targetId);
        if (!Number.isInteger(tabId)) throw new Error('invalid target id');
        if (tabId !== this.tabs.current) await this.tabs.adopt(tabId);
        await this.attach(tabId);
        return { sessionId: rootSession(tabId) };
      }
      case 'Target.createTarget': {
        const url = typeof request.params?.url === 'string' ? request.params.url : 'about:blank';
        const tab = await chrome.tabs.create({ url, active: true });
        if (tab.id === undefined) throw new Error('Chrome did not create a tab');
        await this.tabs.adopt(tab.id);
        return { targetId: String(tab.id) };
      }
      case 'Target.setDiscoverTargets':
        // Tabs opened from the agent tab are reported through chrome.tabs instead.
        return {};
    }
    const rootTab = tabOfRoot(request.sessionId);
    const tabId = rootTab ?? this.attachedTabId ?? this.tabs.current;
    if (tabId === undefined) throw new Error('there is no agent tab; call open first');
    await this.attach(tabId);
    if (request.method.startsWith('Input.')) this.lastInputAt = Date.now();
    const debuggee: chrome.debugger.DebuggerSession = { tabId };
    if (request.sessionId && rootTab === undefined) debuggee.sessionId = request.sessionId;
    const result = await chrome.debugger.sendCommand(debuggee, request.method, request.params);
    return isRecord(result) ? result : {};
  }

  private async attach(tabId: number): Promise<void> {
    if (this.attachedTabId === tabId) return;
    if (this.attachedTabId !== undefined) {
      const previous = this.attachedTabId;
      this.attachedTabId = undefined;
      await chrome.debugger.detach({ tabId: previous }).catch(() => undefined);
    }
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    this.attachedTabId = tabId;
  }
}
