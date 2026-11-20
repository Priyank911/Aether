import { app, type WebContents } from 'electron';
import type { ShellCommand } from '@aether/shared';
import { browserShortcut } from './shortcuts.js';
import type { ShellWindow } from './shell-window.js';
import type { SpaceManager } from './space-manager.js';

export function installBrowserShortcuts(manager: SpaceManager, window: ShellWindow, dispatch: (command: ShellCommand) => Promise<unknown>, focusOmnibox: () => void): void {
  const observe = (contents: WebContents) => {
    contents.on('before-input-event', (event, input) => {
      const entries = manager.list();
      const entry = entries.find((candidate) => candidate.record.id === manager.visibleSpaceId);
      if (!entry) return;
      const page = entry.tabs.find((tab) => tab.id === entry.activeTabId)?.view?.webContents;
      const trustedUI = contents === window.shell.webContents || contents === window.overlay.webContents;
      // A background page never consumes shortcuts or changes the person's foreground Space.
      if (!trustedUI && contents !== page) return;
      const state = manager.frameFor(entry.record.id)?.state;
      const command = browserShortcut(input, {
        tabIds: entry.tabs.map((tab) => tab.id), activeTabId: entry.activeTabId,
        spaceIds: entries.map((candidate) => candidate.record.id),
        ...(state === 'acting' || state === 'resuming' ? { takeoverSpaceId: entry.record.id } : {}),
      });
      if (!command) return;
      event.preventDefault();
      if (command.type === 'focus.omnibox') { focusOmnibox(); return; }
      if (command.type === 'devtools') { page?.toggleDevTools(); return; }
      void dispatch(command).then(() => {
        if (command.type === 'tab.new') focusOmnibox();
      }).catch((error: unknown) => console.error('Browser shortcut failed', error));
    });
  };
  observe(window.shell.webContents);
  observe(window.overlay.webContents);
  for (const entry of manager.list()) for (const tab of entry.tabs) if (tab.view) observe(tab.view.webContents);
  app.on('web-contents-created', (_event, contents) => observe(contents));
}
