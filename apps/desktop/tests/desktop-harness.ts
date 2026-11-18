import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Starts the real Aether Desktop (built main process) in a temporary Aether
 * home, so tests never touch the person's profile, and talks to its test
 * control channel. The windows open beyond every display, without focus.
 */
export interface DesktopApp {
  home: string;
  request<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
  exited: Promise<number | null>;
}

const APP_DIR = path.resolve('apps/desktop');
const electronPath = createRequire(path.join(APP_DIR, 'package.json'))('electron') as string;

async function waitFor<T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function startDesktop(options: { home?: string; keepHome?: boolean } = {}): Promise<DesktopApp> {
  const home = options.home ?? mkdtempSync(path.join(os.tmpdir(), 'aether-desktop-'));
  const controlFile = path.join(home, 'test-control.json');
  rmSync(controlFile, { force: true });
  const child: ChildProcess = spawn(electronPath, [APP_DIR], {
    env: { ...process.env, AETHER_HOME: home, AETHER_TEST_CONTROL: controlFile, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  let failed = false;
  void exited.then(() => {
    failed = true;
  });
  const { port, token } = await waitFor(
    () => {
      if (failed) throw new Error(`Aether Desktop exited during start:\n${stderr.slice(-2000)}`);
      if (!existsSync(controlFile)) return undefined;
      try {
        return JSON.parse(readFileSync(controlFile, 'utf8')) as { port: number; token: string };
      } catch {
        return undefined;
      }
    },
    30000,
    'the test control file',
  );
  const socket: Socket = await new Promise((resolve, reject) => {
    const created = connect(port, '127.0.0.1', () => resolve(created));
    created.once('error', reject);
  });
  socket.setEncoding('utf8');
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n');
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
      const reply = JSON.parse(line) as { id: number; result?: unknown; error?: string };
      const waiter = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.error) waiter?.reject(new Error(reply.error));
      else waiter?.resolve(reply.result);
    }
  });
  let next = 1;
  let first = true;
  const request = <T>(op: string, args: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.write(`${JSON.stringify({ id, op, args, ...(first ? { token } : {}) })}\n`);
      first = false;
    });
  return {
    home,
    request,
    exited,
    close: async () => {
      await request('quit').catch(() => undefined);
      const done = await Promise.race([exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000))]);
      if (!done) child.kill();
      socket.destroy();
      if (!options.keepHome) rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
