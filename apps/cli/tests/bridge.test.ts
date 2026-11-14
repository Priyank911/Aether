import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CDPClient } from '@aether/cdp';
import { ExtensionBridge } from '../src/mcp/bridge.js';
import { RunState } from '../src/run/run-state.js';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

interface FakeExtension {
  socket: WebSocket;
  messages: unknown[];
  next: (predicate: (message: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>;
}

describe('extension bridge', () => {
  let bridge: ExtensionBridge | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function startBridge(pingIntervalMs?: number): Promise<ExtensionBridge> {
    directory = await mkdtemp(path.join(tmpdir(), 'aether-bridge-'));
    bridge = new ExtensionBridge(path.join(directory, 'bridge.json'), pingIntervalMs);
    await bridge.start();
    return bridge;
  }

  function open(origin = ORIGIN): Promise<WebSocket> {
    const { port } = bridge?.address ?? { port: 0 };
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers: { Origin: origin }, maxPayload: 64 * 1024 * 1024 });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  /** A socket that has said hello, recording what the engine sends it. */
  async function connectExtension(options: { answerPings?: boolean } = {}): Promise<FakeExtension> {
    const socket = await open();
    const messages: unknown[] = [];
    const waiters: Array<[(message: Record<string, unknown>) => boolean, (message: Record<string, unknown>) => void]> = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === 'aether.ping' && options.answerPings !== false) socket.send(JSON.stringify({ type: 'aether.pong', n: message.n }));
      messages.push(message);
      for (const [index, [predicate, resolve]] of [...waiters.entries()]) {
        if (predicate(message)) {
          waiters.splice(index, 1);
          resolve(message);
        }
      }
    });
    const connected = new Promise<void>((resolve) => bridge?.once('connected', () => resolve()));
    socket.send(JSON.stringify({ type: 'aether.hello', token: bridge?.address.token, version: 'test' }));
    await connected;
    return {
      socket,
      messages,
      next: (predicate) => {
        const found = messages.find((message) => predicate(message as Record<string, unknown>));
        if (found) return Promise.resolve(found as Record<string, unknown>);
        return new Promise((resolve) => waiters.push([predicate, resolve]));
      },
    };
  }

  function closed(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
  }

  it('refuses a socket whose Origin is not a Chrome extension', async () => {
    await startBridge();
    await expect(open('http://evil.example')).rejects.toThrow();
  });

  it('closes a socket that sends the wrong token', async () => {
    await startBridge();
    const socket = await open();
    socket.send(JSON.stringify({ type: 'aether.hello', token: 'f'.repeat(64), version: 'test' }));
    expect(await closed(socket)).toBe(4401);
  });

  it('closes a socket that sends something other than hello first', async () => {
    await startBridge();
    const socket = await open();
    socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
    expect(await closed(socket)).toBe(4401);
  });

  it('carries CDP both ways, including a 5 MiB response that native messaging could not', async () => {
    await startBridge();
    const extension = await connectExtension();
    const client = CDPClient.over(bridge?.transport ?? (undefined as never));
    const big = 'x'.repeat(5 * 1024 * 1024);
    void extension.next((message) => message.method === 'Runtime.evaluate').then((request) => {
      extension.socket.send(JSON.stringify({ id: request.id, result: { result: { value: big } } }));
    });
    const result = await client.sendCommand<{ result: { value: string } }>('Runtime.evaluate', { expression: 'big' });
    expect(result.result.value.length).toBe(big.length);
  });

  it('fails a pending command as unverified when the extension drops before replying', async () => {
    await startBridge();
    const extension = await connectExtension();
    const client = CDPClient.over(bridge?.transport ?? (undefined as never));
    bridge?.on('reset', (reason: string) => client.resetSessions(reason));
    const pending = client.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    await extension.next((message) => message.method === 'Input.dispatchMouseEvent');
    extension.socket.close();
    await expect(pending).rejects.toThrow('delivery is unverified');
  });

  it('marks sessions detached when the extension reports a debugger detach', async () => {
    await startBridge();
    const extension = await connectExtension();
    const client = CDPClient.over(bridge?.transport ?? (undefined as never));
    bridge?.on('reset', (reason: string) => client.resetSessions(reason));
    void extension.next((message) => message.method === 'Target.attachToTarget').then((request) => {
      extension.socket.send(JSON.stringify({ id: request.id, result: { sessionId: 'tab-7' } }));
    });
    const session = await client.attachToTarget('7');
    const reset = new Promise<string>((resolve) => bridge?.once('reset', resolve));
    extension.socket.send(JSON.stringify({ type: 'aether.detached', reason: 'canceled_by_user' }));
    expect(await reset).toBe('the debugger detached: canceled_by_user');
    expect(session.isDetached).toBe(true);
  });

  it('sends run-state frames out and delivers replies and controls back', async () => {
    await startBridge();
    const run = new RunState();
    bridge?.attachRun(run);
    const extension = await connectExtension();
    await extension.next((message) => message.type === 'aether.state' && message.state === 'idle');
    const pending = run.hold('question', 'Which date?');
    const frame = await extension.next((message) => message.type === 'aether.state' && message.state === 'waiting_human');
    expect((frame.pending as { id: string }).id).toBe(pending.id);
    const answered = run.waitFor(pending.id, 2000);
    extension.socket.send(JSON.stringify({ type: 'aether.reply', id: pending.id, kind: 'answer', text: 'Friday' }));
    expect((await answered)?.text).toBe('Friday');
    extension.socket.send(JSON.stringify({ type: 'aether.control', kind: 'takeover' }));
    await extension.next((message) => message.type === 'aether.state' && (message.pending as { reason?: string } | undefined)?.reason === 'user_interrupted');
    expect(run.interrupted).toBe(true);
  });

  it('terminates a half-open socket that stops answering pings', async () => {
    await startBridge(50);
    const extension = await connectExtension({ answerPings: false });
    const disconnected = new Promise<void>((resolve) => bridge?.once('disconnected', () => resolve()));
    await disconnected;
    expect(extension.messages.filter((message) => (message as { type?: string }).type === 'aether.ping').length).toBeGreaterThanOrEqual(2);
  });
});
