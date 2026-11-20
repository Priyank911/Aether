import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture } from '../scripts/spikes/s6/fixture.mjs';
import { inspectProfile } from '../scripts/spikes/s6/profile.mjs';

describe('S6 isolated Chrome profile probe', () => {
  let root: string;
  let fixtureKey: Buffer | undefined;
  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'aether-s6-test-'));
    fixtureKey = createFixture(path.join(root, 'source')).fixtureKey;
  }, 60000);
  afterAll(() => { fixtureKey?.fill(0); if (root) rmSync(root, { recursive: true, force: true }); });

  function copy(name: string): { profile: string; tempRoot: string } {
    const directory = path.join(root, name);
    cpSync(path.join(root, 'source'), directory, { recursive: true });
    const tempRoot = path.join(directory, 'copies');
    mkdirSync(tempRoot);
    return { profile: path.join(directory, 'Default'), tempRoot };
  }

  it('counts data, validates GCM/host binding, skips v20 and leaves the source unchanged', () => {
    const { profile, tempRoot } = copy('valid');
    const files = ['Bookmarks', 'History', path.join('Network', 'Cookies')];
    const digest = (file: string) => createHash('sha256').update(readFileSync(path.join(profile, file))).digest('hex');
    const before = files.map(digest);
    const report = inspectProfile(profile, { fixtureKey, tempRoot });
    expect(report).toEqual({
      bookmarks: 2, historyUrls: 1,
      cookies: { total: process.platform === 'win32' ? 7 : 6, plaintext: 1, v10Decrypted: 1, v10Failed: 2, v20Skipped: 1, legacyDpapiDecrypted: process.platform === 'win32' ? 1 : 0, unsupported: 1 },
      keyProbe: process.platform === 'win32' ? 'dpapi-unwrapped' : 'fixture-key', temporaryCopiesRemoved: true,
    });
    expect(files.map(digest)).toEqual(before);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/example\.invalid|synthetic-cookie|synthetic-plaintext|Synthetic history/);
  }, 60000);

  it('refuses an active WAL and removes temporary copies after the error', () => {
    const { profile, tempRoot } = copy('journal');
    writeFileSync(path.join(profile, 'Network', 'Cookies-wal'), 'active journal');
    expect(() => inspectProfile(profile, { fixtureKey, tempRoot })).toThrow('active journal');
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(readFileSync(path.join(profile, 'Network', 'Cookies-wal'), 'utf8')).toBe('active journal');
  });

  it('cleans temporary copies when SQLite cannot read a copied database', () => {
    const { profile, tempRoot } = copy('broken-db');
    writeFileSync(path.join(profile, 'Network', 'Cookies'), 'not a SQLite database');
    expect(() => inspectProfile(profile, { fixtureKey, tempRoot })).toThrow();
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('reports an unavailable key without returning cookie values', () => {
    const { profile, tempRoot } = copy('missing-key');
    writeFileSync(path.join(profile, '..', 'Local State'), '{}');
    const report = inspectProfile(profile, { tempRoot });
    expect(report.keyProbe).toBe('unavailable');
    expect(report.cookies.v10Failed).toBe(3);
    expect(report.cookies.v10Decrypted).toBe(0);
    expect(report.cookies.v20Skipped).toBe(1);
    expect(readdirSync(tempRoot)).toEqual([]);
  }, 60000);

  it('runs the standalone fixture command with explicit partial-evidence labels', () => {
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/spikes/s6-chrome-import.mts', '--fixture'], { encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(output)).toMatchObject({ mode: 'synthetic-fixture', temporaryCopiesRemoved: true, fixtureRemoved: true, googleSignIn: 'not-run', bankSignIn: 'not-run', appBoundDecryption: 'not-attempted-v20-skipped' });
    expect(output).not.toMatch(/example\.invalid|synthetic-cookie|synthetic-plaintext|Synthetic history/);
  }, 60000);
});
