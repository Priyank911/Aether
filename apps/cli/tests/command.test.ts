import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtureServers, type FixtureServers } from '@aether/fixtures';

/*
 * Phase 3.5 exit (plan 3.2, task 3.5): `aether exec` runs the fixture shop
 * task from a cold start (the command starts the app itself), and every exit
 * code has a test: 0 done, 1 the run failed, 2 held, 3 unreachable, 4 usage.
 */

const CLI = path.resolve('apps/cli/dist/index.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], options: { input?: string; home: string; control?: string }, timeoutMs = 90000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        ...process.env,
        AETHER_HOME: options.home,
        AETHER_HOLD_RETURN_MS: '1500',
        ...(options.control ? { AETHER_TEST_CONTROL: options.control } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk as string;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk as string;
    });
    const timer = setTimeout(() => child.kill(), timeoutMs - 5000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });
}

interface ControlClient {
  request<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): void;
}

function connectControl(file: string): Promise<ControlClient> {
  return new Promise((resolve, reject) => {
    const { port, token } = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string };
    const socket: Socket = connect(port, '127.0.0.1');
    let buffer = '';
    const pending = new Map<number, (reply: { result?: unknown; error?: string }) => void>();
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const reply = JSON.parse(line) as { id?: number; result?: unknown; error?: string };
        const waiter = reply.id === undefined ? undefined : pending.get(reply.id);
        if (reply.id !== undefined) pending.delete(reply.id);
        waiter?.(reply);
      }
    });
    socket.once('connect', () => {
      let next = 1;
      let first = true;
      resolve({
        request: <T>(op: string, args: Record<string, unknown> = {}) =>
          new Promise<T>((resolveRequest, rejectRequest) => {
            const id = next++;
            pending.set(id, (reply) => {
              if (reply.error) rejectRequest(new Error(reply.error));
              else resolveRequest(reply.result as T);
            });
            socket.write(`${JSON.stringify({ id, op, args, ...(first ? { token } : {}) })}\n`);
            first = false;
          }),
        close: () => socket.destroy(),
      });
    });
  });
}

describe('the aether command (Phase 3.5)', () => {
  let fixtures: FixtureServers;
  let home: string;
  let controlFile: string;

  beforeAll(async () => {
    fixtures = await startFixtureServers(4201, 4202);
    home = mkdtempSync(path.join(os.tmpdir(), 'aether-cli-'));
    controlFile = path.join(home, 'test-control.json');
  }, 30000);

  afterAll(async () => {
    // The app the command started keeps aether.db open; ask it to quit first.
    if (existsSync(controlFile)) {
      try {
        const control = await connectControl(controlFile);
        await control.request('quit');
        control.close();
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch {
        // The app may already be gone; the rm below retries on Windows.
      }
    }
    await fixtures?.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  });

  it('runs the shop task from a cold start: the command starts the app and exits 0', async () => {
    const script = `const page = await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/shop/list?page=1`)});\nreturn page.title;`;
    const result = await runCli(['exec', '--space', 'Command shop', '--thought', 'Open the shop'], { input: script, home, control: controlFile }, 120000);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^done in Space "Command shop" in [\d.]+ s:\n<page untrusted nonce=\w+/);
  }, 150000);

  it('a failing script exits 1 with the error text', async () => {
    const result = await runCli(['exec', '--space', 'Fail', '--thought', 'Break'], { input: 'return (null as unknown as { x: { y: number } }).x.y;', home });
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^error in Space "Fail" at line 1:\d+:/);
  }, 90000);

  it('bad usage exits 4', async () => {
    const result = await runCli(['exec', '--thought', 'no script'], { input: '', home });
    expect(result.code).toBe(4);
    expect(result.stderr).toContain('aether exec needs a script');
  }, 60000);

  it('an irreversible step exits 2 with a token, and wait returns the result after approval', async () => {
    const script = [
      `await space.open(${JSON.stringify(`${fixtures.mainBaseUrl}/injection.html`)});`,
      `const found = await space.find('Transfer Funds', 'button');`,
      `const result = await space.act([{ op: 'click', ref: found[0]!.ref }], { risk: 'irreversible', why: 'Move money' });`,
      `return { delta: result.delta };`,
    ].join('\n');
    const held = await runCli(['exec', '--space', 'Command hold', '--thought', 'Move money'], { input: script, home, control: controlFile }, 120000);
    expect(held.code, `stdout: ${held.stdout} | stderr: ${held.stderr}`).toBe(2);
    const token = /wait "(\w+)"/.exec(held.stdout)?.[1] ?? '';
    expect(token).not.toBe('');
    expect(existsSync(controlFile)).toBe(true);
    const control = await connectControl(controlFile);
    const spaceId = 'command-hold';
    const pending = await control.request<{ id: string; reason: string } | undefined>('pending', { spaceId });
    expect(pending?.reason).toBe('approval');
    await control.request('runReply', { spaceId, id: pending?.id, kind: 'approve' });
    const finished = await runCli(['wait', token], { home, control: controlFile }, 60000);
    expect(finished.code).toBe(0);
    expect(finished.stdout).toContain('ok 1/1');
    control.close();
  }, 180000);

  it('an unreachable service exits 3', async () => {
    const lonely = mkdtempSync(path.join(os.tmpdir(), 'aether-cli-'));
    // The pid is alive (this test process), but nothing listens on the endpoint, so connect fails.
    writeFileSync(
      path.join(lonely, 'daemon.json'),
      JSON.stringify({ version: 1, pid: process.pid, endpoint: '\\\\.\\pipe\\aether-nothing-here', token: '0'.repeat(64), appVersion: '0.0.0', startedAt: Date.now() }),
    );
    const result = await runCli(['status'], { home: lonely }, 30000);
    expect(result.code).toBe(3);
    rmSync(lonely, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }, 60000);

  it('aether skill prints the method and the SDK', async () => {
    const result = await runCli(['skill'], { home });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Method for search, shopping and booking');
    expect(result.stdout).toContain('declare const space');
  }, 60000);
});
