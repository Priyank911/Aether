/*
 * `pnpm aether:install` / `pnpm aether:uninstall` (plan 3.2, task 3.8,
 * the from-source path that works before packaging decision D1).
 *
 * install:   write an `aether` shim on PATH, add its folder to the user
 *            PATH (HKCU on Windows, the profile file elsewhere), then run
 *            `aether install-skill` so every installed host gets the skill.
 * uninstall: run `aether uninstall-skill`, remove the PATH entry and the shim.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = path.join(root, 'apps', 'cli', 'dist', 'index.js');
const isWindows = process.platform === 'win32';

function binDir() {
  if (isWindows) return path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'Aether', 'bin');
  return path.join(homedir(), '.local', 'bin');
}

function shimPath() {
  return path.join(binDir(), isWindows ? 'aether.cmd' : 'aether');
}

function writeShim() {
  const file = shimPath();
  mkdirSync(path.dirname(file), { recursive: true });
  if (isWindows) {
    writeFileSync(file, `@echo off\r\n"${process.execPath}" "${cliJs}" %*\r\n`);
  } else {
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${cliJs}" "$@"\n`);
    chmodSync(file, 0o755);
  }
  console.log(`shim: ${file}`);
}

function removeShim() {
  const file = shimPath();
  if (existsSync(file)) {
    rmSync(file, { force: true });
    console.log(`removed shim: ${file}`);
  }
  // Drop the bin folder when nothing else lives there.
  const dir = path.dirname(file);
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch {
    // not empty or not removable; fine
  }
}

/* ---- PATH (Windows: HKCU\Environment, REG_EXPAND_SZ) ---- */

function regQuery() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' });
    return /Path\s+REG_EXPAND_SZ\s+(.+)/.exec(out)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

function regAdd(value) {
  execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'], { stdio: 'ignore' });
}

function pathEntries() {
  if (isWindows) return regQuery().split(';').filter(Boolean);
  const files = [path.join(homedir(), '.profile'), path.join(homedir(), '.bashrc'), path.join(homedir(), '.zshrc')];
  return files.flatMap((file) => {
    try {
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.includes('PATH') && line.includes('.local/bin'))
        .map(() => path.join(homedir(), '.local', 'bin'));
    } catch {
      return [];
    }
  });
}

function ensurePath() {
  const dir = binDir();
  if (isWindows) {
    const entries = regQuery().split(';').map((entry) => entry.trim()).filter(Boolean);
    if (entries.some((entry) => entry.toLowerCase() === dir.toLowerCase())) {
      console.log('PATH already contains the shim folder');
      return;
    }
    regAdd([...entries, dir].join(';'));
    console.log(`added to user PATH: ${dir} (new terminals see it)`);
    return;
  }
  const profile = path.join(homedir(), '.profile');
  const marker = '# Aether';
  const line = `export PATH="$HOME/.local/bin:$PATH" ${marker}`;
  let text = '';
  try {
    text = readFileSync(profile, 'utf8');
  } catch {
    // create below
  }
  if (text.includes(marker) || pathEntries().includes(dir)) {
    console.log('PATH already contains the shim folder');
    return;
  }
  writeFileSync(profile, `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}${line}\n`);
  console.log(`added to ${profile}: ~/.local/bin is on PATH for new shells`);
}

function removePath() {
  const dir = binDir();
  if (isWindows) {
    const entries = regQuery().split(';').map((entry) => entry.trim()).filter((entry) => entry && entry.toLowerCase() !== dir.toLowerCase());
    if (entries.length > 0) regAdd(entries.join(';'));
    console.log(`removed ${dir} from user PATH`);
    return;
  }
  const profile = path.join(homedir(), '.profile');
  try {
    const kept = readFileSync(profile, 'utf8')
      .split('\n')
      .filter((line) => !line.includes('# Aether'))
      .join('\n');
    writeFileSync(profile, kept);
    console.log(`removed the Aether line from ${profile}`);
  } catch {
    // nothing to do
  }
}

/* ---- the commands ---- */

function runCli(args) {
  if (!existsSync(cliJs)) {
    console.error('the CLI is not built; run pnpm build first');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [cliJs, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const mode = process.argv[2] ?? 'install';
if (mode === 'install') {
  if (!existsSync(cliJs)) {
    console.error('apps/cli is not built; run `pnpm aether:install` (it builds first) or `pnpm build`');
    process.exit(1);
  }
  writeShim();
  ensurePath();
  runCli(['install-skill']);
  console.log('\nDone. Open a new terminal and run `aether doctor`.');
} else if (mode === 'uninstall') {
  runCli(['uninstall-skill']);
  removePath();
  removeShim();
  console.log('\nDone.');
} else {
  console.error('usage: node scripts/aether-install.mjs [install|uninstall]');
  process.exit(4);
}
