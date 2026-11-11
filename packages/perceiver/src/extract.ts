import { nameOf, property, roleOf, axValueOf, type RawAXNode } from './capture/ax.js';
import type { DocumentIndex, Box } from './capture/snapshot.js';
import { centreInside, classify, type Viewport } from './capture/viewport.js';
import { neutralize } from './format.js';
import { isIdentityField, isMaskedByBrowser, isSensitiveField, looksLikeCardNumber, MASK } from './mask.js';
import type { RefRegistry } from './registry.js';
import {
  BLOCK_DISPLAYS,
  BLOCK_ROLES,
  CELL_ROLES,
  DIALOG_ROLES,
  EDITABLE_ROLES,
  getsRef,
  HEADING_ROLES,
  INTERACTIVE_ROLES,
  isKeptRole,
  ROW_ROLES,
  SKIP_SUBTREE_ROLES,
  STATUS_ROLES,
  VALUE_ROLES,
} from './roles.js';
import { LineBuilder } from './text-lines.js';
import type { NodeState, PageNode, TextLine, Visibility } from './types.js';

export interface EmbeddedFrame {
  node: PageNode;
  lines: TextLine[];
}

export interface FrameInput {
  ordinal: number;
  nodes: RawAXNode[];
  doc?: DocumentIndex;
  /** Undefined when the frame's visible region is unknown; everything then counts as in view. */
  viewport?: Viewport;
  frameVisibility: Visibility;
  /** Document URL of the frame, for resolving link targets. */
  baseUrl: string;
  /** Returns the extracted child frame owned by the given iframe element, if any. */
  embed: (ownerBackendId: number) => EmbeddedFrame | undefined;
}

export interface FrameOutput {
  roots: PageNode[];
  lines: TextLine[];
  title: string;
}

interface Context {
  path: readonly string[];
  visibility: Visibility;
  inEditable: boolean;
  suppressText: boolean;
  row?: { cells: number };
}

function resolveHref(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw, base).href;
  } catch {
    return undefined;
  }
}

function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function statesOf(node: RawAXNode): NodeState[] {
  const states: NodeState[] = [];
  if (isTrue(property(node, 'focused'))) states.push('focused');
  if (isTrue(property(node, 'disabled'))) states.push('disabled');
  const checked = property(node, 'checked');
  if (isTrue(checked)) states.push('checked');
  else if (checked === 'mixed') states.push('mixed');
  const expanded = property(node, 'expanded');
  if (isTrue(expanded)) states.push('expanded');
  else if (expanded === false || expanded === 'false') states.push('collapsed');
  if (isTrue(property(node, 'selected'))) states.push('selected');
  if (isTrue(property(node, 'required'))) states.push('required');
  const invalid = property(node, 'invalid');
  if (invalid !== undefined && invalid !== false && invalid !== 'false') states.push('invalid');
  return states;
}

/**
 * Walk one frame's accessibility tree once, producing the kept-node tree and the
 * page text lines. Refs are assigned in document order.
 */
export function extractFrame(input: FrameInput, registry: RefRegistry): FrameOutput {
  const byId = new Map(input.nodes.map((node) => [node.nodeId, node]));
  const seen = new Set<number>();
  const lines = new LineBuilder();
  const roots: PageNode[] = [];
  let title = '';

  const childrenOf = (node: RawAXNode): RawAXNode[] =>
    (node.childIds ?? []).map((id) => byId.get(id)).filter((child): child is RawAXNode => child !== undefined);

  const subtreeText = (node: RawAXNode): string => {
    const parts: string[] = [];
    const walk = (current: RawAXNode): void => {
      if (roleOf(current) === 'StaticText') parts.push(nameOf(current));
      else for (const child of childrenOf(current)) walk(child);
    };
    walk(node);
    return parts.join(' ').trim();
  };

  const visibilityOf = (box: Box | undefined, inherited: Visibility): Visibility => {
    if (input.frameVisibility !== 'in') return input.frameVisibility;
    if (!box || !input.viewport) return inherited;
    return classify(box, input.viewport);
  };

  const visit = (node: RawAXNode, out: PageNode[], ctx: Context): void => {
    const role = roleOf(node);
    if (SKIP_SUBTREE_ROLES.has(role)) return;
    const backendId = node.backendDOMNodeId;

    if (role === 'RootWebArea' && !title) title = nameOf(node);

    if (role === 'Iframe' && backendId !== undefined) {
      const embedded = input.embed(backendId);
      if (embedded) {
        out.push(embedded.node);
        lines.append(embedded.lines, ctx.path);
      }
      return;
    }

    const nodeIndex = backendId !== undefined ? input.doc?.nodeIndex(backendId) : undefined;
    const box = nodeIndex !== undefined ? input.doc?.box(nodeIndex) : undefined;
    const visibility = visibilityOf(box, ctx.visibility);

    if (role === 'LineBreak') {
      if (ctx.row) lines.add(' ', ' ', ctx.path, visibility);
      else lines.flush();
      return;
    }

    if (role === 'StaticText') {
      if (!node.ignored && !ctx.inEditable && !ctx.suppressText) {
        const text = neutralize(nameOf(node));
        lines.add(` ${text} `, ` ${text} `, ctx.path, visibility);
      }
      return;
    }

    const display = nodeIndex !== undefined ? input.doc?.display(nodeIndex) : undefined;
    const block = !ctx.row && (BLOCK_ROLES.has(role) || (display !== undefined && BLOCK_DISPLAYS.has(display)));
    if (block) lines.flush();
    if (role === 'listitem') lines.startWith('- ');

    const kept = !node.ignored && isKeptRole(role) && backendId !== undefined && !seen.has(backendId);
    let childOut = out;
    const childCtx: Context = { ...ctx, visibility };

    if (kept && backendId !== undefined) {
      seen.add(backendId);
      const ref = getsRef(role) ? registry.getOrAssign(input.ordinal, backendId) : undefined;
      let name = nameOf(node);
      if (!name && STATUS_ROLES.has(role)) name = subtreeText(node);

      let value = VALUE_ROLES.has(role) ? axValueOf(node) : undefined;
      let sensitive = false;
      let identity = false;
      let href: string | undefined;
      const attributes =
        (VALUE_ROLES.has(role) || role === 'link') && nodeIndex !== undefined && input.doc ? input.doc.attributes(nodeIndex) : undefined;
      if (role === 'link') href = resolveHref(attributes?.get('href'), input.baseUrl);
      if (VALUE_ROLES.has(role) && attributes) {
        identity = isIdentityField(attributes);
        sensitive =
          isSensitiveField(attributes, name) ||
          (value !== undefined && (isMaskedByBrowser(value) || looksLikeCardNumber(value)));
        if (sensitive && value) value = MASK;
      }

      const states = statesOf(node);
      if (
        INTERACTIVE_ROLES.has(role) &&
        visibility === 'in' &&
        box &&
        nodeIndex !== undefined &&
        input.viewport &&
        centreInside(box, input.viewport) &&
        input.doc?.isCovered(nodeIndex, box)
      ) {
        states.push('covered');
      }

      const level = property(node, 'level');
      const element: PageNode = {
        ref,
        backendDOMNodeId: backendId,
        frameOrdinal: input.ordinal,
        role,
        name,
        value,
        level: HEADING_ROLES.has(role) && typeof level === 'number' ? level : undefined,
        states,
        visibility,
        modal: DIALOG_ROLES.has(role) && isTrue(property(node, 'modal')),
        sensitive,
        identity,
        href,
        children: [],
      };
      out.push(element);
      childOut = element.children;
      if (ref) childCtx.path = [...ctx.path, ref];

      if (!ctx.suppressText) {
        if (HEADING_ROLES.has(role)) {
          lines.flush();
          const text = neutralize(name);
          lines.add(text, `${'#'.repeat(element.level ?? 2)} ${text}`, childCtx.path, visibility);
          childCtx.suppressText = true;
        } else if (INTERACTIVE_ROLES.has(role) && ref) {
          const text = neutralize(name);
          if (EDITABLE_ROLES.has(role)) {
            const shown = value ? ` = ${neutralize(value)}` : '';
            lines.add(' ', ` [${role} ${text}${shown}](${ref}) `, childCtx.path, visibility);
          } else if (role === 'link') {
            lines.add(` ${text} `, ` [${text}](${ref}) `, childCtx.path, visibility);
          } else {
            lines.add(` ${text} `, ` [${role}: ${text}](${ref}) `, childCtx.path, visibility);
          }
          childCtx.suppressText = true;
        }
      }
      if (EDITABLE_ROLES.has(role)) childCtx.inEditable = true;
    }

    if (ROW_ROLES.has(role)) {
      lines.flush();
      childCtx.row = { cells: 0 };
    } else if (CELL_ROLES.has(role) && ctx.row) {
      if (ctx.row.cells > 0) lines.add(' | ', ' | ', ctx.path, visibility);
      ctx.row.cells++;
    }

    for (const child of childrenOf(node)) visit(child, childOut, childCtx);

    if (block || ROW_ROLES.has(role) || (kept && HEADING_ROLES.has(role))) lines.flush();
  };

  const rootContext: Context = {
    path: [],
    visibility: input.frameVisibility,
    inEditable: false,
    suppressText: false,
  };
  for (const node of input.nodes) {
    if (!node.parentId || !byId.has(node.parentId)) visit(node, roots, rootContext);
  }
  lines.flush();

  return { roots, lines: lines.lines, title };
}
