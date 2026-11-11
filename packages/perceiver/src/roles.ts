/** Roles a person can act on. Each gets a ref. */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Page regions. Each is a summary scope in the skim. */
export const LANDMARK_ROLES = new Set([
  'banner',
  'navigation',
  'main',
  'search',
  'form',
  'dialog',
  'alertdialog',
  'contentinfo',
  'complementary',
  'region',
]);

export const HEADING_ROLES = new Set(['heading']);
export const TABLE_ROLES = new Set(['table', 'grid', 'treegrid']);
export const ROW_ROLES = new Set(['row']);
export const CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
export const LIST_ROLES = new Set(['list', 'listbox', 'menu', 'menubar', 'tablist', 'radiogroup', 'tree']);
export const STATUS_ROLES = new Set(['alert', 'status']);
export const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);

/** Interactive roles whose AX value is shown. */
export const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);

/** Text typed into these is reported as the value, never as page text. */
export const EDITABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** Subtrees never read: inline boxes, list bullets, closed select popups. */
export const SKIP_SUBTREE_ROLES = new Set(['InlineTextBox', 'ListMarker', 'MenuListPopup']);

/** Roles that always start a new text line. */
export const BLOCK_ROLES = new Set([
  'heading',
  'paragraph',
  'listitem',
  'row',
  'list',
  'table',
  'blockquote',
  'article',
  'figure',
  'caption',
  'term',
  'definition',
  ...LANDMARK_ROLES,
  ...STATUS_ROLES,
]);

/** CSS display values that start a new text line. */
export const BLOCK_DISPLAYS = new Set([
  'block',
  'flex',
  'grid',
  'list-item',
  'table',
  'table-row',
  'table-caption',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'flow-root',
]);

/** Kept nodes with no ref: cells only make sense through their row. */
export function getsRef(role: string): boolean {
  return !CELL_ROLES.has(role);
}

export function isKeptRole(role: string): boolean {
  return (
    INTERACTIVE_ROLES.has(role) ||
    LANDMARK_ROLES.has(role) ||
    HEADING_ROLES.has(role) ||
    TABLE_ROLES.has(role) ||
    ROW_ROLES.has(role) ||
    CELL_ROLES.has(role) ||
    LIST_ROLES.has(role) ||
    STATUS_ROLES.has(role)
  );
}

/** Synthetic role for an embedded frame. */
export const FRAME_ROLE = 'frame';

/** A scope collects the counts of its out-of-view content into one summary line. */
export function isScope(role: string): boolean {
  return LANDMARK_ROLES.has(role) || role === FRAME_ROLE;
}
