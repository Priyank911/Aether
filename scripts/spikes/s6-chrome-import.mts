/** S6 feasibility probe. Default: synthetic fixture; --profile must be explicit. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFixture } from './s6/fixture.mjs';
import { inspectProfile, type ProfileReport } from './s6/profile.mjs';

const args = process.argv.slice(2);
const [mode, profilePath] = args;
if (args.includes('--help')) {
  console.log('Usage: pnpm exec tsx scripts/spikes/s6-chrome-import.mts [--fixture | --profile "absolute Chrome profile path"]');
  console.log('Close Chrome first. Explicit profile mode reads Bookmarks/Local State and temporary copies of History/Cookies; outputs counts only. No cookie values, URLs or titles are printed. No data is imported into Aether.');
  process.exit(0);
}
let fixtureRoot: string | undefined;
let fixtureKey: Buffer | undefined;
let report: ProfileReport | undefined;
try {
  let profile: string;
  if (args.length === 0 || (args.length === 1 && args[0] === '--fixture')) {
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'aether-s6-fixture-'));
    const fixture = createFixture(fixtureRoot);
    profile = fixture.profile;
    fixtureKey = fixture.fixtureKey;
  } else if (args.length === 2 && mode === '--profile' && profilePath && path.isAbsolute(profilePath)) {
    if (process.platform !== 'win32') throw new Error('Real-profile probe currently supports Windows only');
    profile = profilePath;
  } else throw new Error('Use --fixture or --profile with an absolute path');
  report = inspectProfile(profile, { fixtureKey });
  if (fixtureRoot) {
    assert.equal(report.bookmarks, 2);
    assert.equal(report.historyUrls, 1);
    assert.equal(report.cookies.total, process.platform === 'win32' ? 7 : 6);
    assert.equal(report.cookies.v10Decrypted, 1);
    assert.equal(report.cookies.v10Failed, 2);
    assert.equal(report.cookies.v20Skipped, 1);
    assert.equal(report.cookies.plaintext, 1);
    assert.equal(report.cookies.unsupported, 1);
    assert.equal(report.cookies.legacyDpapiDecrypted, process.platform === 'win32' ? 1 : 0);
    assert.equal(report.keyProbe, process.platform === 'win32' ? 'dpapi-unwrapped' : 'fixture-key');
    assert.equal(report.temporaryCopiesRemoved, true);
  }
} catch {
  // Native DB/OS errors can contain personal paths or data; never echo them.
  console.error('S6 probe failed. Check arguments, close Chrome, and verify readable Bookmarks, History, Cookies and Local State. Temporary copies are cleaned in finally. No raw error data is printed.');
  process.exitCode = 1;
} finally {
  fixtureKey?.fill(0);
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
}
if (report && !process.exitCode) console.log(JSON.stringify({
  spike: 'S6', mode: fixtureRoot ? 'synthetic-fixture' : 'explicit-windows-profile',
  platform: process.platform, node: process.versions.node, ...report,
  fixtureRemoved: fixtureRoot ? !existsSync(fixtureRoot) : null,
  appBoundDecryption: 'not-attempted-v20-skipped',
  googleSignIn: 'not-run', bankSignIn: 'not-run',
  macOsAndLinuxKeyStores: 'not-run',
  conclusion: 'Partial evidence only; does not authorize the production importer or claim live sign-in compatibility.',
}, null, 2));
