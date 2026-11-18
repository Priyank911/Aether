import { ipcMain, type WebContents } from 'electron';
import { ShellCommandSchema, type ShellCommand, type ShellSnapshot, type ShellTab } from '@aether/shared';
import { resolveInput } from './omnibox.js';
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
    muted: live?.isAudioMuted() ?? false,
    zoomPercent: Math.min(500, Math.max(25, Math.round((live?.getZoomFactor() ?? 1) * 100))),
  };
}

export function buildSnapshot(manager: SpaceManager): ShellSnapshot {
  return {
    type: 'shell.snapshot',
    activeSpaceId: manager.visibleSpaceId,
    panelOpen: false,
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

export class ShellBridge {
  private readonly manager: SpaceManager;
  private readonly shell: WebContents;
  private readonly window: ShellWindow;
  private readonly engine?: DesktopSpaceEngine;
  private readonly codeMode?: CodeModeHost;
  private timer?: NodeJS.Timeout;

  public constructor(manager: SpaceManager, window: ShellWindow, engine?: DesktopSpaceEngine, codeMode?: CodeModeHost) {
    const shell = window.shell.webContents;
    this.manager = manager;
    this.shell = shell;
    this.window = window;
    this.engine = engine;
    this.codeMode = codeMode;
    ipcMain.handle('aether:command', async (event, raw: unknown): Promise<CommandResult> => {
      if (event.sender !== this.shell) return { ok: false, error: 'commands are accepted from the Aether shell only' };
      const parsed = ShellCommandSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: `bad command: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
      try {
        return await this.run(parsed.data);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    manager.on('changed', () => this.schedule());
  }

  public push(): void {
    if (this.shell.isDestroyed()) return;
    const snapshot = buildSnapshot(this.manager);
    // The Agent bar exists only for the interim shell; the Phase 4 layout reserves its row always.
    const shown = snapshot.spaces.find((entry) => entry.space.id === snapshot.activeSpaceId);
    this.window.setAgentBar(Boolean(shown?.frame && shown.frame.state !== 'idle'));
    this.shell.send('aether:snapshot', snapshot);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.push();
    }, PUSH_DELAY_MS);
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
        this.push();
        return { ok: true };
      case 'tab.new':
        manager.openTab(command.spaceId ?? manager.visibleSpaceId, command.url ?? 'about:blank', { activate: true });
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
        tab?.view?.webContents.setAudioMuted(command.muted);
        this.schedule();
        return { ok: true };
      }
      case 'tab.sendToAgent': {
        const tab = manager.tab(command.tabId);
        if (!tab) return { ok: false, error: 'no such tab' };
        if (tab.kind !== 'human') return { ok: false, error: 'this tab is already in an Agent Space' };
        const target = command.spaceId ?? manager.agentSpace('From Personal').id;
        manager.openTab(target, tab.url, { live: true });
        manager.closeTab(tab.id);
        return { ok: true };
      }
      case 'nav.go': {
        const resolved = resolveInput(command.input);
        if (resolved.kind === 'refused') return { ok: false, error: resolved.reason };
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
        if (!contents && current) current.wake();
        else if (command.hard) contents?.reloadIgnoringCache();
        else contents?.reload();
        return { ok: true };
      case 'nav.stop':
        contents?.stop();
        return { ok: true };
      case 'space.switch':
        manager.showSpace(command.spaceId);
        return { ok: true };
      case 'space.close':
        await manager.closeSpace(command.spaceId);
        return { ok: true };
      case 'zoom': {
        if (!contents) return { ok: true };
        const level = command.delta === 0 ? 0 : contents.getZoomLevel() + command.delta * 0.5;
        contents.setZoomLevel(Math.max(-3, Math.min(5, level)));
        this.schedule();
        return { ok: true };
      }
      case 'find.start':
        if (contents && command.text) contents.findInPage(command.text, { forward: command.forward, findNext: true });
        return { ok: true };
      case 'find.stop':
        contents?.stopFindInPage('clearSelection');
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
      case 'panel.toggle':
      case 'overlay.layout':
      case 'memory':
        return { ok: false, error: `${command.type} arrives with the full shell in Step 4` };
    }
  }
}
