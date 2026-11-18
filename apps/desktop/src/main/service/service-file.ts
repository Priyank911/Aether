import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { DaemonConfigSchema, DAEMON_PROTOCOL_VERSION, type DaemonConfig } from '@aether/shared';

/*
 * ~/.aether/daemon.json (plan 3.2, section 4.2): how hosts find the one app
 * service. Written at start, removed on a clean exit, replaced by the next
 * start when a previous app died without cleaning up.
 */

export function serviceEndpoint(home: string): string {
  if (process.platform === 'win32') {
    // Pipe names keep a flat namespace; the user name scopes it to this account.
    // Each test app instance gets its own name, because the single-instance
    // lock is per profile and the suite runs several apps at once.
    const user = userInfo().username.replace(/[^A-Za-z0-9_-]/g, '') || 'user';
    const scope = process.env.AETHER_TEST_CONTROL ? randomUUID().slice(0, 8) : user;
    return `\\\\.\\pipe\\aether-${scope}`;
  }
  return path.join(home, 'aether.sock');
}

export function writeServiceFile(file: string, endpoint: string, appVersion: string): DaemonConfig {
  const config: DaemonConfig = {
    version: DAEMON_PROTOCOL_VERSION,
    pid: process.pid,
    endpoint,
    token: randomBytes(32).toString('hex'),
    appVersion,
    startedAt: Date.now(),
  };
  writeFileSync(file, `${JSON.stringify(config, null, 1)}\n`, { mode: 0o600 });
  return config;
}

export function removeServiceFile(file: string): void {
  rmSync(file, { force: true });
}

/** The service this file points at, if the file parses and its process is still alive. */
export function readServiceFile(file: string): DaemonConfig | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = DaemonConfigSchema.safeParse(parsed);
  if (!result.success) return undefined;
  const config = result.data;
  try {
    // Signal 0 asks whether the process is alive without touching it.
    process.kill(config.pid, 0);
  } catch {
    return undefined;
  }
  return config;
}
