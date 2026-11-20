import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { app, Menu, protocol, session as electronSession, type Session } from 'electron';
import { CDPClient, ElectronDebuggerTransport } from '@aether/cdp';
import { CodeModeHost } from '@aether/codemode';
import { fileConfig, openDatabase, SpaceStore, MemoryStore, createLogger } from '@aether/memory';
import { AgentHost } from './agent-host.js';
import { pageSlots, type MemoryReading } from './concurrency.js';
import { hardenApp, hardenSession } from './hardening.js';
import { MemoryWatchdog, systemMemory } from './memory-watchdog.js';
import { BrowserPrompts } from './browser-prompts.js';
import { NavigationStore } from './navigation-store.js';
import { installInternalPages } from './internal-pages.js';
import { aetherPaths } from './paths.js';
import { installRequestFilter } from './request-filter.js';
import { ShellBridge } from './shell-bridge.js';
import { ShellSettingsStore } from './shell-settings.js';
import { ShellWindow } from './shell-window.js';
import { PERSIST_PARTITION, SpaceManager } from './space-manager.js';
import { DesktopTools } from './service/desktop-tools.js';
import { DesktopSpaceEngine } from './service/desktop-engine.js';
import { ServiceServer } from './service/server.js';
import { removeServiceFile, serviceEndpoint, writeServiceFile } from './service/service-file.js';
import { startTestControl } from './test-control.js';

/*
 * Aether Desktop, main process (plan 3.1, Step 2): one instance per person,
 * the main window, the agent host window, the Space manager, the memory
 * watchdog, request filtering and security settings. Phase 3 adds the engine
 * (Code Mode over Spaces) and, in 3.4, the service hosts connect through.
 */

protocol.registerSchemesAsPrivileged([{ scheme: 'aether', privileges: { standard: true, secure: true } }]);

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
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const logger = createLogger(undefined, undefined, 'aether-desktop');
  const db = openDatabase(paths.database);
  const store = new SpaceStore(db);
  const navigationStore = new NavigationStore(db);
  const config = fileConfig(paths.config, (message) => logger.warn(message));
  const transport = new ElectronDebuggerTransport();
  const client = CDPClient.over(transport);
  let memoryOverride: MemoryReading | undefined;
  const memory = () => (memoryOverride ? { read: () => memoryOverride as MemoryReading } : systemMemory);
  const slots = () => pageSlots({ ...memory().read(), reserveRatio: config.read().minFreeMemoryRatio, cores: availableParallelism() });

  const shellWindow = new ShellWindow({ offscreen: Boolean(testControlFile) });
  const host = new AgentHost(shellWindow.viewportSize());
  shellWindow.onResize((size) => host.resize(size.width, size.height));
  const manager = new SpaceManager({ store, host, display: shellWindow, transport, slots });
  const prompts = new BrowserPrompts(manager);

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
    installInternalPages(target, {
          spaces: () => [...manager.list().map((entry) => entry.record), ...manager.archivedSpaces()].sort((a, b) => b.createdAt - a.createdAt),
          history: () => navigationStore.list(manager.visibleSpaceId, 'history'),
        });
    hardenSession(target, {
          kindOf: (id) => ownerOf(id)?.kind,
          requestPermission: (contents, permission, url, callback) => prompts.requestPermission(contents, permission, url, callback),
          checkPermission: (contents, permission, origin) => prompts.checkPermission(contents, permission, origin),
        });
    installRequestFilter(target, { ownerOf: (id) => {
      const owner = ownerOf(id);
      return owner?.kind === 'agent' ? { kind: 'agent', shown: owner.shown } : undefined;
    } }, filtered);
  };
  app.on('session-created', protect);
  protect(electronSession.fromPartition(PERSIST_PARTITION));
  protect(electronSession.defaultSession);

  // Code Mode over the desktop's Spaces (plan 3.2, task 3.2). Milestones from
  // the host's thought, logStep and the engine go to the Activity panel.
  const engine = new DesktopSpaceEngine({
    manager,
    client,
    database: db,
    config,
    onMilestone: (spaceId, text, source) => manager.addMilestone(spaceId, text, source),
  });
  // Tests shorten the hold time so a held run is observable in seconds.
  const holdReturnMs = Number(process.env.AETHER_HOLD_RETURN_MS) || undefined;
  const codeMode = new CodeModeHost(engine, holdReturnMs ? { holdReturnMs } : {});

  const memoryStore = new MemoryStore(db);
  const settingsStore = new ShellSettingsStore(paths.config, config, memoryStore);
  const bridge = new ShellBridge(manager, shellWindow, engine, codeMode, { navigationStore, memoryStore, prompts, settingsStore });
  manager.restore();
  bridge.push();

  const watchdog = new MemoryWatchdog(manager, memory, () => config.read().minFreeMemoryRatio);
  watchdog.start();

  // The one app service (plan 3.2, task 3.4): hosts reach the app through it.
  const serviceFile = path.join(paths.home, 'daemon.json');
  const service = new ServiceServer({
    config: writeServiceFile(serviceFile, serviceEndpoint(paths.home), app.getVersion()),
    tools: new DesktopTools({ manager, engine, codeMode }),
    appVersion: app.getVersion(),
  });
  void service.listen().catch((error: unknown) => logger.error(`the app service could not listen: ${error instanceof Error ? error.message : String(error)}`));

  if (testControlFile) {
    startTestControl(testControlFile, {
      manager,
      shellWindow,
      store,
      navigationStore,
      bridge,
      watchdog,
      client,
      slots,
      engine,
      codeMode,
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
    void service.close();
    removeServiceFile(serviceFile);
    codeMode.stopAll();
    watchdog.stop();
    manager.closeAll();
    transport.close();
    host.destroy();
    db.close();
  });
}
