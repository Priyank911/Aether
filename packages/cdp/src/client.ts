import { EventEmitter } from 'node:events';
import { DEFAULT_CDP_TIMEOUT_MS } from '@aether/shared';
import { CDPSession } from './session.js';
import { WebSocketTransport, type CDPTransport } from './transport.js';

interface PendingCommand {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: string;
  };
}

export class CDPClient extends EventEmitter {
  private transport: CDPTransport | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private sessions = new Map<string, CDPSession>();
  private closed = false;

  public static async connect(wsUrl: string): Promise<CDPClient> {
    return CDPClient.over(await WebSocketTransport.connect(wsUrl));
  }

  /** A client over any transport: WebSocket, pipe, or the extension bridge. */
  public static over(transport: CDPTransport): CDPClient {
    const client = new CDPClient();
    client.transport = transport;
    transport.onMessage((message) => client.handleMessage(message));
    transport.onClose((reason) => client.onClose(reason));
    return client;
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  private handleMessage(raw: string): void {
    let msg: CDPMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.id !== undefined) {
      const cmd = this.pending.get(msg.id);
      if (cmd) {
        this.pending.delete(msg.id);
        clearTimeout(cmd.timer);
        if (msg.error) {
          cmd.reject(
            new Error(`CDP Error in ${cmd.method}: ${msg.error.message} (${msg.error.code})`),
          );
        } else {
          cmd.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method) {
      // Session-specific event
      if (msg.sessionId) {
        const session = this.sessions.get(msg.sessionId);
        if (session) {
          session._dispatchSessionEvent(msg.method, msg.params);
        }
      }

      // Root level or auto-attach handling
      if (msg.method === 'Target.attachedToTarget' && msg.params) {
        const params = msg.params as {
          sessionId: string;
          targetInfo: { targetId: string; type: string };
          waitingForDebugger?: boolean;
        };
        const newSession = new CDPSession(
          this,
          params.sessionId,
          params.targetInfo.type,
          params.targetInfo.targetId,
          msg.sessionId,
        );
        this.sessions.set(params.sessionId, newSession);

        // Auto-attach is NOT recursive: re-issue setAutoAttach on every child session (e.g. for OOPIFs)
        newSession
          .send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
          })
          .catch(() => {
            // Non-critical if child target does not support sub-attaching
          });

        this.emit('sessionAttached', newSession);
        if (msg.sessionId) {
          const parentSession = this.sessions.get(msg.sessionId);
          if (parentSession) {
            parentSession.emit('childSessionAttached', newSession);
          }
        }
      } else if (msg.method === 'Target.detachedFromTarget' && msg.params) {
        const params = msg.params as { sessionId: string };
        const session = this.sessions.get(params.sessionId);
        if (session) {
          session._onDetached();
          this.sessions.delete(params.sessionId);
          this.emit('sessionDetached', session);
        }
      }

      this.emit(msg.method, msg.params);
    }
  }

  public sendCommand<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = DEFAULT_CDP_TIMEOUT_MS,
  ): Promise<T> {
    if (this.closed || !this.transport) {
      return Promise.reject(new Error('CDP connection is closed'));
    }

    const id = this.nextId++;
    const message: Record<string, unknown> = { id, method };
    if (params) message.params = params;
    if (sessionId) message.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `CDP command "${method}" timed out after ${timeoutMs}ms${
              sessionId ? ` (sessionId: ${sessionId})` : ''
            }`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      try {
        this.transport?.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  public getSession(sessionId: string): CDPSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): CDPSession[] {
    return Array.from(this.sessions.values());
  }

  public async attachToTarget(targetId: string): Promise<CDPSession> {
    const result = await this.sendCommand<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId, flatten: true },
    );
    let session = this.sessions.get(result.sessionId);
    if (!session) {
      session = new CDPSession(this, result.sessionId, 'page', targetId);
      this.sessions.set(result.sessionId, session);
    }
    return session;
  }

  /**
   * The sessions behind this client are gone but the client stays usable, for
   * example when the extension reconnects or the debugger detached. Pending
   * commands fail as unverified and every session is marked detached.
   */
  public resetSessions(reason: string): void {
    for (const cmd of this.pending.values()) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error(`${reason} before ${cmd.method} replied; delivery is unverified`));
    }
    this.pending.clear();
    for (const session of this.sessions.values()) session._onDetached();
    this.sessions.clear();
  }

  private onClose(reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const cmd of this.pending.values()) {
      clearTimeout(cmd.timer);
      // The command may have run before the reply was lost; callers must not replay input blindly.
      cmd.reject(new Error(`CDP connection closed (${reason}) before ${cmd.method} replied; delivery is unverified`));
    }
    this.pending.clear();
    for (const session of this.sessions.values()) {
      session._onDetached();
    }
    this.sessions.clear();
    this.emit('close');
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.transport?.close();
    this.onClose('closed by Aether');
  }
}
