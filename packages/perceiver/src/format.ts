import { CELL_ROLES, FRAME_ROLE, INTERACTIVE_ROLES, TABLE_ROLES } from './roles.js';
import type { PageNode, PageModel, Visibility } from './types.js';

export const MAX_NAME_LENGTH = 80;
export const MAX_VALUE_LENGTH = 60;
const MAX_CELL_LENGTH = 60;

/**
 * Rough token count for outline text. Bracket and quote heavy text runs near
 * 3.5 characters per token; this errs toward overestimating.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Collapse whitespace and rewrite bracketed tokens so page text cannot imitate a ref or a state. */
export function neutralize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\[([^\]\s]{1,24})\]/g, '($1)');
}

export function quote(text: string, max = MAX_NAME_LENGTH): string {
  const cleaned = truncate(neutralize(text), max).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${cleaned}"`;
}

export function indent(depth: number): string {
  return '  '.repeat(depth);
}

function countRows(node: PageNode): number {
  let rows = 0;
  const visit = (n: PageNode): void => {
    for (const child of n.children) {
      if (child.role === 'row') rows++;
      else if (!TABLE_ROLES.has(child.role)) visit(child);
    }
  };
  visit(node);
  return rows;
}

/** One line for a kept node, without children. */
export function nodeLine(node: PageNode): string {
  if (node.role === FRAME_ROLE) return `frame ${node.frameOrdinal} ${quote(node.name, 120)}`;
  if (node.role === 'row') return rowLine(node);
  const parts: string[] = [node.ref ? `[${node.ref}] ${node.role}` : node.role];
  if (node.name) parts.push(quote(node.name));
  if (node.level !== undefined) parts.push(`level=${node.level}`);
  if (node.value !== undefined && node.value !== '') parts.push(`value=${quote(node.value, MAX_VALUE_LENGTH)}`);
  if (TABLE_ROLES.has(node.role)) parts.push(`rows=${countRows(node)}`);
  for (const state of node.states) parts.push(`[${state}]`);
  return parts.join(' ');
}

/** Drop tokens with no letter or digit, which is what remains after control names are lifted out of a cell. */
function stripPunctuationTokens(text: string): string {
  return text
    .split(' ')
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .join(' ');
}

function cellText(text: string): string {
  return truncate(stripPunctuationTokens(neutralize(text).replace(/\|/g, ' ')), MAX_CELL_LENGTH);
}

function controlsIn(node: PageNode): PageNode[] {
  const found: PageNode[] = [];
  const visit = (n: PageNode): void => {
    for (const child of n.children) {
      if (child.ref && INTERACTIVE_ROLES.has(child.role)) found.push(child);
      else visit(child);
    }
  };
  visit(node);
  return found;
}

function cellContent(cell: PageNode): string {
  const controls = controlsIn(cell);
  let text = cell.name;
  for (const control of controls) {
    if (control.name) text = text.replace(control.name, '');
  }
  const parts = [cellText(text)].filter(Boolean);
  for (const control of controls) parts.push(nodeLine(control));
  return parts.join(' ');
}

/** A row with no text and no controls, such as a spacer row in a layout table. */
export function isBlankRow(node: PageNode): boolean {
  if (node.role !== 'row') return false;
  return node.children.every((cell) => !/[\p{L}\p{N}]/u.test(cell.name) && controlsIn(cell).length === 0 && !cell.ref);
}

/** A table row as one pipe-separated line, with refs for the controls inside its cells. */
export function rowLine(row: PageNode): string {
  const cells: string[] = [];
  let allHeaders = row.children.length > 0;
  for (const child of row.children) {
    if (CELL_ROLES.has(child.role)) {
      if (child.role !== 'columnheader') allHeaders = false;
      cells.push(cellContent(child));
    } else {
      allHeaders = false;
      cells.push(nodeLine(child));
    }
  }
  const label = allHeaders ? 'header' : 'row';
  const states = row.states.map((state) => ` [${state}]`).join('');
  return `[${row.ref}] ${label}${states}: ${cells.join(' | ')}`;
}

export function visibilityNote(visibility: Visibility): string {
  return visibility === 'in' ? '' : ` (${visibility === 'offscreen' ? 'off-screen' : visibility})`;
}

/** Warnings that the tool layer places outside the untrusted wrapper. */
export function captureWarnings(model: PageModel): string[] {
  if (model.unreadFrames === 0) return [];
  const noun = model.unreadFrames === 1 ? 'frame' : 'frames';
  return [`partial capture: ${model.unreadFrames} ${noun} not read; content there is unknown, not absent`];
}
