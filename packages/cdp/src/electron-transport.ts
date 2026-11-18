import type { CDPTransport } from './transport.js';

/*
 * CDP over Electron's in-process webContents.debugger (plan 3.1, sections 3
 * and 13). Each tab's debugger appears to CDPClient as a root session
 * `tab-<id>`, the same shape the Chrome extension bridge uses, so the
 * perceiver, actor and policy run unchanged. Target domain calls are answered
 * from the registered tabs; child sessions from auto-attach (out-of-process
 * iframes) keep Chromium's ids and are routed to the tab that owns them.
 *
 * This file does not import Electron: a tab is registered with any object
 * shaped like Electron's Debugger.
 */

/** The parts of Electron's `Debugger` this transport uses. */
export interface DebuggerLike {
  attach(protocolVersion?: string): void;
  isAttached(): boolean;
  detach(): void;
  sendCommand(method: string, commandParams?: unknown, sessionId?: string): Promise<unknown>;
  on(event: 'message', listener: (event: unknown, method: string, params: unknown, sessionId: string) => void): unknown;
  on(event: 'detach', listener: (event: unknown, reason: string) => void): unknown;
  removeListener(event: 'message', listener: (event: unknown, method: string, params: unknown, sessionId: string) => void): unknown;
  removeListener(event: 'detach', listener: (event: unknown, reason: string) => void): unknown;
}

export interface TargetDescription {
  title: string;
  url: string;
}

interface Registered {
  debugger: DebuggerLike;
  describe: () => TargetDescription;
  attached: boolean;
  children: Set<string>;
  onMessage: (event: unknown, method: string, params: unknown, sessionId: string) => void;
  onDetach: (event: unknown, reason: string) => void;
}

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

const PROTOCOL_VERSION = '1.3';
const ROOT = /^tab-(.+)$/;

export function rootSessionOf(tabId: string): string {
  return `tab-${tabId}`;
}

export class ElectronDebuggerTransport implements CDPTransport {
  private readonly tabs = new Map<string, Registered>();
  private readonly childOwner = new Map<string, string>();
  private readonly messageListeners: Array<(message: string) => void> = [];
  private readonly closeListeners: Array<(reason: string) => void> = [];
  private closed = false;

  /** Make a tab visible to the engine. Its debugger is attached on the first Target.attachToTarget. */
  public addTarget(tabId: string, target: DebuggerLike, describe: () => TargetDescription): void {
    this.removeTarget(tabId, 'replaced');
    const entry: Registered = {
      debugger: target,
      describe,
      attached: false,
      children: new Set(),
      onMessage: (_event, method, params, sessionId) => this.onDebuggerEvent(tabId, method, params, sessionId),
      onDetach: (_event, reason) => this.onDebuggerDetached(tabId, reason),
    };
    target.on('message', entry.onMessage);
    target.on('detach', entry.onDetach);
    this.tabs.set(tabId, entry);
  }

  /** The tab hibernated, crashed or closed: its sessions end, and the engine is told. */
  public removeTarget(tabId: string, reason = 'tab closed'): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    this.tabs.delete(tabId);
    entry.debugger.removeListener('message', entry.onMessage);
    entry.debugger.removeListener('detach', entry.onDetach);
    if (entry.attached) {
      try {
        if (entry.debugger.isAttached()) entry.debugger.detach();
      } catch {
        // The webContents is already gone.
      }
      this.endSessions(tabId, entry, reason);
    }
  }

  public send(message: string): void {
    if (this.closed) throw new Error('CDP connection is closed');
    let request: Request;
    try {
      request = JSON.parse(message) as Request;
    } catch {
      return;
    }
    void this.handle(request).then(
      (result) => this.emit({ id: request.id, result: result ?? {}, ...(request.sessionId ? { sessionId: request.sessionId } : {}) }),
      (error: unknown) =>
        this.emit({
          id: request.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        }),
    );
  }

  public onMessage(listener: (message: string) => void): void {
    this.messageListeners.push(listener);
  }

  public onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  public close(): void {
    if (this.closed) return;
    for (const tabId of [...this.tabs.keys()]) this.removeTarget(tabId, 'transport closed');
    this.closed = true;
    for (const listener of this.closeListeners) listener('transport closed');
  }

  private async handle(request: Request): Promise<unknown> {
    const { method, params = {}, sessionId } = request;
    if (!sessionId) return this.handleBrowser(method, params);
    const root = ROOT.exec(sessionId)?.[1];
    if (root !== undefined) {
      const entry = this.attachedTab(root);
      return entry.debugger.sendCommand(method, params);
    }
    const owner = this.childOwner.get(sessionId);
    if (owner === undefined) throw new Error(`No session with id ${sessionId}`);
    return this.attachedTab(owner).debugger.sendCommand(method, params, sessionId);
  }

  /** Browser-level calls: only the Target domain makes sense here, answered from the registered tabs. */
  private async handleBrowser(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'Target.getTargets':
        return { targetInfos: [...this.tabs.entries()].map(([tabId, entry]) => this.info(tabId, entry)) };
      case 'Target.setDiscoverTargets':
        return {};
      case 'Target.attachToTarget': {
        const tabId = String(params.targetId ?? '');
        const entry = this.tabs.get(tabId);
        if (!entry) throw new Error(`No target with id ${tabId}`);
        if (!entry.attached) {
          if (!entry.debugger.isAttached()) entry.debugger.attach(PROTOCOL_VERSION);
          entry.attached = true;
        }
        return { sessionId: rootSessionOf(tabId) };
      }
      case 'Target.detachFromTarget': {
        const tabId = ROOT.exec(String(params.sessionId ?? ''))?.[1];
        const entry = tabId === undefined ? undefined : this.tabs.get(tabId);
        if (tabId !== undefined && entry?.attached) {
          entry.attached = false;
          if (entry.debugger.isAttached()) entry.debugger.detach();
          this.endSessions(tabId, entry, 'detached by the engine');
        }
        return {};
      }
      case 'Target.createTarget':
      case 'Target.closeTarget':
        throw new Error(`${method} is handled by the Space manager, not over CDP`);
      default:
        throw new Error(`${method} is not available at browser level in Aether Desktop`);
    }
  }

  private attachedTab(tabId: string): Registered {
    const entry = this.tabs.get(tabId);
    if (!entry) throw new Error(`The tab ${tabId} is no longer live (hibernated, crashed or closed)`);
    if (!entry.attached) throw new Error(`Not attached to tab ${tabId}; call Target.attachToTarget first`);
    return entry;
  }

  private onDebuggerEvent(tabId: string, method: string, params: unknown, sessionId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    if (method === 'Target.attachedToTarget') {
      const child = (params as { sessionId?: string }).sessionId;
      if (child) {
        entry.children.add(child);
        this.childOwner.set(child, tabId);
      }
    }
    if (method === 'Target.detachedFromTarget') {
      const child = (params as { sessionId?: string }).sessionId;
      if (child) {
        entry.children.delete(child);
        this.childOwner.delete(child);
      }
    }
    this.emit({ method, params, sessionId: sessionId || rootSessionOf(tabId) });
  }

  private onDebuggerDetached(tabId: string, reason: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry?.attached) return;
    entry.attached = false;
    this.endSessions(tabId, entry, reason);
  }

  private endSessions(tabId: string, entry: Registered, reason: string): void {
    for (const child of entry.children) {
      this.childOwner.delete(child);
      this.emit({ method: 'Target.detachedFromTarget', params: { sessionId: child, targetId: child, reason } });
    }
    entry.children.clear();
    this.emit({ method: 'Target.detachedFromTarget', params: { sessionId: rootSessionOf(tabId), targetId: tabId, reason } });
  }

  private info(tabId: string, entry: Registered): Record<string, unknown> {
    const { title, url } = entry.describe();
    return { targetId: tabId, type: 'page', title, url, attached: entry.attached };
  }

  private emit(message: Record<string, unknown>): void {
    if (this.closed) return;
    const text = JSON.stringify(message);
    for (const listener of this.messageListeners) listener(text);
  }
}
