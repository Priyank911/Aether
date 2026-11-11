import type { CDPSession } from '@aether/cdp';

export type NodeState =
  | 'focused'
  | 'disabled'
  | 'checked'
  | 'mixed'
  | 'expanded'
  | 'collapsed'
  | 'selected'
  | 'required'
  | 'invalid'
  | 'covered';

/** Where a node sits relative to the viewport of the agent tab. */
export type Visibility = 'in' | 'above' | 'below' | 'offscreen';

/** A kept accessibility node: interactive, heading, landmark, table part, list, status, or frame. */
export interface PageNode {
  /** Absent only for table cells and the synthetic frame node. */
  ref?: string;
  backendDOMNodeId: number;
  frameOrdinal: number;
  role: string;
  name: string;
  value?: string;
  level?: number;
  states: NodeState[];
  visibility: Visibility;
  /** A dialog that declares itself modal. */
  modal: boolean;
  /** Value was replaced by the mask because the field holds a secret. */
  sensitive: boolean;
  /** A field for personal details: name, email, phone, address, birthday. */
  identity: boolean;
  /** Absolute target of a link. */
  href?: string;
  children: PageNode[];
}

/** One line of page text, for the text view, find, and text deltas. */
export interface TextLine {
  /** Text without refs; used for deltas and search. */
  plain: string;
  /** Text with refs on links and controls; used for the text view. */
  linked: string;
  /** Refs of kept ancestors, outermost first. */
  path: readonly string[];
  visibility: Visibility;
}

export interface FrameView {
  ordinal: number;
  frameId: string;
  url: string;
  session: CDPSession;
  /** False when the frame's tree could not be read. */
  complete: boolean;
}

export interface PageModel {
  url: string;
  title: string;
  /** Loader id of the main frame. A new value means a new document. */
  documentId: string;
  scrollPercent: number;
  frames: FrameView[];
  roots: PageNode[];
  lines: TextLine[];
  byRef: ReadonlyMap<string, PageNode>;
  /** Refs in document order. */
  order: readonly string[];
  /** Nearest landmark ancestor ref for each ref that has one. */
  scopeOf: ReadonlyMap<string, string>;
  /** Child frames whose tree could not be read. */
  unreadFrames: number;
}

/** Text for the model, its token estimate, and warnings that belong outside the untrusted wrapper. */
export interface RenderResult {
  text: string;
  tokens: number;
  warnings: string[];
}
