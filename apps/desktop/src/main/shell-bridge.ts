import { app, dialog, ipcMain, Menu, type WebContents } from 'electron';
import type { MemoryStore } from '@aether/memory';
import type { MemoryListing } from '@aether/shared';
import { shellMemory } from './shell-memory.js';
import { NavigationEntrySchema, ShellCommandSchema, type OmniboxState, type ShellCommand, type ShellSnapshot, type ShellTab } from '@aether/shared';
import type { ShellSettingsStore } from './shell-settings.js';
import type { ImportController } from './import/import-controller.js';
import type { BrowserPrompts } from './browser-prompts.js';
import { installBrowserBasics } from './browser-basics.js';
import { browserMenuTemplate } from './browser-menu.js';
import { installBrowserShortcuts } from './shortcuts-electron.js';
import type { NavigationStore } from './navigation-store.js';
import { omniboxSuggestions } from './omnibox-suggestions.js';
import { resolveInput } from './omnibox.js';
import { NEW_TAB_URL } from './internal-pages.js';
import type { ShellWindow } from './shell-window.js';
import type { SpaceManager } from './space-manager.js';
import type { Tab } from './tab.js';
import type { CodeModeHost } from '@aether/codemode';
import type { DesktopSpaceEngine } from './service/desktop-engine.js';

/*
 * Between the shell renderer and the main process (plan 3.1, section 10).
 * The renderer only draws the snapshot it is sent and sends commands back;
 * every command is validated here, and only the shell's own page may send.
 */

const PUSH_DELAY_MS = 40;

function shellTab(tab: Tab): ShellTab {
  const contents = tab.view?.webContents;
  const live = contents && !contents.isDestroyed() ? contents : undefined;
  return {
    ...tab.record,
    loading: tab.loading,
    canGoBack: live?.navigationHistory.canGoBack() ?? false,
    canGoForward: live?.navigationHistory.canGoForward() ?? false,
    audible: live?.isCurrentlyAudible() ?? false,
    muted: tab.muted,
    zoomPercent: Math.min(500, Math.max(25, Math.round((live?.getZoomFactor() ?? 1) * 100))),
  };
}

export function buildSnapshot(manager: SpaceManager, panelOpen = false, spaceMenuOpen = false): ShellSnapshot {
  return {
    type: 'shell.snapshot',
    activeSpaceId: manager.visibleSpaceId,
    panelOpen,
    spaceMenuOpen,
    archivedSpaces: manager.archivedSpaces(),
    platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : 'win32',
    spaces: manager.list().map((entry) => ({
      space: entry.record,
      frame: manager.frameFor(entry.record.id),
      tabs: entry.tabs.map(shellTab),
      ...(entry.activeTabId ? { activeTabId: entry.activeTabId } : {}),
      milestones: manager.milestonesFor(entry.record.id),
    })),
  };
}

export type CommandResult = { ok: true } | { ok: false; error: string };

export interface ShellBridgeOptions {
  navigationStore?: NavigationStore;
  memoryStore?: MemoryStore;
  prompts?: BrowserPrompts;
  settingsStore?: ShellSettingsStore;
  importer?: ImportController;
}

export class ShellBridge {
  private readonly manager: SpaceManager;
  private readonly shell: WebContents;
  private readonly window: ShellWindow;
  private readonly engine?: DesktopSpaceEngine;
  private readonly codeMode?: CodeModeHost;
  private timer?: NodeJS.Timeout;
  private doneTimer?: NodeJS.Timeout;
  private panelOpen = false;
  private focusRequest = 0;
  private lastDecisionKey = '';
  private memoryListing?: MemoryListing;
  private readonly memoryStore?: MemoryStore;
  private readonly prompts?: BrowserPrompts;
  private readonly settingsStore?: ShellSettingsStore;
  private readonly importer?: ImportController;
  private lastPromptId = 0;
  private spaceMenuOpen = false;
  private overlayRequested = false;
  private find?: NonNullable<ShellSnapshot['find']>;
  private findTabId?: string;
  private findRequest = 0;
  private actionTarget?: ShellSnapshot['actionTarget'];
  private toast?: ShellSnapshot['toast'];
  private toastTimer?: NodeJS.Timeout;
  private toastId = 0;
  private closed = false;
  private omnibox?: OmniboxState;
  private omniboxContext?: { spaceId: string; tabId?: string };
  private readonly navigationStore?: NavigationStore;

  public constructor(manager: SpaceManager, window: ShellWindow, engine?: DesktopSpaceEngine, codeMode?: CodeModeHost, options: ShellBridgeOptions = {}) {
    const shell = window.shell.webContents;
    this.manager = manager;
    this.shell = shell;
    this.window = window;
    this.engine = engine;
    this.codeMode = codeMode;
    this.navigationStore = options.navigationStore;
    this.memoryStore = options.memoryStore;
    this.prompts = options.prompts;
    this.settingsStore = options.settingsStore;
    this.importer = options.importer;
    this.importer?.on('changed', () => this.schedule());
    this.prompts?.on('changed', () => { this.syncOverlay(); this.schedule(); });
    this.prompts?.on('notice', (text: string) => this.showToast(text));
    ipcMain.handle('aether:command', async (event, raw: unknown): Promise<CommandResult> => {
      const senders = [this.shell, this.window.overlay.webContents];
      if (!senders.includes(event.sender)) return { ok: false, error: 'commands are accepted from the Aether shell only' };
      const parsed = ShellCommandSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: `bad command: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
      try {
        const result = await this.run(parsed.data);
        if (!result.ok) this.showToast(result.error);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.showToast(message);
        return { ok: false, error: message };
      }
    });
    manager.on('changed', () => {
      if (this.omniboxContext && (this.omniboxContext.spaceId !== manager.visibleSpaceId || this.omniboxContext.tabId !== this.shown()?.id)) {
        this.closeOmnibox();
      }
      if (this.find && this.findTabId !== this.shown()?.id) this.closeFind();
      this.syncOverlay();
      this.schedule();
    });
    manager.on('action-target', (target: ShellSnapshot['actionTarget']) => { this.actionTarget = target; this.schedule(); });
    const observeFind = (contents: WebContents) => contents.on('found-in-page', (_event, result) => {
      if (!this.find || this.findTabId !== this.shown()?.id || contents !== this.shown()?.view?.webContents || result.requestId !== this.findRequest) return;
      this.find = { ...this.find, active: result.activeMatchOrdinal, total: result.matches };
      this.schedule();
    });
    app.on('web-contents-created', (_event, contents) => observeFind(contents));
    for (const entry of manager.list()) for (const tab of entry.tabs) if (tab.view) observeFind(tab.view.webContents);
    installBrowserBasics(manager, window, (command) => { void this.run(command).catch((error: unknown) => this.showToast(String(error))); });
    installBrowserShortcuts(manager, window, (command) => this.run(command), () => {
      this.setSpaceMenuOpen(false);
      this.closeOmnibox();
      this.focusRequest++;
      this.shell.focus();
      this.push();
    });
    window.window.on('blur', () => this.setSpaceMenuOpen(false));
    window.window.on('resize', () => { this.setSpaceMenuOpen(false); this.schedule(); });
    if (this.navigationStore) {
      app.on('web-contents-created', (_event, contents) => this.observeNavigation(contents));
      for (const entry of manager.list()) {
        for (const tab of entry.tabs) if (tab.view) this.observeNavigation(tab.view.webContents);
      }
    }
  }

  public push(): void {
    if (this.closed || this.shell.isDestroyed()) return;
    const currentFrame = this.manager.frameFor(this.manager.visibleSpaceId);
    const decisionKey = currentFrame?.state === 'waiting_human' && currentFrame.pending ? `${currentFrame.spaceId}:${currentFrame.pending.id}` : '';
    if (decisionKey && decisionKey !== this.lastDecisionKey) {
      this.panelOpen = true;
      this.shell.focus();
    }
    this.lastDecisionKey = decisionKey;
    this.window.setPanelOpen(this.panelOpen);
    this.syncOverlay();
    const snapshot = buildSnapshot(this.manager, this.panelOpen, this.spaceMenuOpen);
    const prompt = this.prompts?.current();
    if (prompt) {
      snapshot.browserPrompt = prompt;
      if (this.lastPromptId !== prompt.id) { this.lastPromptId = prompt.id; this.window.overlay.webContents.focus(); }
    }
    if (this.find) snapshot.find = this.find;
    if (this.toast) snapshot.toast = this.toast;
    if (this.actionTarget && this.actionTarget.tabId === this.shown()?.id && Date.now() - this.actionTarget.timestamp < 1500) snapshot.actionTarget = this.actionTarget;
    snapshot.bookmarksVisible = this.navigationStore?.bookmarksVisible ?? false;
    snapshot.bookmarks = this.navigationStore?.list(this.manager.visibleSpaceId, 'bookmark') ?? [];
    this.window.setBookmarksBar(snapshot.bookmarksVisible);
    snapshot.panelWidth = this.window.panelWidth();
    if (this.memoryListing) snapshot.memory = this.memoryListing;
    if (this.omnibox) snapshot.omnibox = this.omnibox;
    snapshot.focusOmnibox = this.focusRequest;
    const shown = snapshot.spaces.find((entry) => entry.space.id === snapshot.activeSpaceId);
    const frame = shown?.frame;
    const remaining = frame?.state === 'done' ? frame.timestamp + 4000 - Date.now() : 0;
    snapshot.agentBarVisible = Boolean(shown?.space.kind === 'agent' && frame && frame.state !== 'idle' && (frame.state !== 'done' || remaining > 0));
    this.window.setAgentBar(snapshot.agentBarVisible);
    this.window.setAgentFrame(Boolean(shown?.space.kind === 'agent' && frame && ['acting', 'resuming', 'waiting_human'].includes(frame.state)));
    this.window.setPlaceholder(shown?.tabs.some((tab) => tab.id === shown.activeTabId && tab.state === 'crashed') ?? false);
    const settingsVisible = this.shown()?.kind === 'human' && this.shown()?.url === 'aether://settings/';
    this.window.setInternalPage(settingsVisible);
    if (settingsVisible && this.settingsStore) snapshot.settings = this.settingsStore.read();
    if (settingsVisible && this.importer) snapshot.browserImport = this.importer.state();
    snapshot.chromeHeight = this.window.chromeHeight();
    clearTimeout(this.doneTimer);
    if (remaining > 0) this.doneTimer = setTimeout(() => this.push(), remaining);
    this.shell.send('aether:snapshot', snapshot);
    const overlay = this.window.overlay.webContents;
    if (!overlay.isDestroyed()) overlay.send('aether:snapshot', snapshot);
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.push();
    }, PUSH_DELAY_MS);
  }

  /** Stop deferred shell work before the manager's database is closed. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.doneTimer);
    clearTimeout(this.toastTimer);
    this.timer = undefined;
    this.doneTimer = undefined;
    this.toastTimer = undefined;
  }

  /** Shared with the test-only control channel; building a template does not open or focus anything. */
  public menuTemplate(): ReturnType<typeof browserMenuTemplate> {
    const tab = this.shown();
    const contents = tab?.view?.webContents;
    const live = contents && !contents.isDestroyed() ? contents : undefined;
    return browserMenuTemplate({
      tabId: tab?.id,
      canGoBack: live?.navigationHistory.canGoBack() ?? false,
      canGoForward: live?.navigationHistory.canGoForward() ?? false,
      panelOpen: this.panelOpen,
      dispatch: (command) => { void this.run(command).catch((error: unknown) => console.error('Browser menu action failed', error)); },
      quit: () => app.quit(),
    });
  }

  private observeNavigation(contents: WebContents): void {
    const owner = () => this.manager.list().find((entry) => entry.record.partition === 'persist'
      && entry.tabs.some((tab) => tab.view?.webContents === contents));
    const record = (url: string): void => {
      const entry = owner();
      if (!entry || contents.isDestroyed()) return;
      const parsed = NavigationEntrySchema.safeParse({ spaceId: entry.record.id, url, title: contents.getTitle().slice(0, 512) });
      if (parsed.success) this.navigationStore?.record(parsed.data);
    };
    // These are committed main-frame navigations, not Tab.navigate's optimistic metadata.
    contents.on('did-navigate', (_event, url) => {
      record(url);
      const entry = owner();
      if (entry && /^https?:/.test(url)) contents.setZoomLevel(this.navigationStore?.zoom(entry.record.id, new URL(url).origin) ?? 0);
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) record(url); });
    contents.on('page-title-updated', (_event, title) => {
      const entry = owner();
      if (entry && !contents.isDestroyed()) this.navigationStore?.updateTitle(entry.record.id, contents.getURL(), title);
    });
  }

  private acting(): boolean {
    const entry = this.manager.list().find((candidate) => candidate.record.id === this.manager.visibleSpaceId);
    const state = this.manager.frameFor(this.manager.visibleSpaceId)?.state;
    return entry?.record.kind === 'agent' && (state === 'acting' || state === 'resuming');
  }

  private syncOverlay(): void {
    const full = this.acting() || this.overlayRequested || this.spaceMenuOpen || Boolean(this.omnibox);
    const prompt = this.prompts?.current();
        this.window.setOverlayOpen(full || Boolean(prompt) || Boolean(this.find) || Boolean(this.toast), full ? 'full' : prompt ? 'prompt' : this.find ? 'find' : 'toast');
    if (this.acting() && this.shown()?.view?.webContents.isFocused()) this.window.overlay.webContents.focus();
  }

  private closeFind(): void {
    this.manager.tab(this.findTabId ?? '')?.view?.webContents.stopFindInPage('clearSelection');
    this.find = undefined;
    this.findTabId = undefined;
    this.findRequest = 0;
    this.syncOverlay();
    this.schedule();
  }

  private showToast(text: string): void {
    this.toast = { id: ++this.toastId, text: text.slice(0, 500) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = undefined; this.syncOverlay(); this.schedule(); }, 5000);
    this.syncOverlay();
    this.schedule();
  }

  private closeOmnibox(): void {
    if (!this.omnibox) return;
    this.omnibox = undefined;
    this.omniboxContext = undefined;
    this.syncOverlay();
    this.schedule();
  }

  private setSpaceMenuOpen(open: boolean): void {
    if (this.spaceMenuOpen === open) return;
    this.spaceMenuOpen = open;
    if (open) this.closeOmnibox();
    this.syncOverlay();
    const contents = open ? this.window.overlay.webContents : this.shell;
    if (!contents.isDestroyed()) contents.focus();
    this.schedule();
  }

  private shown(): Tab | undefined {
    const entry = this.manager.list().find((candidate) => candidate.record.id === this.manager.visibleSpaceId);
    return entry?.tabs.find((tab) => tab.id === entry.activeTabId);
  }

  private async run(command: ShellCommand): Promise<CommandResult> {
    const manager = this.manager;
    const current = this.shown();
    const contents = current?.view?.webContents;
    switch (command.type) {
      case 'shell.ready':
        if (!this.focusRequest && current?.url === NEW_TAB_URL) { this.focusRequest++; this.shell.focus(); }
        this.push();
        return { ok: true };
      case 'tab.new':
        manager.openTab(command.spaceId ?? manager.visibleSpaceId, command.url ?? NEW_TAB_URL, { activate: true });
        return { ok: true };
      case 'tab.close':
        manager.closeTab(command.tabId);
        return { ok: true };
      case 'tab.reopen':
        return manager.reopenTab(manager.visibleSpaceId) ? { ok: true } : { ok: false, error: 'no closed tab to reopen in this Space' };
      case 'tab.activate':
        manager.activateTab(command.tabId);
        return { ok: true };
      case 'tab.mute': {
        const tab = manager.tab(command.tabId);
        if (!tab) throw new Error(`No tab with id ${command.tabId}`);
        tab.muted = command.muted;
        const live = tab.view?.webContents;
        if (live && !live.isDestroyed()) live.setAudioMuted(command.muted);
        this.schedule();
        return { ok: true };
      }
      case 'tab.sendToAgent': {
        const tab = manager.tab(command.tabId);
        if (!tab) return { ok: false, error: 'no such tab' };
        if (tab.kind !== 'human') return { ok: false, error: 'this tab is already in an Agent Space' };
        const target = command.spaceId ?? manager.agentSpace('From Personal').id;
        manager.sendToAgent(tab.id, target);
        return { ok: true };
      }
      case 'omnibox.update': {
        const items = omniboxSuggestions(command.query, this.navigationStore?.suggestions(manager.visibleSpaceId, command.query) ?? []);
        if (!items.length) { this.closeOmnibox(); return { ok: true }; }
        this.omniboxContext = { spaceId: manager.visibleSpaceId, tabId: current?.id };
        this.omnibox = {
          query: command.query,
          selected: Math.min(command.selected, items.length - 1),
          left: command.left,
          width: command.width,
          items,
        };
        this.syncOverlay();
        this.schedule();
        return { ok: true };
      }
      case 'omnibox.close':
        this.closeOmnibox();
        return { ok: true };
      case 'omnibox.move': {
        const state = this.omnibox;
        if (!state || state.query !== command.query || !state.items.length) return { ok: true };
        state.selected = state.selected < 0 ? (command.direction > 0 ? 0 : state.items.length - 1)
          : (state.selected + command.direction + state.items.length) % state.items.length;
        this.schedule();
        return { ok: true };
      }
      case 'omnibox.submit': {
        const state = this.omnibox;
        const item = state?.query === command.query ? state.items[state.selected] : undefined;
        return this.run({ type: 'nav.go', input: item?.input ?? command.query.trim() });
      }
      case 'omnibox.accept': {
        const item = this.omnibox?.items[command.index];
        if (!item || this.omnibox?.query !== command.query || item.input !== command.input) {
          return { ok: false, error: 'Suggestions changed. Choose an address again.' };
        }
        this.closeOmnibox();
        return this.run({ type: 'nav.go', input: item.input });
      }
      case 'menu.open':
        Menu.buildFromTemplate(this.menuTemplate()).popup({ window: this.window.window });
        return { ok: true };
      case 'nav.go': {
        this.closeOmnibox();
        const resolved = resolveInput(command.input);
        if (resolved.kind === 'refused') return { ok: false, error: resolved.reason };
        if (resolved.url === 'aether://settings/' && current?.kind !== 'human') return this.run({ type: 'settings.open' });
        if (!current) {
          manager.openTab(manager.visibleSpaceId, resolved.url, { activate: true });
          return { ok: true };
        }
        current.navigate(resolved.url);
        return { ok: true };
      }
      case 'nav.back':
        if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
        return { ok: true };
      case 'nav.forward':
        if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
        return { ok: true };
      case 'nav.reload':
        if (current?.loadFailure) current.navigate(current.url);
        else if (!contents && current) manager.activateTab(current.id);
        else if (command.hard) contents?.reloadIgnoringCache();
        else contents?.reload();
        return { ok: true };
      case 'nav.stop':
        contents?.stop();
        return { ok: true };
      case 'browser.reply':
        return this.prompts?.reply(command) ? { ok: true } : { ok: false, error: 'This request has closed. Try the action again on the current page.' };
      case 'page.print':
        if (contents) contents.print({}, (success, reason) => { if (!success && reason !== 'cancelled') this.showToast(`Could not print: ${reason}`); });
        return { ok: true };
      case 'settings.open': {
        const personal = manager.list().find((entry) => entry.record.id === 'personal');
        const existing = personal?.tabs.find((tab) => tab.url === 'aether://settings/');
        if (existing) manager.activateTab(existing.id); else manager.openTab('personal', 'aether://settings/', { activate: true });
        manager.showSpace('personal');
        return { ok: true };
      }
      case 'settings.save':
        if (current?.kind !== 'human' || current.url !== 'aether://settings/' || !this.settingsStore) return { ok: false, error: 'Open Settings in Personal to change these preferences.' };
        this.settingsStore.save(command.settings);
        if (this.memoryStore) this.memoryListing = shellMemory(this.memoryStore, { type: 'aether.memory', op: 'list' });
        this.schedule();
        return { ok: true };
      case 'import.discover':
      case 'import.choose':
      case 'import.start':
      case 'import.dismiss': {
        if (current?.kind !== 'human' || current.url !== 'aether://settings/' || !this.importer) return { ok: false, error: 'Open Settings in Personal to import browser data.' };
        if (command.type === 'import.discover') await this.importer.discover();
        else if (command.type === 'import.dismiss') this.importer.dismissOffer();
        else if (command.type === 'import.start') await this.importer.import(command.profileId, command.selection);
        else await this.importer.choose(async () => {
          const result = await dialog.showOpenDialog(this.window.window, { title: 'Choose a Chrome profile folder', properties: ['openDirectory'], buttonLabel: 'Use this profile' });
          return result.canceled ? undefined : result.filePaths[0];
        });
        this.push();
        return { ok: true };
      }
      case 'history.open':
        manager.openTab(manager.visibleSpaceId, 'aether://history/', { activate: true });
        return { ok: true };
      case 'bookmark.toggle': {
        if (!current || !this.navigationStore || !/^https?:/.test(current.url)) return { ok: false, error: 'Open a website to bookmark this page.' };
        const saved = this.navigationStore.toggleBookmark({ spaceId: current.spaceId, url: current.url, title: current.title.slice(0, 512) });
        this.showToast(saved ? 'Bookmark saved.' : 'Bookmark removed.');
        this.schedule();
        return { ok: true };
      }
      case 'bookmarks.toggle':
        if (this.navigationStore) this.navigationStore.bookmarksVisible = !this.navigationStore.bookmarksVisible;
        this.schedule();
        return { ok: true };
      case 'space.switch':
        manager.showSpace(command.spaceId);
        this.setSpaceMenuOpen(false);
        return { ok: true };
      case 'space.menu':
        this.setSpaceMenuOpen(command.open ?? !this.spaceMenuOpen);
        return { ok: true };
      case 'space.close':
        await manager.closeSpace(command.spaceId);
        return { ok: true };
      case 'zoom': {
        if (!contents) return { ok: true };
        const level = command.delta === 0 ? 0 : contents.getZoomLevel() + command.delta * 0.5;
        const bounded = Math.max(-3, Math.min(5, level));
        contents.setZoomLevel(bounded);
        if (current && /^https?:/.test(current.url)) this.navigationStore?.saveZoom(current.spaceId, new URL(current.url).origin, bounded);
        this.schedule();
        return { ok: true };
      }
      case 'find.open':
        this.closeOmnibox();
        this.setSpaceMenuOpen(false);
        this.findTabId = current?.id;
        this.find = { text: this.find?.text ?? '', active: this.find?.active ?? 0, total: this.find?.total ?? 0, focus: (this.find?.focus ?? 0) + 1 };
        this.syncOverlay();
        this.window.overlay.webContents.focus();
        this.schedule();
        return { ok: true };
      case 'find.start': {
        if (!this.find || this.findTabId !== current?.id || !contents) return { ok: false, error: 'Open Find on the current tab first.' };
        const changed = this.find.text !== command.text;
        this.find = { ...this.find, text: command.text, ...(changed ? { active: 0, total: 0 } : {}) };
        if (command.text) this.findRequest = contents.findInPage(command.text, { forward: command.forward, findNext: !changed });
        else { this.findRequest = 0; contents.stopFindInPage('clearSelection'); }
        this.schedule();
        return { ok: true };
      }
      case 'find.stop':
        this.closeFind();
        if (this.acting()) this.window.overlay.webContents.focus(); else contents?.focus();
        return { ok: true };
      case 'toast.dismiss':
        if (this.toast?.id === command.id) { this.toast = undefined; clearTimeout(this.toastTimer); this.syncOverlay(); this.schedule(); }
        return { ok: true };
      case 'run.control': {
        if (!this.engine) return { ok: false, error: 'no agent engine' };
        this.engine.control(command.spaceId, command.control.kind);
        if (command.control.kind === 'stop') this.codeMode?.stop(command.spaceId);
        return { ok: true };
      }
      case 'run.reply': {
        if (!this.engine) return { ok: false, error: 'no agent engine' };
        const accepted = this.engine.reply(command.spaceId, command.reply);
        return accepted ? { ok: true } : { ok: false, error: 'no pending request matches this reply' };
      }
      case 'tab.move':
        this.manager.moveTab(command.tabId, command.index);
        return { ok: true };
      case 'panel.toggle':
        this.panelOpen = command.open ?? !this.panelOpen;
        this.schedule();
        return { ok: true };
      case 'panel.resize':
        this.window.setPanelWidth(command.width);
        this.schedule();
        return { ok: true };
      case 'overlay.layout':
        this.overlayRequested = command.open;
        this.syncOverlay();
        return { ok: true };
      case 'memory':
        if (!this.memoryStore) return { ok: false, error: 'Local memory is unavailable.' };
        this.memoryListing = shellMemory(this.memoryStore, command.command);
        this.schedule();
        return this.memoryListing.error ? { ok: false, error: this.memoryListing.error } : { ok: true };
    }
  }
}
