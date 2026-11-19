/*
 * `pnpm desktop` entry point: run Electron with a clean environment.
 * When Aether is launched from inside another Electron app (an IDE, Devin),
 * ELECTRON_RUN_AS_NODE=1 is inherited and Electron would run as plain Node.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps', 'desktop');
const require = createRequire(path.join(appDir, 'package.json'));
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [appDir], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
