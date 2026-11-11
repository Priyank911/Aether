/** Computed styles requested from DOMSnapshot.captureSnapshot, in this order. */
export const SNAPSHOT_STYLES = ['display', 'pointer-events', 'visibility'] as const;

const TEXT_NODE = 3;
const DISPLAY = 0;
const POINTER_EVENTS = 1;
const VISIBILITY = 2;

/** Attribute that marks the Aether overlay host; its subtree never counts as covering the page. */
export const OVERLAY_ATTRIBUTE = 'data-aether-overlay';

interface RareIntegerData {
  index: number[];
  value: number[];
}

export interface RawSnapshotDocument {
  frameId: number;
  title: number;
  nodes: {
    parentIndex?: number[];
    nodeType?: number[];
    nodeName?: number[];
    backendNodeId?: number[];
    attributes?: number[][];
    contentDocumentIndex?: RareIntegerData;
  };
  layout: {
    nodeIndex: number[];
    styles: number[][];
    bounds: number[][];
    paintOrders?: number[];
  };
  scrollOffsetX?: number;
  scrollOffsetY?: number;
  contentWidth?: number;
  contentHeight?: number;
}

export interface RawSnapshot {
  documents: RawSnapshotDocument[];
  strings: string[];
}

/** Document coordinates in CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HitCandidate {
  nodeIndex: number;
  x: number;
  y: number;
  right: number;
  bottom: number;
  paint: number;
}

/** Lookups over one document of a DOMSnapshot capture. */
export class DocumentIndex {
  public readonly frameId: string;
  public readonly scrollX: number;
  public readonly scrollY: number;
  public readonly contentHeight: number;
  private readonly doc: RawSnapshotDocument;
  private readonly strings: string[];
  private readonly nodeByBackend = new Map<number, number>();
  private readonly layoutByNode = new Map<number, number>();
  private hitCandidates?: HitCandidate[];
  private overlayNodes?: Uint8Array;

  constructor(doc: RawSnapshotDocument, strings: string[]) {
    this.doc = doc;
    this.strings = strings;
    this.frameId = strings[doc.frameId] ?? '';
    this.scrollX = doc.scrollOffsetX ?? 0;
    this.scrollY = doc.scrollOffsetY ?? 0;
    this.contentHeight = doc.contentHeight ?? 0;
    const backendIds = doc.nodes.backendNodeId ?? [];
    for (let index = 0; index < backendIds.length; index++) {
      const backendId = backendIds[index];
      if (backendId !== undefined) this.nodeByBackend.set(backendId, index);
    }
    doc.layout.nodeIndex.forEach((nodeIndex, layoutIndex) => {
      if (!this.layoutByNode.has(nodeIndex)) this.layoutByNode.set(nodeIndex, layoutIndex);
    });
  }

  public nodeIndex(backendId: number): number | undefined {
    return this.nodeByBackend.get(backendId);
  }

  /** Layout box of a node, or undefined when it has no layout or no area. */
  public box(nodeIndex: number): Box | undefined {
    const layoutIndex = this.layoutByNode.get(nodeIndex);
    if (layoutIndex === undefined) return undefined;
    const bounds = this.doc.layout.bounds[layoutIndex];
    if (!bounds || bounds.length < 4) return undefined;
    const [x = 0, y = 0, width = 0, height = 0] = bounds;
    if (width <= 0 || height <= 0) return undefined;
    return { x, y, width, height };
  }

  public display(nodeIndex: number): string | undefined {
    return this.style(nodeIndex, DISPLAY);
  }

  public attributes(nodeIndex: number): Map<string, string> {
    const pairs = this.doc.nodes.attributes?.[nodeIndex] ?? [];
    const attributes = new Map<string, string>();
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const key = this.strings[pairs[index] ?? -1];
      const value = this.strings[pairs[index + 1] ?? -1];
      if (key !== undefined) attributes.set(key.toLowerCase(), value ?? '');
    }
    return attributes;
  }

  /**
   * True when a hit-testable node painted in a later layer than the target sits
   * over the box centre and is unrelated to it: not the target, not inside it,
   * not an ancestor, and not part of the same label.
   *
   * Paint orders are per paint layer, so nodes in the same stacking context
   * share a value; only a strictly higher value means the node is on top.
   */
  public isCovered(nodeIndex: number, box: Box): boolean {
    const layoutIndex = this.layoutByNode.get(nodeIndex);
    const targetPaint = layoutIndex === undefined ? undefined : this.doc.layout.paintOrders?.[layoutIndex];
    if (targetPaint === undefined) return false;
    const top = this.topmostAt(box.x + box.width / 2, box.y + box.height / 2, targetPaint);
    return top !== undefined && !this.isRelated(nodeIndex, top);
  }

  /**
   * True when a click landing on `hit` reaches `target`: the same node, a
   * descendant or ancestor of it, or part of the same label.
   */
  public isRelated(target: number, hit: number): boolean {
    if (hit === target) return true;
    if (this.isAncestor(target, hit) || this.isAncestor(hit, target)) return true;
    const hitLabel = this.enclosingLabel(hit);
    if (hitLabel === undefined) return false;
    if (hitLabel === this.enclosingLabel(target)) return true;
    const forId = this.attributes(hitLabel).get('for');
    return Boolean(forId && forId === this.attributes(target).get('id'));
  }

  private style(nodeIndex: number, slot: number): string | undefined {
    const layoutIndex = this.layoutByNode.get(nodeIndex);
    if (layoutIndex === undefined) return undefined;
    const stringIndex = this.doc.layout.styles[layoutIndex]?.[slot];
    return stringIndex === undefined || stringIndex < 0 ? undefined : this.strings[stringIndex];
  }

  private parent(nodeIndex: number): number {
    return this.doc.nodes.parentIndex?.[nodeIndex] ?? -1;
  }

  private nodeName(nodeIndex: number): string {
    return this.strings[this.doc.nodes.nodeName?.[nodeIndex] ?? -1] ?? '';
  }

  private isAncestor(ancestor: number, nodeIndex: number): boolean {
    let current = this.parent(nodeIndex);
    while (current >= 0) {
      if (current === ancestor) return true;
      current = this.parent(current);
    }
    return false;
  }

  private enclosingLabel(nodeIndex: number): number | undefined {
    let current = nodeIndex;
    while (current >= 0) {
      if (this.nodeName(current) === 'LABEL') return current;
      current = this.parent(current);
    }
    return undefined;
  }

  private isOverlay(nodeIndex: number): boolean {
    if (!this.overlayNodes) {
      const count = this.doc.nodes.parentIndex?.length ?? 0;
      const marks = new Uint8Array(count);
      for (let index = 0; index < count; index++) {
        const parent = this.parent(index);
        if ((parent >= 0 && marks[parent] === 1) || this.attributes(index).has(OVERLAY_ATTRIBUTE)) marks[index] = 1;
      }
      this.overlayNodes = marks;
    }
    return this.overlayNodes[nodeIndex] === 1;
  }

  /** The node in the highest paint layer above `abovePaint` that contains the point. */
  private topmostAt(x: number, y: number, abovePaint: number): number | undefined {
    if (!this.hitCandidates) this.hitCandidates = this.buildHitCandidates();
    let best: HitCandidate | undefined;
    for (const candidate of this.hitCandidates) {
      if (candidate.paint <= abovePaint) continue;
      if (x < candidate.x || x >= candidate.right || y < candidate.y || y >= candidate.bottom) continue;
      if (!best || candidate.paint > best.paint) best = candidate;
    }
    return best?.nodeIndex;
  }

  private buildHitCandidates(): HitCandidate[] {
    const { layout } = this.doc;
    const candidates: HitCandidate[] = [];
    const paintOrders = layout.paintOrders ?? [];
    layout.nodeIndex.forEach((nodeIndex, layoutIndex) => {
      const paint = paintOrders[layoutIndex];
      const bounds = layout.bounds[layoutIndex];
      if (paint === undefined || !bounds) return;
      const [x = 0, y = 0, width = 0, height = 0] = bounds;
      if (width <= 0 || height <= 0) return;
      const styles = layout.styles[layoutIndex] ?? [];
      if (this.strings[styles[POINTER_EVENTS] ?? -1] === 'none') return;
      if (this.strings[styles[VISIBILITY] ?? -1] === 'hidden') return;
      if (this.isOverlay(nodeIndex)) return;
      // Text is hit-tested through its element; a text box can outlive a clip the snapshot does not report.
      if (this.doc.nodes.nodeType?.[nodeIndex] === TEXT_NODE) return;
      candidates.push({ nodeIndex, x, y, right: x + width, bottom: y + height, paint });
    });
    return candidates;
  }
}

/** Index every document of a capture by its frame id. */
export function indexSnapshot(snapshot: RawSnapshot): Map<string, DocumentIndex> {
  const byFrame = new Map<string, DocumentIndex>();
  for (const doc of snapshot.documents) {
    const index = new DocumentIndex(doc, snapshot.strings);
    if (index.frameId) byFrame.set(index.frameId, index);
  }
  return byFrame;
}
