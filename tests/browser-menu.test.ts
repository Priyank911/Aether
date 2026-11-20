import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ShellCommandSchema, type ShellCommand } from '@aether/shared';
import { browserMenuTemplate } from '../apps/desktop/src/main/browser-menu.js';

function context(tabId: string | undefined = 'tab-one') {
  return { tabId, canGoBack: false, canGoForward: true, panelOpen: true, dispatch: vi.fn<(command: ShellCommand) => void>(), quit: vi.fn() };
}

function click(item: MenuItemConstructorOptions | undefined): void {
  // Electron supplies native objects at runtime; callbacks in this template intentionally use none.
  const callback = item?.click as (() => void) | undefined;
  callback?.();
}

function children(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return Array.isArray(item?.submenu) ? item.submenu : [];
}

describe('native browser menu template', () => {
  it('contains only functional browser actions and native edit roles', () => {
    const menu = browserMenuTemplate(context());
    expect(menu.filter((item) => item.label).map((item) => item.label)).toEqual([
      'New tab', 'Close tab', 'Reopen closed tab', 'Back', 'Forward', 'Reload', 'Zoom', 'Edit', 'Find in page', 'History', 'Bookmark this page', 'Show bookmarks bar', 'Print', 'Settings', 'About Aether', 'Spaces', 'Side panel', 'Quit',
    ]);
    expect(children(menu.find((item) => item.label === 'Edit')).filter((item) => item.role).map((item) => item.role)).toEqual([
      'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
    ]);
    expect(menu.find((item) => item.label === 'Back')?.enabled).toBe(false);
    expect(menu.find((item) => item.label === 'Forward')?.enabled).toBe(true);
    expect(menu.find((item) => item.label === 'Side panel')).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('dispatches schema-valid commands, including zoom, and quits without shell focus calls', () => {
    const deps = context();
    const menu = browserMenuTemplate(deps);
    for (const item of menu) {
      if (item.enabled !== false) click(item);
      for (const child of children(item)) click(child);
    }
    expect(deps.dispatch.mock.calls.map(([command]) => ShellCommandSchema.parse(command))).toEqual([
      { type: 'tab.new' },
      { type: 'tab.close', tabId: 'tab-one' },
      { type: 'tab.reopen' },
      { type: 'nav.forward' },
      { type: 'nav.reload' },
      { type: 'zoom', delta: 1 },
      { type: 'zoom', delta: -1 },
      { type: 'zoom', delta: 0 },
      { type: 'find.open' },
      { type: 'history.open' },
      { type: 'bookmark.toggle' },
      { type: 'bookmarks.toggle' },
      { type: 'page.print' },
      { type: 'settings.open' },
      { type: 'tab.new', url: 'aether://about/' },
      { type: 'space.menu', open: true },
      { type: 'panel.toggle' },
    ]);
    expect(deps.quit).toHaveBeenCalledOnce();
  });

  it('disables tab-specific actions when no tab is shown', () => {
    const deps = { ...context(), tabId: undefined, canGoForward: false };
    const menu = browserMenuTemplate(deps);
    for (const label of ['Close tab', 'Reload', 'Zoom']) expect(menu.find((item) => item.label === label)?.enabled).toBe(false);
    click(menu.find((item) => item.label === 'Close tab'));
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
});
