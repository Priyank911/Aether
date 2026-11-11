import type { CDPSession } from '@aether/cdp';

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
};

/** CDP modifier bits. */
const MODIFIERS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, shift: 8 };

export interface KeyChord {
  definition: KeyDefinition;
  modifiers: number;
}

function single(character: string): KeyDefinition {
  const upper = character.toUpperCase();
  const isLetter = /^[A-Z]$/.test(upper);
  const isDigit = /^[0-9]$/.test(character);
  return {
    key: character,
    code: isLetter ? `Key${upper}` : isDigit ? `Digit${character}` : '',
    keyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
    text: character,
  };
}

/** Parse "Enter", "Shift+Tab" or "Control+a". */
export function parseChord(value: string): KeyChord {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const keyName = parts.pop();
  if (!keyName) throw new Error('key needs a value such as Enter or Shift+Tab');
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase()];
    if (bit === undefined) throw new Error(`unknown modifier "${part}"; use Shift, Control, Alt or Meta`);
    modifiers |= bit;
  }
  const definition = NAMED_KEYS[keyName.toLowerCase()] ?? (keyName.length === 1 ? single(keyName) : undefined);
  if (!definition) throw new Error(`unknown key "${keyName}"`);
  return { definition, modifiers };
}

/** A trusted key press on whatever has focus in the session. */
export async function pressChord(session: CDPSession, chord: KeyChord): Promise<void> {
  const { definition, modifiers } = chord;
  // Text is only sent without Control, Alt or Meta, so shortcuts do not type characters.
  const text = modifiers & 7 ? undefined : definition.text;
  const base = {
    key: definition.key,
    code: definition.code,
    windowsVirtualKeyCode: definition.keyCode,
    nativeVirtualKeyCode: definition.keyCode,
    modifiers,
  };
  await session.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text, unmodifiedText: text });
  await session.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

/** Select everything in the focused field with the platform shortcut. */
export async function selectAll(session: CDPSession): Promise<void> {
  const modifier = process.platform === 'darwin' ? MODIFIERS.meta : MODIFIERS.control;
  await session.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'a',
    code: 'KeyA',
    windowsVirtualKeyCode: 65,
    modifiers: modifier,
    commands: ['selectAll'],
  });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: modifier });
}
