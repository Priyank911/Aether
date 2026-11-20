import { app, clipboard, Menu, type WebContents } from 'electron';
import type { ShellCommand } from '@aether/shared';
import type { SpaceManager } from './space-manager.js';
import type { ShellWindow } from './shell-window.js';

/** Native page affordances never originate in page JavaScript or the agent tool surface. */
export function installBrowserBasics(manager: SpaceManager, window: ShellWindow, dispatch: (command: ShellCommand) => void): void {
  const observe = (contents: WebContents) => {
    const tab = () => manager.list().flatMap((entry) => entry.tabs).find((candidate) => candidate.view?.webContents === contents);
    contents.on('context-menu', (_event, details) => {
      const current = tab();
      if (!current || current !== manager.shownTab()) return;
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (/^https?:/i.test(details.linkURL)) {
        template.push({ label: 'Open link in new tab', click: () => dispatch({ type: 'tab.new', spaceId: current.spaceId, url: details.linkURL }) });
        template.push({ label: 'Copy link address', click: () => clipboard.writeText(details.linkURL) }, { type: 'separator' });
      }
      if (details.isEditable) template.push({ label: 'Undo', click: () => contents.undo() }, { label: 'Cut', click: () => contents.cut() }, { label: 'Copy', click: () => contents.copy() }, { label: 'Paste', click: () => contents.paste() }, { label: 'Select all', click: () => contents.selectAll() }, { type: 'separator' });
      else if (details.selectionText) template.push({ label: 'Copy', click: () => contents.copy() }, { type: 'separator' });
      template.push({ label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => dispatch({ type: 'nav.back' }) }, { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => dispatch({ type: 'nav.forward' }) }, { label: 'Reload', click: () => dispatch({ type: 'nav.reload' }) }, { label: 'Print', click: () => dispatch({ type: 'page.print' }) });
      if (current.kind === 'human') template.push({ type: 'separator' }, { label: 'Send tab to Agent Space', click: () => dispatch({ type: 'tab.sendToAgent', tabId: current.id }) });
      Menu.buildFromTemplate(template).popup({ window: window.window });
    });
    contents.on('enter-html-full-screen', () => { const current = tab(); if (current && current === manager.shownTab()) window.setPageFullscreen(true); });
    contents.on('leave-html-full-screen', () => { const current = tab(); if (current && current === manager.shownTab()) window.setPageFullscreen(false); });
    contents.once('destroyed', () => { const current = tab(); if (current && current === manager.shownTab()) window.setPageFullscreen(false); });
  };
  app.on('web-contents-created', (_event, contents) => observe(contents));
  for (const entry of manager.list()) for (const tab of entry.tabs) if (tab.view) observe(tab.view.webContents);
}
