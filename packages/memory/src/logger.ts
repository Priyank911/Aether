import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

export const DEFAULT_LOG_PATH = path.join(homedir(), '.aether', 'aether.log');
export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_KEEP = 3;

/*
 * Log rotation (plan 3.2, task 3.9): ~/.aether/aether.log rotates at process
 * start and whenever it passes the size limit (10 MB by default,
 * AETHER_LOG_MAX_BYTES overrides), keeping LOG_KEEP rotated files
 * (aether.log.1 is the newest). The app and the CLI share the file; every
 * line carries the process name in `proc`.
 *
 * The stream appends with open/write/close per flush instead of holding a
 * descriptor, so rotation is a plain rename that works on Windows too.
 */

function logMaxBytes(): number {
  const override = Number(process.env.AETHER_LOG_MAX_BYTES);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_LOG_MAX_BYTES;
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Shift aether.log.N one step older and move the live log to .1. */
function rotate(file: string, keep: number): void {
  const oldest = `${file}.${keep}`;
  if (existsSync(oldest)) rmSync(oldest, { force: true });
  for (let index = keep - 1; index >= 1; index--) {
    const from = `${file}.${index}`;
    if (existsSync(from)) renameSync(from, `${file}.${index + 1}`);
  }
  if (existsSync(file)) renameSync(file, `${file}.1`);
  // The live file always exists, even when the rotation was the last write.
  appendFileSync(file, '');
}

class RotatingLogStream extends Writable {
  private size: number;

  public constructor(
    private readonly file: string,
    private readonly maxBytes: number,
    private readonly keep: number,
  ) {
    super();
    mkdirSync(path.dirname(file), { recursive: true });
    if (sizeOf(file) > this.maxBytes) rotate(file, this.keep);
    this.size = sizeOf(file);
  }

  public override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      appendFileSync(this.file, chunk);
      this.size += chunk.length;
      if (this.size > this.maxBytes) {
        rotate(this.file, this.keep);
        this.size = 0;
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * JSON-lines log to a file. Never stdout: in MCP mode stdout carries the
 * protocol. Values that look like secrets are never passed to the logger by
 * callers; tool arguments are logged by name, not content.
 */
export function createLogger(file = DEFAULT_LOG_PATH, level = process.env.AETHER_LOG_LEVEL ?? 'info', proc = 'aether'): Logger {
  return pino({ level, base: { pid: process.pid, proc } }, new RotatingLogStream(file, logMaxBytes(), LOG_KEEP));
}

export type { Logger };
