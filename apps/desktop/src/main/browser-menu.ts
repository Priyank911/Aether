import type { MenuItemConstructorOptions } from 'electron';
import type { ShellCommand } from '@aether/shared';

export interface BrowserMenuContext {
  tabId?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  panelOpen: boolean;
  dispatch: (command: ShellCommand) => void;
  quit: () => void;
}

/** Native edit roles act on the focused contents; opening this menu must not focus the shell. */
export function browserMenuTemplate(context: BrowserMenuContext): MenuItemConstructorOptions[] {
  const action = (label: string, command: ShellCommand, enabled = true): MenuItemConstructorOptions => ({
    label, enabled, click: () => context.dispatch(command),
  });
  return [
    action('New tab', { type: 'tab.new' }),
    { label: 'Close tab', enabled: Boolean(context.tabId), click: () => {
      if (context.tabId) context.dispatch({ type: 'tab.close', tabId: context.tabId });
    } },
    action('Reopen closed tab', { type: 'tab.reopen' }),
    { type: 'separator' },
    action('Back', { type: 'nav.back' }, context.canGoBack),
    action('Forward', { type: 'nav.forward' }, context.canGoForward),
    action('Reload', { type: 'nav.reload' }, Boolean(context.tabId)),
    { label: 'Zoom', enabled: Boolean(context.tabId), submenu: [
      action('Zoom in', { type: 'zoom', delta: 1 }),
      action('Zoom out', { type: 'zoom', delta: -1 }),
      action('Actual size', { type: 'zoom', delta: 0 }),
    ] },
    { type: 'separator' },
    { label: 'Edit', submenu: [
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select all', role: 'selectAll' },
    ] },
    action('Find in page', { type: 'find.open' }, Boolean(context.tabId)),
    action('History', { type: 'history.open' }),
    action('Bookmark this page', { type: 'bookmark.toggle' }, Boolean(context.tabId)),
    action('Show bookmarks bar', { type: 'bookmarks.toggle' }),
    action('Print', { type: 'page.print' }, Boolean(context.tabId)),
    action('Settings', { type: 'settings.open' }),
    action('About Aether', { type: 'tab.new', url: 'aether://about/' }),
    action('Spaces', { type: 'space.menu', open: true }),
    { ...action('Side panel', { type: 'panel.toggle' }), type: 'checkbox', checked: context.panelOpen },
    { type: 'separator' },
    { label: 'Quit', click: context.quit },
  ];
}
