import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface LaunchOptions {
  executablePath?: string;
  headless?: boolean;
  userDataDir?: string;
  additionalArgs?: string[];
  timeoutMs?: number;
  ephemeral?: boolean;
}

export interface LaunchedBrowser {
  process: ChildProcess;
  wsEndpoint: string;
  userDataDir: string;
  kill: () => Promise<void>;
}

export class ChromeLauncher {
  public static findChromeExecutable(): string {
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
      return process.env.CHROME_BIN;
    }
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }

    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ];
      for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
      }
    } else if (process.platform === 'darwin') {
      const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } else {
      const candidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }

    throw new Error('Chrome/Chromium executable not found. Set CHROME_PATH or install Google Chrome.');
  }

  public static async launch(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
    const executable = options.executablePath || ChromeLauncher.findChromeExecutable();
    const timeout = options.timeoutMs || 10000;
    const isCustomDir = Boolean(options.userDataDir);
    const userDataDir = options.userDataDir || path.join(os.tmpdir(), `aether-cdp-${randomUUID()}`);

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-features=Translate,BackForwardCache,AcceptCHFrame',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--metrics-recording-only',
    ];

    if (options.headless !== false) {
      args.push('--headless=new');
    }

    if (options.ephemeral) {
      args.push('--incognito');
    }

    if (options.additionalArgs) {
      args.push(...options.additionalArgs);
    }

    args.push('about:blank');

    const browserProcess = spawn(executable, args, {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    const activePortFile = path.join(userDataDir, 'DevToolsActivePort');

    const wsEndpoint = await ChromeLauncher.waitForPortFile(activePortFile, timeout, browserProcess);

    let killed = false;
    const kill = async () => {
      if (killed) return;
      killed = true;

      try {
        if (browserProcess.pid) {
          if (process.platform === 'win32') {
            try {
              const { execSync } = await import('node:child_process');
              execSync(`taskkill /pid ${browserProcess.pid} /T /F`, { stdio: 'ignore' });
            } catch {
              browserProcess.kill('SIGKILL');
            }
          } else {
            browserProcess.kill('SIGKILL');
          }
        }
      } catch {
        // Ignore kill errors
      }

      if (!isCustomDir) {
        // Clean temporary user data dir
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
          // Non-critical if locked by Windows for a moment
        }
      }
    };

    const cleanupHandler = () => {
      void kill();
    };
    process.once('exit', cleanupHandler);
    process.once('SIGINT', cleanupHandler);
    process.once('SIGTERM', cleanupHandler);

    return {
      process: browserProcess,
      wsEndpoint,
      userDataDir,
      kill,
    };
  }

  private static async waitForPortFile(
    portFilePath: string,
    timeoutMs: number,
    child: ChildProcess,
  ): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(`Browser process exited early with code ${child.exitCode}`);
      }

      if (fs.existsSync(portFilePath)) {
        try {
          const content = fs.readFileSync(portFilePath, 'utf8');
          const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length >= 2) {
            const port = Number.parseInt(lines[0] || '0', 10);
            const pathPart = lines[1] || '';
            if (port > 0 && pathPart) {
              return `ws://127.0.0.1:${port}${pathPart.startsWith('/') ? pathPart : `/${pathPart}`}`;
            }
          }
        } catch {
          // File might be mid-write, retry
        }
      }

      await new Promise((res) => setTimeout(res, 100));
    }

    throw new Error(`Timed out waiting for DevToolsActivePort file after ${timeoutMs}ms at ${portFilePath}`);
  }
}
