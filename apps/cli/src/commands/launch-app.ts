import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DaemonConfig } from '@aether/shared';
import { readServiceConfig } from './service-client.js';

/*
 * Start Aether Desktop when a host needs it and the person has not opened it
 * (plan 3.2, section 4.2). The window opens only if the app was not running;
 * a second copy is impossible (the app's single-instance lock). The command
 * waits up to 15 s for the service, then gives up with exit code 3.
 */

const WAIT_MS = 15_000;
const POLL_MS = 200;

/** The desktop app next to this CLI: apps/cli/dist/commands -> apps/desktop. */
function appDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', 'desktop');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runningService(home: string): DaemonConfig | undefined {
  const config = readServiceConfig(home);
  if (!config) return undefined;
  if (process.platform !== 'win32' && !existsSync(config.endpoint)) return undefined;
  return config;
}

export async function ensureAppRunning(home: string): Promise<DaemonConfig | undefined> {
  const config = runningService(home);
  if (config) return config;
  if (!launch(home)) return undefined;
  const started = Date.now();
  for (;;) {
    await sleep(POLL_MS);
    const ready = runningService(home);
    if (ready) return ready;
    if (Date.now() - started > WAIT_MS) return undefined;
  }
}

/** Start the app detached, once; false only when the app is not found. */
function launch(home: string): boolean {
  const dir = appDir();
  const pkg = path.join(dir, 'package.json');
  if (!existsSync(pkg)) return false;
  let electron: string;
  try {
    electron = createRequire(pkg)('electron') as string;
  } catch {
    return false;
  }
  if (!existsSync(electron)) return false;
  const env: NodeJS.ProcessEnv = { ...process.env, AETHER_HOME: home };
  // Electron run from inside another Electron app (an IDE, Devin) inherits
  // ELECTRON_RUN_AS_NODE=1 and then runs as plain Node, not as the browser.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [dir], {
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return true;
}
