import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ensureAppRunning } from './launch-app.js';
import { connectService, type ServiceConnection } from './service-client.js';
import type { DaemonConfig, ToolResult } from '@aether/shared';

/*
 * Shared plumbing for the service commands (plan 3.2, section 8.0): resolve
 * ~/.aether (or AETHER_HOME), reach the app service (launching the app when
 * it is not running), and turn a tool result into an exit code. Exit codes:
 * 0 done, 1 the run failed, 2 held, 3 the app could not be reached, 4 bad
 * usage.
 */

export const EXIT = { done: 0, failed: 1, held: 2, unreachable: 3, usage: 4 } as const;

export function aetherHome(): string {
  const home = process.env.AETHER_HOME || path.join(homedir(), '.aether');
  mkdirSync(home, { recursive: true });
  return home;
}

export async function withService(client: { name: string; version: string }, body: (connection: ServiceConnection, config: DaemonConfig) => Promise<number>): Promise<number> {
  const home = aetherHome();
  const config = await ensureAppRunning(home);
  if (!config) {
    process.stderr.write('Aether Desktop could not be started or reached.\n');
    return EXIT.unreachable;
  }
  let connection: ServiceConnection;
  try {
    connection = await connectService(config, client);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.unreachable;
  }
  try {
    return await body(connection, config);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.failed;
  } finally {
    connection.close();
  }
}

/** The tool's text to stdout, and the exit code it maps to. Held runs exit 2 with the token in the text. */
export function finish(result: ToolResult): number {
  if (result.text) process.stdout.write(`${result.text}\n`);
  if (result.meta?.status === 'held') return EXIT.held;
  return result.isError ? EXIT.failed : EXIT.done;
}

export function readScript(file: string | undefined): string | undefined {
  if (file) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      process.stderr.write(`could not read the script file: ${file}\n`);
      return undefined;
    }
  }
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Flags of the form --name value, plus bare values for the rest. */
export function flags(args: string[]): Record<string, string | true> {
  const parsed: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        parsed[arg.slice(2)] = next;
        index++;
      } else {
        parsed[arg.slice(2)] = true;
      }
    } else {
      parsed[arg] = true;
    }
  }
  return parsed;
}
