import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, createServer, type Socket } from 'node:net';
import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DaemonClientFrameSchema, DaemonServerFrameSchema, type DaemonConfig, type DaemonFatal, type ToolResult } from '@aether/shared';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

/**
 * Phase 3.4 exit (plan 3.2, task 3.4): two clients in parallel get two Agent
 * Spaces in one app with no interference; a wrong token is refused; a stale
 * daemon.json is replaced; oversized frames are refused.
 */

interface ServiceClient {
  request(tool: string, params: unknown): Promise<ToolResult>;
  untilFatal(): Promise<DaemonFatal>;
  sendRaw(text: string): void;
  close(): void;
}

const clients = new Set<ServiceClient>();

afterEach(() => {
  for (const client of clients) client.close();
});

function connectService(config: DaemonConfig, options: { token?: string } = {}): Promise<ServiceClient> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.endpoint);
    const pending = new Map<number, { resolve: (result: ToolResult) => void; reject: (error: Error) => void }>();
    const fatalWaiters = new Set<{ resolve: (fatal: DaemonFatal) => void; reject: (error: Error) => void }>();
    let buffer = '';
    let requestId = 0;
    let failure: Error | undefined;
    let fatal: DaemonFatal | undefined;
    const fail = (error: Error) => {
      failure ??= error;
      reject(failure);
      for (const waiter of pending.values()) waiter.reject(failure);
      pending.clear();
      for (const waiter of fatalWaiters) waiter.reject(failure);
      fatalWaiters.clear();
      socket.destroy();
    };
    const client: ServiceClient = {
      request: (tool, params) => {
        if (failure) return Promise.reject(failure);
        return new Promise<ToolResult>((resolveRequest, rejectRequest) => {
          const id = ++requestId;
          pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
          socket.write(`${JSON.stringify({ type: 'request', id, tool, params })}\n`);
        });
      },
      untilFatal: () => {
        if (fatal) return Promise.resolve(fatal);
        if (failure) return Promise.reject(failure);
        return new Promise((resolveFatal, rejectFatal) => fatalWaiters.add({ resolve: resolveFatal, reject: rejectFatal }));
      },
      sendRaw: (text) => socket.write(text),
      close: () => {
        fail(new Error('service test client closed'));
        clients.delete(client);
      },
    };
    // Track before the handshake so failed or timed-out connections are cleaned up too.
    clients.add(client);
    socket.setEncoding('utf8');
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('service connection closed')));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (!failure) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const frame = DaemonServerFrameSchema.parse(JSON.parse(line));
          if (frame.type === 'welcome') resolve(client);
          else if (frame.type === 'fatal') {
            fatal = frame;
            for (const waiter of fatalWaiters) waiter.resolve(frame);
            fatalWaiters.clear();
            // Refused handshakes still expose untilFatal() for the bad-token test.
            resolve(client);
            fail(new Error(`service fatal ${frame.code}: ${frame.message}`));
          } else {
            const waiter = pending.get(frame.id);
            pending.delete(frame.id);
            waiter?.resolve(frame.result);
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    socket.once('connect', () => {
      socket.write(
        `${JSON.stringify({
          type: 'hello',
          protocol: config.version,
          token: options.token ?? config.token,
          client: { kind: 'test', name: 'service-test', version: '0.0.0' },
        })}\n`,
      );
    });
  });
}

async function execToEnd(client: ServiceClient, params: { space: string; thought: string; code: string }): Promise<ToolResult> {
  let result = await client.request('aether_exec', params);
  for (let poll = 0; poll < 20 && result.text.startsWith('held in Space'); poll++) {
    const token = /wait "(\w+)"/.exec(result.text)?.[1];
    if (!token) throw new Error(`held result has no wait token: ${result.text}`);
    result = await client.request('aether_exec', { space: params.space, thought: 'Waiting for the result', wait: token });
  }
  if (result.text.startsWith('held in Space')) throw new Error(`exec still held after 20 polls: ${result.text}`);
  return result;
}

describe('service test client dispatch', () => {
  it.each(['fatal', 'close'] as const)('keeps timers running after completed requests and rejects pending requests on %s', async (shutdown) => {
    const name = `aether-service-test-${randomUUID()}`;
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.setEncoding('utf8');
      let buffer = '';
      const ids: number[] = [];
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const end = buffer.indexOf('\n');
          if (end < 0) return;
          const frame = DaemonClientFrameSchema.parse(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
          if (frame.type === 'hello') {
            socket.write(`${JSON.stringify({ type: 'welcome', session: 'regression', appVersion: 'test' })}\n`);
          } else {
            ids.push(frame.id);
            if (ids.length === 2) {
              for (const id of [...ids].reverse()) socket.write(`${JSON.stringify({ type: 'response', id, result: { text: String(id), isError: false } })}\n`);
            } else if (ids.length === 3) {
              if (shutdown === 'fatal') socket.end(`${JSON.stringify({ type: 'fatal', code: 'shutting_down', message: 'test shutdown' })}\n`);
              else socket.end();
            }
          }
        }
      });
    });
    let client: ServiceClient | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, resolve);
      });
      client = await connectService({ version: 1, pid: process.pid, endpoint, token: '0'.repeat(64), appVersion: 'test', startedAt: Date.now() });
      const completed = await Promise.all([client.request('aether_spaces', {}), client.request('aether_spaces', {})]);
      expect(completed.map((result) => result.text)).toEqual(['1', '2']);
      const fatal = client.untilFatal();
      const terminal = shutdown === 'fatal' ? expect(fatal).resolves.toMatchObject({ code: 'shutting_down' }) : expect(fatal).rejects.toThrow('service connection closed');
      await Promise.all([
        terminal,
        expect(client.request('aether_spaces', {})).rejects.toThrow(shutdown === 'fatal' ? 'shutting_down' : 'service connection closed'),
      ]);
      await expect(client.request('aether_spaces', {})).rejects.toThrow();
      await expect(new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 0))).resolves.toBe(true);
    } finally {
      client?.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 5000);
});

describe('App service (Phase 3.4)', () => {
  let fixtures: FixtureServers;
  let app: DesktopApp;
  let config: DaemonConfig;

  beforeAll(async () => {
    process.env.AETHER_HOLD_RETURN_MS = '1500';
    fixtures = await startFixtureServers(4197, 4198);
    app = await startDesktop({ keepHome: true });
    const file = path.join(app.home, 'daemon.json');
    config = JSON.parse(readFileSync(file, 'utf8')) as DaemonConfig;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await fixtures?.close();
  });

  it('serves the shop task over the wire, with the untrusted wrapper intact', async () => {
    const client = await connectService(config);
    const result = await execToEnd(client, {
      space: 'Service shop',
      thought: 'Open the shop',
      code: `const page = await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/shop/list?page=1`)});\nreturn page.title;`,
    });
    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^done in Space "Service shop" in [\d.]+ s:\n<page untrusted nonce=\w+/);
    client.close();
  }, 90000);

  it('runs two clients in parallel, each in its own Space, with no interference', async () => {
    const one = await connectService(config);
    const two = await connectService(config);
    const script = (marker: string) =>
      `await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/shop/item/1`)});\nawait space.logStep(${JSON.stringify(marker)});\nreturn ${JSON.stringify(marker)};`;
    const [first, second] = await Promise.all([
      execToEnd(one, { space: 'Parallel one', thought: 'First client', code: script('one') }),
      execToEnd(two, { space: 'Parallel two', thought: 'Second client', code: script('two') }),
    ]);
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(first.text).toContain('"one"');
    expect(second.text).toContain('"two"');
    const listing = await one.request('aether_spaces', { op: 'list' });
    expect(listing.text).toContain('Parallel one');
    expect(listing.text).toContain('Parallel two');
    one.close();
    two.close();
  }, 90000);

  it('refuses a wrong token with fatal and closes', async () => {
    const client = await connectService(config, { token: '0'.repeat(64) });
    const fatal = await client.untilFatal();
    expect(fatal.code).toBe('bad_token');
    client.close();
  });

  it('refuses frames that are not one JSON object per line', async () => {
    const client = await connectService(config);
    client.sendRaw('this is not json\n');
    const fatal = await client.untilFatal();
    expect(fatal.code).toBe('bad_frame');
    client.close();
  }, 15000);

  it('writes daemon.json with a live pid and a strong token', () => {
    const file = path.join(app.home, 'daemon.json');
    expect(existsSync(file)).toBe(true);
    expect(config.version).toBe(1);
    expect(config.token.length).toBeGreaterThanOrEqual(32);
    let alive = true;
    try {
      process.kill(config.pid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(true);
  });
});
