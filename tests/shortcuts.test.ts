import { describe, expect, it } from 'vitest';
import { browserShortcut } from '../apps/desktop/src/main/shortcuts.js';

const context = { tabIds: ['a', 'b', 'c'], activeTabId: 'b', spaceIds: ['personal', 'agent'] };
const key = (value: string, extras: Record<string, boolean | string> = {}) => browserShortcut({ type: 'keyDown', key: value, control: true, ...extras }, context);

describe('browser shortcut mapping', () => {
  it('preserves ordinary typing, AltGr and key-up events', () => {
    expect(key('x', { control: false })).toBeUndefined();
    expect(key('t', { alt: true })).toBeUndefined();
    expect(key('t', { type: 'keyUp' })).toBeUndefined();
  });
  it('maps tab lifecycle without repeatedly creating or closing tabs', () => {
    expect(key('t')).toEqual({ type: 'tab.new' });
    expect(key('t', { shift: true })).toEqual({ type: 'tab.reopen' });
    expect(key('w')).toEqual({ type: 'tab.close', tabId: 'b' });
    expect(key('t', { isAutoRepeat: true })).toBeUndefined();
  });
  it('cycles and selects tabs, including Ctrl+9 for the last tab', () => {
    expect(key('Tab')).toEqual({ type: 'tab.activate', tabId: 'c' });
    expect(key('Tab', { shift: true })).toEqual({ type: 'tab.activate', tabId: 'a' });
    expect(key('9')).toEqual({ type: 'tab.activate', tabId: 'c' });
    expect(key('1')).toEqual({ type: 'tab.activate', tabId: 'a' });
  });
  it('handles shifted digit codes for Space switching', () => {
    expect(key('@', { shift: true, code: 'Digit2' })).toEqual({ type: 'space.switch', spaceId: 'agent' });
  });
  it('focuses the address, navigates and zooms', () => {
    expect(key('l')).toEqual({ type: 'focus.omnibox' });
    expect(key('d', { alt: true, control: false })).toEqual({ type: 'focus.omnibox' });
    expect(key('F6', { control: false })).toEqual({ type: 'focus.omnibox' });
    expect(key('r', { shift: true })).toEqual({ type: 'nav.reload', hard: true });
    expect(key('+')).toEqual({ type: 'zoom', delta: 1 });
    expect(key('\\')).toEqual({ type: 'panel.toggle' });
    expect(key('f')).toEqual({ type: 'find.open' });
  });
  it('takes over only an acting visible Space', () => {
    expect(key('Escape', { control: false })).toBeUndefined();
    expect(browserShortcut({ type: 'keyDown', key: 'Escape' }, { ...context, takeoverSpaceId: 'agent' })).toEqual({ type: 'run.control', spaceId: 'agent', control: { type: 'aether.control', kind: 'takeover' } });
  });
});
