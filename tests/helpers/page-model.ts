import type { CDPSession } from '@aether/cdp';
import { indexNodes, type PageModel, type PageNode, type TextLine, type Visibility } from '@aether/perceiver';

let nextRef = 1;
let nextBackend = 1;

export function resetRefs(): void {
  nextRef = 1;
  nextBackend = 1;
}

export interface NodeOptions {
  ref?: string | null;
  value?: string;
  level?: number;
  states?: PageNode['states'];
  visibility?: Visibility;
  modal?: boolean;
  sensitive?: boolean;
  children?: PageNode[];
}

/** A kept node with a fresh ref unless `ref: null` is given (cells, frames). */
export function node(role: string, name = '', options: NodeOptions = {}): PageNode {
  const ref = options.ref === null ? undefined : (options.ref ?? `e${nextRef++}`);
  return {
    ref,
    backendDOMNodeId: nextBackend++,
    frameOrdinal: 0,
    role,
    name,
    value: options.value,
    level: options.level,
    states: options.states ?? [],
    visibility: options.visibility ?? 'in',
    modal: options.modal ?? false,
    sensitive: options.sensitive ?? false,
    identity: false,
    children: options.children ?? [],
  };
}

export function line(plain: string, path: string[] = [], visibility: Visibility = 'in', linked = plain): TextLine {
  return { plain, linked, path, visibility };
}

export interface ModelOptions {
  url?: string;
  documentId?: string;
  lines?: TextLine[];
  frameIds?: string[];
  unreadFrames?: number;
  scrollPercent?: number;
}

/** A page model without a browser. The session is never used by the renderers. */
export function model(roots: PageNode[], options: ModelOptions = {}): PageModel {
  const url = options.url ?? 'https://example.test/';
  const session = {} as unknown as CDPSession;
  const frameIds = options.frameIds ?? ['F0'];
  return {
    url,
    title: 'Test page',
    documentId: options.documentId ?? 'doc-1',
    scrollPercent: options.scrollPercent ?? 0,
    frames: frameIds.map((frameId, ordinal) => ({ ordinal, frameId, url, session, complete: true })),
    roots,
    lines: options.lines ?? [],
    ...indexNodes(roots),
    unreadFrames: options.unreadFrames ?? 0,
  };
}
