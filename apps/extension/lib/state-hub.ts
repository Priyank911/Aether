import type { ConnectionState, ConnectionStatus, PanelSnapshot, RunStateFrame } from '@aether/shared';
import type { AgentTabs } from './agent-tabs.js';

const RECENT_LIMIT = 40;

/**
 * Holds the latest connection status and run-state frame from the engine and
 * fans them out to the side panel and the overlay in the agent tab. Neither
 * view keeps state; a reopened panel asks for a snapshot.
 */
export class StateHub {
  private connection: ConnectionStatus = { type: 'aether.connection', state: 'no_host', detail: 'Starting' };
  private frame?: RunStateFrame;
  private readonly recent: RunStateFrame[] = [];
  private readonly tabs: AgentTabs;

  constructor(tabs: AgentTabs) {
    this.tabs = tabs;
  }

  public setConnection(state: ConnectionState, detail: string): void {
    this.connection = { type: 'aether.connection', state, detail };
    this.broadcast(this.connection);
    if (state !== 'connected' && this.frame && this.frame.state !== 'idle') {
      this.publish({ ...this.frame, state: 'idle', label: 'Aether disconnected', pending: undefined, timestamp: Date.now() });
    }
  }

  public publish(frame: RunStateFrame): void {
    const previous = this.frame;
    this.frame = frame;
    if (!previous || previous.step !== frame.step || previous.label !== frame.label || previous.state !== frame.state) {
      this.recent.unshift(frame);
      this.recent.length = Math.min(this.recent.length, RECENT_LIMIT);
    }
    void this.tabs.markWaiting(frame.state === 'waiting_human');
    void this.badge(frame);
    this.broadcast(frame);
    const tabId = this.tabs.current;
    if (tabId !== undefined) void chrome.tabs.sendMessage(tabId, frame).catch(() => undefined);
  }

  /** What a content script in the agent tab needs when it loads: the current frame, if this is the agent tab. */
  public frameFor(tabId: number | undefined): RunStateFrame | undefined {
    return tabId !== undefined && tabId === this.tabs.current ? this.frame : undefined;
  }

  public async snapshot(): Promise<PanelSnapshot> {
    const tabId = this.tabs.current;
    const tab = tabId === undefined ? undefined : await chrome.tabs.get(tabId).catch(() => undefined);
    return {
      connection: this.connection,
      frame: this.frame,
      agentTab: { type: 'aether.agent_tab', tabId: tab?.id, title: tab?.title ?? 'No agent tab yet' },
      recent: [...this.recent],
    };
  }

  /** The toolbar icon carries the state too: a blue dot while working, an amber mark when the run needs you. */
  private async badge(frame: RunStateFrame): Promise<void> {
    const waiting = frame.state === 'waiting_human';
    const working = frame.state === 'acting' || frame.state === 'resuming';
    await chrome.action.setBadgeText({ text: waiting ? '!' : working ? '•' : '' }).catch(() => undefined);
    await chrome.action.setBadgeBackgroundColor({ color: waiting ? '#f5a524' : '#2f6bff' }).catch(() => undefined);
    await chrome.action.setTitle({ title: waiting ? 'Aether needs you' : working ? `Aether: ${frame.label}` : 'Aether' }).catch(() => undefined);
  }

  private broadcast(message: unknown): void {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  }
}
