import type { CDPSession } from '@aether/cdp';
import type { PageNode } from '@aether/perceiver';
import { ActionBlockedError, centreOf } from './geometry.js';
import { parseChord, pressChord, selectAll } from './keys.js';
import { clickAt } from './mouse.js';

const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);
const TRUE_WORDS = new Set(['true', 'on', 'yes', 'checked', 'check', '1']);
const FALSE_WORDS = new Set(['false', 'off', 'no', 'unchecked', 'uncheck', '0']);
const OPTION_WAIT_MS = 350;

export interface FillTarget {
  session: CDPSession;
  backendNodeId: number;
  node: PageNode;
  /** Trusted click on the target, with the reachability check. */
  click: () => Promise<void>;
}

const SELECT_OPTION = `function (wanted) {
  const want = wanted.trim().toLowerCase();
  const options = Array.from(this.options);
  const label = (option) => option.label.trim().toLowerCase();
  let index = options.findIndex((option) => label(option) === want);
  if (index < 0) index = options.findIndex((option) => option.value.toLowerCase() === want);
  if (index < 0) index = options.findIndex((option) => label(option).includes(want));
  if (index < 0) return { ok: false, options: options.slice(0, 12).map((option) => option.label.trim()) };
  this.focus();
  this.selectedIndex = index;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, chosen: options[index].label.trim() };
}`;

const FIND_OPTION = `function (wanted) {
  const want = wanted.trim().toLowerCase();
  const visible = (element) => element.getClientRects().length > 0;
  const candidates = Array.from(this.ownerDocument.querySelectorAll('[role="option"]')).filter(visible);
  return candidates.find((element) => element.textContent.trim().toLowerCase() === want)
    || candidates.find((element) => element.textContent.trim().toLowerCase().startsWith(want))
    || null;
}`;

function parseToggle(value: string): boolean {
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  throw new ActionBlockedError(`fill on a checkbox or radio takes true or false, got "${value}"`);
}

async function nodeNameOf(session: CDPSession, backendNodeId: number): Promise<string> {
  const { node } = await session.send<{ node: { nodeName: string } }>('DOM.describeNode', { backendNodeId });
  return node.nodeName.toUpperCase();
}

async function objectIdOf(session: CDPSession, backendNodeId: number): Promise<string> {
  const { object } = await session.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
  if (!object.objectId) throw new ActionBlockedError('the element could not be resolved in the page');
  return object.objectId;
}

async function selectNativeOption(session: CDPSession, backendNodeId: number, value: string): Promise<string> {
  const result = await session.send<{ result: { value?: { ok: boolean; chosen?: string; options?: string[] } } }>('Runtime.callFunctionOn', {
    objectId: await objectIdOf(session, backendNodeId),
    functionDeclaration: SELECT_OPTION,
    arguments: [{ value }],
    returnByValue: true,
  });
  const outcome = result.result.value;
  if (!outcome?.ok) {
    throw new ActionBlockedError(`no option "${value}"; options are: ${(outcome?.options ?? []).join(', ')}`);
  }
  return `chose "${outcome.chosen}"`;
}

/** Click the visible option of an open listbox whose text matches; returns false when none is shown. */
async function chooseListOption(session: CDPSession, backendNodeId: number, value: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, OPTION_WAIT_MS));
  const found = await session.send<{ result: { objectId?: string; subtype?: string } }>('Runtime.callFunctionOn', {
    objectId: await objectIdOf(session, backendNodeId),
    functionDeclaration: FIND_OPTION,
    arguments: [{ value }],
  });
  if (!found.result.objectId || found.result.subtype === 'null') return false;
  const { node } = await session.send<{ node: { backendNodeId: number } }>('DOM.describeNode', { objectId: found.result.objectId });
  await clickAt(session, await centreOf(session, node.backendNodeId));
  return true;
}

/**
 * Set a control to a value the way a person would: type into text fields,
 * pick a native select option by its visible label, open an ARIA combobox and
 * click the matching option, or click a checkbox only when its state differs.
 * Returns a short note for the receipt.
 */
export async function fill(target: FillTarget, value: string): Promise<string | undefined> {
  const { session, backendNodeId, node } = target;

  if (TOGGLE_ROLES.has(node.role)) {
    const wanted = parseToggle(value);
    const current = node.states.includes('checked');
    if (wanted === current) return `already ${current ? 'checked' : 'unchecked'}`;
    if (!wanted && node.role === 'radio') throw new ActionBlockedError('a radio button cannot be cleared; choose another option');
    await target.click();
    return undefined;
  }

  const nodeName = await nodeNameOf(session, backendNodeId);
  if (nodeName === 'SELECT') return selectNativeOption(session, backendNodeId, value);

  const typesText = nodeName === 'INPUT' || nodeName === 'TEXTAREA' || node.role !== 'combobox';
  await target.click();
  if (!typesText) {
    return (await chooseListOption(session, backendNodeId, value)) ? `chose "${value}"` : `opened; no option "${value}" is shown`;
  }

  await selectAll(session);
  if (value === '') await pressChord(session, parseChord('Delete'));
  else await session.send('Input.insertText', { text: value });

  if (node.role === 'combobox' && value !== '') {
    return (await chooseListOption(session, backendNodeId, value)) ? `chose suggestion "${value}"` : 'typed; no matching suggestion';
  }
  return undefined;
}
