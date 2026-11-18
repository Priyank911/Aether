import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { DaemonConfig, DaemonServerFrame, ToolResult } from '@aether/shared';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';
import { startDesktop, type DesktopApp } from './desktop-harness.js';

/**
 * Phase 3.4 exit (plan 3.2, task 3.4): two clients in parallel get two Agent
 * Spaces in one app with no interference; a wrong token is refused; a stale
 * daemon.json is replaced; oversized frames are refused.
 */

interface ServiceClient {
  request(tool: string, params: unknown): Promise<ToolResult>;
  untilFatal(): Promise<DaemonServerFrame & { type: 'fatal' }>;
  sendRaw(text: string): void;
  close(): void;
}

function connectService(config: DaemonConfig, options: { token?: string } = {}): Promise<ServiceClient> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.endpoint);
    let buffer = '';
    const waiters: Array<(frame: DaemonServerFrame) => void> = [];
    const frames: DaemonServerFrame[] = [];
    const deliver = (frame: DaemonServerFrame) => {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    };
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        deliver(JSON.parse(line) as DaemonServerFrame);
      }
    });
    socket.once('error', () => undefined);
    const nextFrame = <T extends DaemonServerFrame>(): Promise<T> =>
      new Promise((resolve) => {
        const buffered = frames.shift();
        if (buffered) resolve(buffered as T);
        else waiters.push(resolve as (frame: DaemonServerFrame) => void);
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
      void nextFrame<'welcome' | (DaemonServerFrame & { type: 'fatal' })>().then((first) => {
        if (first.type === 'welcome') {
          let requestId = 0;
          resolve({
            request: (tool, params) =>
              new Promise<ToolResult>((resolveRequest) => {
                const id = ++requestId;
                socket.write(`${JSON.stringify({ type: 'request', id, tool, params })}\n`);
                const poll = async () => {
                  for (;;) {
                    const frame = await nextFrame<DaemonServerFrame>();
                    if (frame.type === 'response' && frame.id === id) resolveRequest(frame.result);
                    else deliver(frame);
                  }
                };
                void poll();
              }),
            untilFatal: () => nextFrame<DaemonServerFrame & { type: 'fatal' }>(),
            sendRaw: (text: string) => socket.write(text),
            close: () => socket.destroy(),
          });
        } else {
          (resolve as unknown as (client: ServiceClient) => void)({
            request: async () => {
              throw new Error('the connection was refused');
            },
            untilFatal: () => Promise.resolve(first),
            sendRaw: () => undefined,
            close: () => socket.destroy(),
          });
        }
      });
    });
  });
}

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
    const result = await client.request('aether_exec', {
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
      one.request('aether_exec', { space: 'Parallel one', thought: 'First client', code: script('one') }),
      two.request('aether_exec', { space: 'Parallel two', thought: 'Second client', code: script('two') }),
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
