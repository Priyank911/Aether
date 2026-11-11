import { EventEmitter } from 'node:events';
import type { CDPClient } from './client.js';

export interface CDPSessionEvents {
  [event: string]: (...args: unknown[]) => void;
}

export class CDPSession extends EventEmitter {
  public readonly sessionId: string;
  public readonly targetType: string;
  public readonly targetId: string;
  /** Session that auto-attached this one, e.g. the page session of an out-of-process iframe. */
  public readonly parentSessionId?: string;
  private readonly client: CDPClient;
  private detached = false;

  constructor(
    client: CDPClient,
    sessionId: string,
    targetType: string,
    targetId: string,
    parentSessionId?: string,
  ) {
    super();
    this.client = client;
    this.sessionId = sessionId;
    this.targetType = targetType;
    this.targetId = targetId;
    this.parentSessionId = parentSessionId;
  }

  /**
   * Live sessions auto-attached below this one, at any depth, in attach order.
   */
  public descendants(): CDPSession[] {
    const all = this.client.getAllSessions();
    const byId = new Map(all.map((session) => [session.sessionId, session]));
    const isBelow = (session: CDPSession): boolean => {
      let parentId = session.parentSessionId;
      const seen = new Set<string>();
      while (parentId && !seen.has(parentId)) {
        if (parentId === this.sessionId) return true;
        seen.add(parentId);
        parentId = byId.get(parentId)?.parentSessionId;
      }
      return false;
    };
    return all.filter((session) => !session.isDetached && isBelow(session));
  }

  public get isDetached(): boolean {
    return this.detached;
  }

  public async send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.detached) {
      throw new Error(`Cannot send command "${method}" on detached session ${this.sessionId}`);
    }
    return this.client.sendCommand<T>(method, params, this.sessionId, timeoutMs);
  }

  /**
   * Look up another session on the same connection, e.g. the session of a child frame.
   */
  public sibling(sessionId: string): CDPSession | undefined {
    return this.client.getSession(sessionId);
  }

  public async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    try {
      await this.client.sendCommand('Target.detachFromTarget', { sessionId: this.sessionId });
    } catch {
      // Ignore detach errors if target already closed
    }
    this.emit('detached');
    this.removeAllListeners();
  }

  /**
   * Internal dispatcher for CDP events targeted to this session
   */
  public _dispatchSessionEvent(method: string, params: unknown): void {
    this.emit(method, params);
  }

  /**
   * Internal notification when target detached
   */
  public _onDetached(): void {
    this.detached = true;
    this.emit('detached');
  }
}
