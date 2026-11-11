import { EngineMessageSchema, type ConnectionState, type EngineMessage, type ExtensionMessage } from '@aether/shared';

export interface BridgeAddress {
  port: number;
  token: string;
}

interface Handlers {
  onMessage: (message: EngineMessage) => void;
  onState: (state: ConnectionState, detail: string) => void;
}

const MAX_RETRY_MS = 10000;

/**
 * The extension end of the bridge: a WebSocket from the service worker to the
 * engine on 127.0.0.1. Chrome sets the Origin header to this extension; the
 * first message carries the token. Messages flowing on it keep the service
 * worker alive.
 */
export class EngineSocket {
  private socket?: WebSocket;
  private address?: BridgeAddress;
  private retryMs = 500;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly handlers: Handlers;

  constructor(handlers: Handlers) {
    this.handlers = handlers;
  }

  public setAddress(address: BridgeAddress | undefined): void {
    if (address && this.address && address.port === this.address.port && address.token === this.address.token) return;
    this.address = address;
    this.retryMs = 500;
    this.drop();
    if (address) this.connect();
    else this.handlers.onState('waiting_engine', 'Waiting for your MCP agent to start Aether');
  }

  public send(message: ExtensionMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private drop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  private connect(): void {
    const address = this.address;
    if (!address) return;
    this.handlers.onState('connecting', 'Connecting to Aether');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/extension`);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'aether.hello', token: address.token, version: chrome.runtime.getManifest().version }));
      this.retryMs = 500;
      this.handlers.onState('connected', 'Connected to Aether');
    };
    socket.onmessage = (event: MessageEvent) => {
      let message: EngineMessage;
      try {
        message = EngineMessageSchema.parse(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      if ('type' in message && message.type === 'aether.ping') {
        this.send({ type: 'aether.pong', n: message.n });
        return;
      }
      this.handlers.onMessage(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.handlers.onState('waiting_engine', 'Aether is not running; reconnecting when it starts');
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }
}
