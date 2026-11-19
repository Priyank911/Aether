import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger } from '@aether/memory';

/*
 * Phase 3.9 (plan 3.2, task 3.9): ~/.aether/aether.log rotates at start and at
 * the size limit, keeping rotated files, with the process name on each line.
 */

const dirs: string[] = [];

function tempLog(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aether-log-'));
  dirs.push(dir);
  return path.join(dir, 'aether.log');
}

afterEach(() => {
  delete process.env.AETHER_LOG_MAX_BYTES;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('log rotation (Phase 3.9)', () => {
  it('rotates at the size limit and keeps the rotated files', async () => {
    process.env.AETHER_LOG_MAX_BYTES = '2048';
    const file = tempLog();
    const logger = createLogger(file, 'info', 'aether-test');
    for (let index = 0; index < 200; index++) logger.info({ index }, 'a line of the log');
    logger.flush();
    // The stream appends asynchronously; give the queued writes a moment.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThan(2048 + 4096);
    const rotated = readFileSync(`${file}.1`, 'utf8');
    expect(rotated).toContain('"proc":"aether-test"');
    expect(rotated).toContain('"pid":');
  });

  it('rotates an oversized log at start', async () => {
    const file = tempLog();
    const first = createLogger(file, 'info', 'aether-test');
    for (let index = 0; index < 100; index++) first.info('filler line to grow the file');
    first.flush();
    expect(statSync(file).size).toBeGreaterThan(1000);

    process.env.AETHER_LOG_MAX_BYTES = '100';
    const second = createLogger(file, 'info', 'aether-test');
    second.info('after rotation');
    second.flush();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('filler line');
    expect(readFileSync(file, 'utf8')).toContain('after rotation');
  });
});
