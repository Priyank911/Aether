import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeConfigSchema } from '@aether/shared';
import { ExtensionBridge } from './mcp/bridge.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HOST_NAME = 'com.aether.browser';
const CONFIG_PATH = path.join(homedir(), '.aether', 'bridge.json');
const CONNECT_WAIT_MS = 20000;

type Outcome = 'ok' | 'fail' | 'warn';

interface Check {
  outcome: Outcome;
  what: string;
  fix?: string;
}

const results: Check[] = [];

function report(outcome: Outcome, what: string, fix?: string): void {
  results.push({ outcome, what, fix });
  const mark = outcome === 'ok' ? 'ok  ' : outcome === 'warn' ? 'warn' : 'FAIL';
  console.log(`${mark}  ${what}`);
  if (fix && outcome !== 'ok') console.log(`      fix: ${fix}`);
}

function registeredManifestPath(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const output = execFileSync('reg', ['query', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, '/ve'], { encoding: 'utf8' });
    return /REG_SZ\s+(.+)$/m.exec(output)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function portIsLive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function checkBuilds(): void {
  const major = Number(process.versions.node.split('.')[0]);
  report(major >= 22 ? 'ok' : 'fail', `Node ${process.versions.node}`, 'install Node 22 or later');
  const extensionManifest = path.join(REPO, 'apps/extension/.output/chrome-mv3/manifest.json');
  report(existsSync(extensionManifest) ? 'ok' : 'fail', 'extension is built (apps/extension/.output/chrome-mv3)', 'run pnpm setup:build, then reload the extension on chrome://extensions');
  report(existsSync(path.join(REPO, 'apps/native-host/dist/index.js')) ? 'ok' : 'fail', 'native host is built (apps/native-host/dist)', 'run pnpm setup:build');
}

/** The native host registration, and the extension ids it allows. */
function checkNativeHost(): string[] {
  const manifestPath = registeredManifestPath();
  if (!manifestPath) {
    report('fail', `native host ${HOST_NAME} is registered for Chrome`, 'run: powershell -ExecutionPolicy Bypass -File apps/native-host/install.ps1 -ExtensionId <id from chrome://extensions>');
    return [];
  }
  report('ok', `native host registered: ${manifestPath}`);
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { path?: string; allowed_origins?: string[] };
    report(manifest.path && existsSync(manifest.path) ? 'ok' : 'fail', `native host launcher exists: ${manifest.path ?? '(missing path)'}`, 'run install.ps1 again from this checkout');
    const ids = (manifest.allowed_origins ?? []).map((origin) => /chrome-extension:\/\/([a-p]{32})/.exec(origin)?.[1]).filter((id): id is string => Boolean(id));
    report(ids.length > 0 ? 'ok' : 'fail', `native host allows extension ${ids.join(', ') || '(none)'}`, 'run install.ps1 with the extension id');
    return ids;
  } catch (error) {
    report('fail', `native host manifest is readable JSON (${error instanceof Error ? error.message : String(error)})`, 'run install.ps1 again');
    return [];
  }
}

/** The process listening on a loopback port, from netstat. */
function pidListeningOn(port: number): number | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const owner = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`],
      { encoding: 'utf8', timeout: 8000 },
    ).trim();
    if (/^\d+$/.test(owner)) return Number(owner);
  } catch {
    // Fall back to netstat below.
  }
  try {
    const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const line = output.split(/\r?\n/).find((row) => new RegExp(`127\\.0\\.0\\.1:${port}\\s+\\S+\\s+LISTENING`).test(row));
    const pid = line?.trim().split(/\s+/).pop();
    return pid ? Number(pid) : undefined;
  } catch {
    return undefined;
  }
}

interface EngineStatus {
  pid: number;
  startedAt: number;
  extensionConnected: boolean;
  extensionOrigin: string | null;
}

async function engineStatus(port: number): Promise<EngineStatus | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? ((await response.json()) as EngineStatus) : undefined;
  } catch {
    return undefined;
  }
}

/** Another engine already owning bridge.json would receive the extension instead of this check. */
async function otherEngineRunning(): Promise<boolean> {
  if (!existsSync(CONFIG_PATH)) return false;
  try {
    const config = BridgeConfigSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
    if (await portIsLive(config.port)) {
      const status = await engineStatus(config.port);
      const pid = status?.pid ?? pidListeningOn(config.port);
      if (!status) {
        report(
          'warn',
          `an Aether engine from an older build owns the bridge (port ${config.port}, process ${pid ?? 'unknown'}); it does not exit when its MCP host stops`,
          `end it with: Stop-Process -Id ${pid ?? '<pid>'}, then run pnpm doctor again`,
        );
        return true;
      }
      const started = new Date(status.startedAt).toLocaleTimeString();
      report(
        status.extensionConnected ? 'ok' : 'warn',
        `Aether engine process ${status.pid} (started ${started}) owns the bridge; Chrome extension ${status.extensionConnected ? 'connected' : 'not connected'}`,
        'make sure Chrome is open with the Aether extension enabled; reload the extension on chrome://extensions',
      );
      return true;
    }
    report('ok', `stale ${CONFIG_PATH} from a stopped engine (replaced on the next start)`);
  } catch {
    report('warn', `${CONFIG_PATH} is not a valid bridge file; it is replaced on the next start`);
  }
  return false;
}

async function checkLiveConnection(allowedIds: string[]): Promise<void> {
  const bridge = new ExtensionBridge(CONFIG_PATH);
  await bridge.start();
  console.log(`....  waiting up to ${CONNECT_WAIT_MS / 1000}s for the Chrome extension to connect (Chrome must be open with the Aether extension enabled)`);
  const connected = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), CONNECT_WAIT_MS);
    bridge.once('connected', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (connected) {
    const id = /chrome-extension:\/\/([a-p]{32})/.exec(bridge.extensionOriginSeen ?? '')?.[1] ?? '?';
    report('ok', `the Chrome extension ${id} connected to the engine`);
    if (allowedIds.length > 0 && !allowedIds.includes(id)) report('warn', `connected extension ${id} is not in the native host's allowed list`);
  } else {
    report(
      'fail',
      'the Chrome extension connected to the engine',
      allowedIds.length > 0
        ? `open chrome://extensions and check that the Aether extension is enabled and its ID is ${allowedIds.join(' or ')}; if the ID differs, run install.ps1 with the shown ID; then press the reload icon on the extension card`
        : 'register the native host first',
    );
  }
  await bridge.close();
}

/** Check every link between the MCP host, the engine, the native host and the extension. */
export async function runDoctor(): Promise<number> {
  console.log('Aether doctor\n');
  checkBuilds();
  const allowedIds = checkNativeHost();
  if (!(await otherEngineRunning())) await checkLiveConnection(allowedIds);
  const failed = results.filter((result) => result.outcome === 'fail').length;
  console.log(
    failed === 0
      ? '\nAll checks passed. In your MCP host use: node "' + path.join(REPO, 'apps/cli/dist/index.js') + '" mcp'
      : `\n${failed} check${failed === 1 ? '' : 's'} failed.`,
  );
  return failed === 0 ? 0 : 1;
}
