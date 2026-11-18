import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  DaemonClientFrameSchema,
  DaemonFatalSchema,
  type DaemonConfig,
  type DaemonServerFrame,
  type ToolResult,
} from '@aether/shared';
import type { DesktopTools } from './desktop-tools.js';

/*
 * The one app service (plan 3.2, section 4.2). Clients connect over the named
 * pipe (Windows) or the owner socket; the first frame must be hello with the
 * token from daemon.json, then requests and responses, one JSON object per
 * line. Requests on one connection may overlap; responses carry the id.
 */

const MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface ServiceServerOptions {
  config: DaemonConfig;
  tools: DesktopTools;
  /** Used only to name test connections in the log. */
  appVersion: string;
}

interface Session {
  id: string;
  socket: Socket;
  authorized: boolean;
  buffer: string;
  closing: boolean;
}

export class ServiceServer {
  private readonly options: ServiceServerOptions;
  private readonly server: Server;
  private readonly sessions = new Set<Session>();
  private stopping = false;
  private readonly stopped: Promise<void>;

  public constructor(options: ServiceServerOptions) {
    this.options = options;
    this.server = createServer((socket) => this.accept(socket));
    this.stopped = new Promise((resolve) => this.server.once('close', resolve));
  }

  /** Listen on the endpoint from daemon.json. */
  public listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.config.endpoint, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  /** Stop accepting, tell connected clients, and close (plan 3.2, task 3.4). */
  public async close(): Promise<void> {
    if (this.stopping) return this.stopped;
    this.stopping = true;
    const fatal = DaemonFatalSchema.parse({ type: 'fatal', code: 'shutting_down', message: 'the app is closing' });
    for (const session of [...this.sessions]) this.send(session, fatal);
    for (const session of [...this.sessions]) session.socket.destroy();
    this.server.close();
    await this.stopped;
  }

  private accept(socket: Socket): void {
    const session: Session = { id: randomUUID().slice(0, 8), socket, authorized: false, buffer: '', closing: false };
    this.sessions.add(session);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.receive(session, chunk));
    socket.on('error', () => this.sessions.delete(session));
    socket.on('close', () => this.sessions.delete(session));
  }

  private receive(session: Session, chunk: string): void {
    if (session.closing) return;
    session.buffer += chunk;
    for (;;) {
      const end = session.buffer.indexOf('\n');
      if (end < 0) {
        if (Buffer.byteLength(session.buffer, 'utf8') > MAX_LINE_BYTES) this.fail(session, 'bad_frame', 'a frame over 8 MB is refused');
        return;
      }
      const line = session.buffer.slice(0, end);
      session.buffer = session.buffer.slice(end + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this.fail(session, 'bad_frame', 'a frame over 8 MB is refused');
        return;
      }
      this.handle(session, line);
      if (session.closing) return;
    }
  }

  private handle(session: Session, line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      this.fail(session, 'bad_frame', 'frames are one JSON object per line');
      return;
    }
    const parsed = DaemonClientFrameSchema.safeParse(frame);
    if (!parsed.success) {
      this.fail(session, 'bad_frame', `bad frame: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return;
    }
    if (parsed.data.type === 'hello') {
      if (session.authorized) {
        this.fail(session, 'protocol', 'hello is only the first frame');
        return;
      }
      if (parsed.data.token !== this.options.config.token || parsed.data.protocol !== this.options.config.version) {
        this.fail(session, 'bad_token', 'the token or protocol does not match this service');
        return;
      }
      session.authorized = true;
      this.send(session, { type: 'welcome', session: session.id, appVersion: this.options.appVersion });
      return;
    }
    if (!session.authorized) {
      this.fail(session, 'bad_token', 'say hello with the token first');
      return;
    }
    const request = parsed.data;
    void this.options.tools
      .call(request.tool, request.params)
      .then((result: ToolResult) => this.send(session, { type: 'response', id: request.id, result }))
      .catch((error: unknown) => {
        // tools.call already catches; this guards the send itself.
        if (!session.closing) this.fail(session, 'bad_frame', error instanceof Error ? error.message : String(error));
      });
  }

  private fail(session: Session, code: 'bad_token' | 'bad_frame' | 'protocol' | 'shutting_down', message: string): void {
    this.send(session, DaemonFatalSchema.parse({ type: 'fatal', code, message }));
    session.closing = true;
    session.socket.destroy();
  }

  private send(session: Session, frame: DaemonServerFrame): void {
    if (session.socket.destroyed) return;
    session.socket.write(`${JSON.stringify(frame)}\n`);
  }
}
