import type { Readable, Writable } from 'node:stream';
import WebSocket from 'ws';

/** A duplex channel of CDP JSON messages. */
export interface CDPTransport {
  send(message: string): void;
  onMessage(listener: (message: string) => void): void;
  onClose(listener: (reason: string) => void): void;
  close(): void;
}

/** CDP over a DevTools WebSocket endpoint. */
export class WebSocketTransport implements CDPTransport {
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public static connect(url: string): Promise<WebSocketTransport> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
      socket.once('open', () => resolve(new WebSocketTransport(socket)));
      socket.once('error', reject);
    });
  }

  public send(message: string): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP connection is closed');
    this.socket.send(message);
  }

  public onMessage(listener: (message: string) => void): void {
    this.socket.on('message', (data: WebSocket.RawData) => listener(data.toString()));
  }

  public onClose(listener: (reason: string) => void): void {
    this.socket.on('close', (_code, reason) => listener(reason.toString() || 'socket closed'));
  }

  public close(): void {
    this.socket.close();
  }
}

/** CDP over --remote-debugging-pipe: NUL-separated JSON on the child's fd 3 (to Chrome) and fd 4 (from Chrome). */
export class PipeTransport implements CDPTransport {
  private readonly writable: Writable;
  private readonly readable: Readable;
  private buffer = '';
  private closed = false;
  private readonly closeListeners: Array<(reason: string) => void> = [];

  constructor(writable: Writable, readable: Readable) {
    this.writable = writable;
    this.readable = readable;
    this.readable.on('close', () => this.finish('pipe closed'));
    this.writable.on('error', () => this.finish('pipe error'));
  }

  public send(message: string): void {
    if (this.closed) throw new Error('CDP connection is closed');
    this.writable.write(`${message}\0`);
  }

  public onMessage(listener: (message: string) => void): void {
    this.readable.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      let end = this.buffer.indexOf('\0');
      while (end >= 0) {
        const message = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (message) listener(message);
        end = this.buffer.indexOf('\0');
      }
    });
  }

  public onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  public close(): void {
    this.writable.end();
    this.finish('closed');
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener(reason);
  }
}
