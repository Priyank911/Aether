import { randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { CDPTransport } from '@aether/cdp';
import { BridgeConfigSchema, ExtensionMessageSchema, type EngineMessage, type RunStateFrame } from '@aether/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { RunState } from '../run/run-state.js';

/** No native messaging cap on this socket; large AX trees and screenshots fit. */
const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
const HELLO_TIMEOUT_MS = 5000;
export const PING_INTERVAL_MS = 15000;

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** In-process CDP transport whose other end is the extension socket. */
class ExtensionTransport implements CDPTransport {
  private readonly listeners: Array<(message: string) => void> = [];
  private readonly forward: (message: string) => boolean;

  constructor(forward: (message: string) => boolean) {
    this.forward = forward;
  }

  public send(message: string): void {
    if (!this.forward(message)) throw new Error('the Aether extension is not connected: open Chrome with the Aether extension enabled');
  }

  public deliver(message: string): void {
    for (const listener of this.listeners) listener(message);
  }

  public onMessage(listener: (message: string) => void): void {
    this.listeners.push(listener);
  }

  /** The bridge outlives extension reconnects, so this transport never closes on its own. */
  public onClose(): void {}

  public close(): void {}
}

/**
 * The engine end of the extension bridge. Events: `connected`, `disconnected`
 * (reason), and `reset` (reason) whenever CDP sessions behind the extension
 * are gone and every pending command must fail as unverified.
 */
export class ExtensionBridge extends EventEmitter {
  public readonly transport: ExtensionTransport;
  private readonly token = randomBytes(32).toString('hex');
  private readonly configPath: string;
  private readonly server = createServer();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private socket?: WebSocket;
  private port?: number;
  private pingTimer?: ReturnType<typeof setInterval>;
  private pingsSent = 0;
  private lastPong = 0;
  private closed = false;

  private readonly pingIntervalMs: number;

  constructor(configPath = path.join(homedir(), '.aether', 'bridge.json'), pingIntervalMs = PING_INTERVAL_MS) {
    super();
    this.configPath = configPath;
    this.pingIntervalMs = pingIntervalMs;
    this.transport = new ExtensionTransport((message) => this.sendRaw(message));
    this.server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
  }

  public get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public get address(): { port: number; token: string } {
    if (!this.port) throw new Error('the bridge is not listening');
    return { port: this.port, token: this.token };
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to read the bridge address');
    this.port = address.port;
    const config = BridgeConfigSchema.parse({ port: this.port, token: this.token });
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
  }

  /** Send every run-state frame to the extension, starting with the current one. */
  public attachRun(run: RunState): void {
    run.onFrame((frame: RunStateFrame) => this.send(frame));
    this.on('connected', () => this.send(run.frame()));
    this.on('reply', (reply) => run.receive(reply));
    this.on('control', (control) => run.control(control));
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopPings();
    this.socket?.close(1001, 'Aether closed');
    this.sockets.close();
    if (this.server.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
    try {
      const config = BridgeConfigSchema.parse(JSON.parse(await readFile(this.configPath, 'utf8')));
      if (config.token === this.token) await unlink(this.configPath);
    } catch {
      // Another Aether process may have replaced the file.
    }
  }

  /** Send an engine message to the extension, if it is connected. */
  public publish(message: EngineMessage): void {
    this.send(message);
  }

  private send(message: EngineMessage): void {
    this.sendRaw(JSON.stringify(message));
  }

  private sendRaw(message: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(message);
    return true;
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const origin = request.headers.origin;
    if (url.pathname !== '/extension' || !isLoopback(request.socket.remoteAddress) || !origin || !EXTENSION_ORIGIN.test(origin)) {
      socket.destroy();
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (webSocket) => this.awaitHello(webSocket));
  }

  private tokenMatches(candidate: string): boolean {
    return candidate.length === this.token.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token));
  }

  /** The first message must be a hello with the token; anything else closes the socket. */
  private awaitHello(webSocket: WebSocket): void {
    const timer = setTimeout(() => webSocket.close(4401, 'no hello'), HELLO_TIMEOUT_MS);
    webSocket.once('message', (data) => {
      clearTimeout(timer);
      let hello: unknown;
      try {
        hello = ExtensionMessageSchema.parse(JSON.parse(data.toString()));
      } catch {
        webSocket.close(4400, 'invalid hello');
        return;
      }
      if (typeof hello !== 'object' || hello === null || !('type' in hello) || hello.type !== 'aether.hello' || !('token' in hello) || typeof hello.token !== 'string' || !this.tokenMatches(hello.token)) {
        webSocket.close(4401, 'bad token');
        return;
      }
      this.accept(webSocket);
    });
  }

  private accept(webSocket: WebSocket): void {
    const previous = this.socket;
    this.socket = webSocket;
    if (previous) {
      previous.removeAllListeners('close');
      previous.close(4000, 'replaced by a newer connection');
      this.emit('reset', 'the extension reconnected');
    }
    webSocket.on('message', (data) => this.onMessage(data.toString()));
    webSocket.on('close', (code, reason) => {
      if (this.socket !== webSocket) return;
      this.socket = undefined;
      this.stopPings();
      const detail = `the extension disconnected (${code}${reason.length > 0 ? ` ${reason.toString()}` : ''})`;
      this.emit('disconnected', detail);
      this.emit('reset', detail);
    });
    this.startPings(webSocket);
    this.emit('connected');
  }

  private onMessage(raw: string): void {
    let message: ReturnType<typeof ExtensionMessageSchema.parse>;
    try {
      message = ExtensionMessageSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if ('type' in message) {
      switch (message.type) {
        case 'aether.pong':
          this.lastPong = message.n;
          return;
        case 'aether.reply':
          this.emit('reply', message);
          return;
        case 'aether.control':
          this.emit('control', message);
          return;
        case 'aether.memory':
          this.emit('memory', message);
          return;
        case 'aether.detached':
          this.emit('reset', `the debugger detached: ${message.reason}`);
          return;
        case 'aether.hello':
          return;
      }
    }
    this.transport.deliver(raw);
  }

  /** Application keepalive: two missed pongs mean a half-open socket, for example a suspended service worker. */
  private startPings(webSocket: WebSocket): void {
    this.stopPings();
    this.pingsSent = 0;
    this.lastPong = 0;
    this.pingTimer = setInterval(() => {
      if (this.pingsSent - this.lastPong >= 2) {
        webSocket.terminate();
        return;
      }
      this.pingsSent++;
      this.send({ type: 'aether.ping', n: this.pingsSent });
    }, this.pingIntervalMs);
  }

  private stopPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }
}
