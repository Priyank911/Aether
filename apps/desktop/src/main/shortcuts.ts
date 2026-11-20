import type { ShellCommand } from '@aether/shared';

interface KeyInput {
  type: string;
  key: string;
  code?: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  isAutoRepeat?: boolean;
}
export interface ShortcutContext {
  tabIds: readonly string[];
  activeTabId?: string;
  spaceIds: readonly string[];
  takeoverSpaceId?: string;
}
export type BrowserShortcut = ShellCommand | { type: 'focus.omnibox' } | { type: 'devtools' };

/** Pure mapping shared by native-input tests; never handles ordinary page typing. */
export function browserShortcut(input: KeyInput, context: ShortcutContext): BrowserShortcut | undefined {
  if (input.type !== 'keyDown') return undefined;
  const key = input.key.toLowerCase();
  const mod = Boolean(input.control || input.meta);
  const digit = /^Digit[1-9]$/.test(input.code ?? '') ? Number(input.code?.slice(-1)) : /^[1-9]$/.test(key) ? Number(key) : 0;
  if (key === 'escape' && context.takeoverSpaceId) return { type: 'run.control', spaceId: context.takeoverSpaceId, control: { type: 'aether.control', kind: 'takeover' } };
  if (key === 'f12' && !mod && !input.alt) return { type: 'devtools' };
  if ((key === 'f6' && !mod && !input.alt) || (input.alt && !mod && key === 'd') || (mod && !input.alt && key === 'l')) return { type: 'focus.omnibox' };
  if (input.alt && !mod && !input.shift && (key === 'arrowleft' || key === 'arrowright')) return { type: key === 'arrowleft' ? 'nav.back' : 'nav.forward' };
  if ((key === 'f5' && !input.alt) || (mod && !input.alt && key === 'r')) return { type: 'nav.reload', hard: Boolean(input.shift) };
  if (!mod || input.alt) return undefined;
  if (digit) {
    if (input.shift) {
      const id = context.spaceIds[digit - 1];
      return id ? { type: 'space.switch', spaceId: id } : undefined;
    }
    const id = context.tabIds[digit === 9 ? context.tabIds.length - 1 : digit - 1];
    return id ? { type: 'tab.activate', tabId: id } : undefined;
  }
  if (key === 'tab') {
    const count = context.tabIds.length;
    const from = context.tabIds.indexOf(context.activeTabId ?? '');
    const id = count ? context.tabIds[(Math.max(0, from) + (input.shift ? -1 : 1) + count) % count] : undefined;
    return id ? { type: 'tab.activate', tabId: id } : undefined;
  }
  if (key === 't' && !input.isAutoRepeat) return { type: input.shift ? 'tab.reopen' : 'tab.new' };
  if (key === 'w' && !input.shift && !input.isAutoRepeat && context.activeTabId) return { type: 'tab.close', tabId: context.activeTabId };
  if (key === 'h' && !input.shift) return { type: 'history.open' };
  if (key === 'd' && !input.shift) return { type: 'bookmark.toggle' };
  if (key === 'b' && input.shift) return { type: 'bookmarks.toggle' };
  if (key === 'p' && !input.shift) return { type: 'page.print' };
  if (key === 'f' && !input.shift) return { type: 'find.open' };
  if (key === '\\' && !input.shift) return { type: 'panel.toggle' };
  if (key === '=' || key === '+') return { type: 'zoom', delta: 1 };
  if (key === '-') return { type: 'zoom', delta: -1 };
  if (key === '0') return { type: 'zoom', delta: 0 };
  return undefined;
}
