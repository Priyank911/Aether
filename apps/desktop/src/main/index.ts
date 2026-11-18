import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { app, session as electronSession, type Session } from 'electron';
import { CDPClient, ElectronDebuggerTransport } from '@aether/cdp';
import { fileConfig, openDatabase, SpaceStore } from '@aether/memory';
import { AgentHost } from './agent-host.js';
import { pageSlots, type MemoryReading } from './concurrency.js';
import { hardenApp, hardenSession } from './hardening.js';
import { MemoryWatchdog, systemMemory } from './memory-watchdog.js';
import { aetherPaths } from './paths.js';
import { installRequestFilter } from './request-filter.js';
import { ShellBridge } from './shell-bridge.js';
import { ShellWindow } from './shell-window.js';
import { PERSIST_PARTITION, SpaceManager } from './space-manager.js';
import { startTestControl } from './test-control.js';

/*
 * Aether Desktop, main process (plan 3.1, Step 2): one instance per person,
 * the main window, the agent host window, the Space manager, the memory
 * watchdog, request filtering and security settings. Code Mode and the daemon
 * for hosts attach to the same Space manager in Step 3.
 */

const paths = aetherPaths();
mkdirSync(paths.home, { recursive: true });
// Electron's profile (cookies, cache, local storage) lives under ~/.aether, next to Aether's own files.
app.setPath('userData', paths.profile);
// The agent host window sits beyond every display (spike S7). Chromium's native occlusion tracking would
// in time call it occluded and stop rendering its pages, which stops trusted input and lazy loading.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const testControlFile = process.env.AETHER_TEST_CONTROL;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  hardenApp();
  void app.whenReady().then(start);
}

function start(): void {
  const db = openDatabase(paths.database);
  const store = new SpaceStore(db);
  const config = fileConfig(paths.config, (message) => console.error(message));
  const transport = new ElectronDebuggerTransport();
  const client = CDPClient.over(transport);
  let memoryOverride: MemoryReading | undefined;
  const memory = () => (memoryOverride ? { read: () => memoryOverride as MemoryReading } : systemMemory);
  const slots = () => pageSlots({ ...memory().read(), reserveRatio: config.read().minFreeMemoryRatio, cores: availableParallelism() });

  const shellWindow = new ShellWindow({ offscreen: Boolean(testControlFile) });
  const host = new AgentHost(shellWindow.viewportSize());
  shellWindow.onResize((size) => host.resize(size.width, size.height));
  const manager = new SpaceManager({ store, host, display: shellWindow, transport, slots });

  /** Which kind of page a webContents is, for permissions and request filtering. */
  const ownerOf = (id: number) => {
    if (id === shellWindow.shell.webContents.id) return { kind: 'shell' as const, shown: true };
    for (const entry of manager.list()) {
      for (const tab of entry.tabs) {
        if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === id) {
          return { kind: tab.kind, shown: manager.shownTab() === tab };
        }
      }
    }
    return undefined;
  };
  const filtered = { blocked: 0 };
  const protect = (target: Session): void => {
    hardenSession(target, { kindOf: (id) => ownerOf(id)?.kind });
    installRequestFilter(target, { ownerOf: (id) => {
      const owner = ownerOf(id);
      return owner?.kind === 'agent' ? { kind: 'agent', shown: owner.shown } : undefined;
    } }, filtered);
  };
  app.on('session-created', protect);
  protect(electronSession.fromPartition(PERSIST_PARTITION));
  protect(electronSession.defaultSession);

  const bridge = new ShellBridge(manager, shellWindow.shell.webContents);
  manager.restore();
  bridge.push();

  const watchdog = new MemoryWatchdog(manager, memory, () => config.read().minFreeMemoryRatio);
  watchdog.start();

  if (testControlFile) {
    startTestControl(testControlFile, {
      manager,
      store,
      watchdog,
      client,
      slots,
      setMemory: (reading) => {
        memoryOverride = reading;
      },
      filtered,
    });
  }

  app.on('second-instance', () => {
    if (shellWindow.window.isMinimized()) shellWindow.window.restore();
    shellWindow.window.focus();
  });
  shellWindow.window.on('closed', () => app.quit());
  app.on('before-quit', () => {
    watchdog.stop();
    manager.closeAll();
    transport.close();
    host.destroy();
    db.close();
  });
}
