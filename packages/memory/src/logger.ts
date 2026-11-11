import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import pino, { type Logger } from 'pino';

export const DEFAULT_LOG_PATH = path.join(homedir(), '.aether', 'aether.log');

/**
 * JSON-lines log to a file. Never stdout: in MCP mode stdout carries the
 * protocol. Values that look like secrets are never passed to the logger by
 * callers; tool arguments are logged by name, not content.
 */
export function createLogger(file = DEFAULT_LOG_PATH, level = process.env.AETHER_LOG_LEVEL ?? 'info'): Logger {
  mkdirSync(path.dirname(file), { recursive: true });
  return pino({ level, base: { pid: process.pid } }, pino.destination({ dest: file, sync: false, mkdir: true }));
}

export type { Logger };
