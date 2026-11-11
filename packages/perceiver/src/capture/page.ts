import type { CDPSession } from '@aether/cdp';
import { extractFrame, type FrameOutput } from '../extract.js';
import type { RefRegistry } from '../registry.js';
import { FRAME_ROLE, isScope } from '../roles.js';
import type { FrameView, PageModel, PageNode, Visibility } from '../types.js';
import type { RawAXNode } from './ax.js';
import { confirmCovered } from './confirm-covered.js';
import { discoverFrames, type FrameTarget } from './frames.js';
import { indexSnapshot, SNAPSHOT_STYLES, type DocumentIndex, type RawSnapshot } from './snapshot.js';
import { classify, scrollPercent, type Viewport } from './viewport.js';

/** Per-tab state that survives between captures of the same document. */
export interface CaptureState {
  registry: RefRegistry;
  ordinals: Map<string, number>;
  nextOrdinal: number;
  documentId?: string;
}

interface LayoutMetrics {
  cssLayoutViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number };
  cssContentSize?: { height: number };
}

interface FrameGeometry {
  viewport?: Viewport;
  visibility: Visibility;
}

const preparedSessions = new WeakSet<CDPSession>();

async function prepare(session: CDPSession): Promise<void> {
  if (preparedSessions.has(session)) return;
  preparedSessions.add(session);
  await Promise.all([
    session.send('DOM.enable').catch(() => undefined),
    session.send('Accessibility.enable').catch(() => undefined),
  ]);
}

async function readTree(target: FrameTarget): Promise<RawAXNode[] | undefined> {
  const params = target.sessionRoot ? undefined : { frameId: target.frameId };
  try {
    const result = await target.session.send<{ nodes: RawAXNode[] }>('Accessibility.getFullAXTree', params);
    return result.nodes ?? [];
  } catch {
    return undefined;
  }
}

async function readSnapshot(session: CDPSession): Promise<Map<string, DocumentIndex>> {
  try {
    const snapshot = await session.send<RawSnapshot>('DOMSnapshot.captureSnapshot', {
      computedStyles: [...SNAPSHOT_STYLES],
      includePaintOrder: true,
      includeDOMRects: false,
    });
    return indexSnapshot(snapshot);
  } catch {
    return new Map();
  }
}

async function readOwner(target: FrameTarget, parent: FrameTarget | undefined): Promise<number | undefined> {
  const session = parent?.session ?? target.session;
  try {
    const owner = await session.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: target.frameId });
    return owner.backendNodeId;
  } catch {
    return undefined;
  }
}

function frameNode(target: FrameTarget, ordinal: number, ownerBackendId: number, visibility: Visibility, roots: PageNode[]): PageNode {
  return {
    backendDOMNodeId: ownerBackendId,
    frameOrdinal: ordinal,
    role: FRAME_ROLE,
    name: target.url,
    states: [],
    visibility,
    modal: false,
    sensitive: false,
    identity: false,
    children: roots,
  };
}

/** Ref lookups for a kept-node tree: by ref, in document order, and the nearest landmark of each. */
export function indexNodes(roots: PageNode[]): Pick<PageModel, 'byRef' | 'order' | 'scopeOf'> {
  const byRef = new Map<string, PageNode>();
  const order: string[] = [];
  const scopeOf = new Map<string, string>();
  const walk = (node: PageNode, scope: string | undefined): void => {
    if (node.ref) {
      byRef.set(node.ref, node);
      order.push(node.ref);
      if (scope) scopeOf.set(node.ref, scope);
    }
    const next = isScope(node.role) && node.ref ? node.ref : scope;
    for (const child of node.children) walk(child, next);
  };
  for (const root of roots) walk(root, undefined);
  return { byRef, order, scopeOf };
}

/** Capture the page reachable from the main session: every frame's tree, joined with layout. */
export async function capturePage(main: CDPSession, state: CaptureState): Promise<PageModel> {
  const targets = await discoverFrames(main);
  const mainTarget = targets[0];
  if (!mainTarget) throw new Error('The page has no main frame');

  if (state.documentId !== mainTarget.loaderId) {
    state.registry.resetMappings();
    state.ordinals.clear();
    state.nextOrdinal = 1;
    state.documentId = mainTarget.loaderId;
  }
  state.ordinals.set(mainTarget.frameId, 0);
  for (const target of targets.slice(1)) {
    if (!state.ordinals.has(target.frameId)) state.ordinals.set(target.frameId, state.nextOrdinal++);
  }
  const ordinalOf = (target: FrameTarget): number => state.ordinals.get(target.frameId) ?? 0;
  const byFrameId = new Map(targets.map((target) => [target.frameId, target]));

  const sessions = [...new Set(targets.map((target) => target.session))];
  await Promise.all(sessions.filter((session) => session !== main).map(prepare));

  const [metrics, snapshots, trees, owners] = await Promise.all([
    main.send<LayoutMetrics>('Page.getLayoutMetrics'),
    Promise.all(sessions.map(async (session) => [session, await readSnapshot(session)] as const)).then((pairs) => new Map(pairs)),
    Promise.all(targets.map(async (target) => [target.frameId, await readTree(target)] as const)).then((pairs) => new Map(pairs)),
    Promise.all(
      targets.slice(1).map(async (target) => {
        const parent = target.parentFrameId ? byFrameId.get(target.parentFrameId) : undefined;
        return [target.frameId, await readOwner(target, parent)] as const;
      }),
    ).then((pairs) => new Map(pairs)),
  ]);

  const docOf = (target: FrameTarget): DocumentIndex | undefined => snapshots.get(target.session)?.get(target.frameId);
  const layout = metrics.cssLayoutViewport;
  const mainDoc = docOf(mainTarget);

  const geometry = new Map<string, FrameGeometry>();
  geometry.set(mainTarget.frameId, {
    visibility: 'in',
    viewport: {
      left: mainDoc?.scrollX ?? layout.pageX,
      top: mainDoc?.scrollY ?? layout.pageY,
      width: layout.clientWidth,
      height: layout.clientHeight,
    },
  });
  const geometryOf = (target: FrameTarget): FrameGeometry => {
    const known = geometry.get(target.frameId);
    if (known) return known;
    const parent = target.parentFrameId ? byFrameId.get(target.parentFrameId) : undefined;
    const parentGeometry = parent ? geometryOf(parent) : undefined;
    const parentDoc = parent ? docOf(parent) : undefined;
    const ownerId = owners.get(target.frameId);
    const ownerIndex = ownerId !== undefined ? parentDoc?.nodeIndex(ownerId) : undefined;
    const ownerBox = ownerIndex !== undefined ? parentDoc?.box(ownerIndex) : undefined;
    let visibility: Visibility = 'in';
    if (parentGeometry && parentGeometry.visibility !== 'in') visibility = parentGeometry.visibility;
    else if (ownerBox && parentGeometry?.viewport) visibility = classify(ownerBox, parentGeometry.viewport);
    const doc = docOf(target);
    const result: FrameGeometry = {
      visibility,
      viewport: ownerBox && doc ? { left: doc.scrollX, top: doc.scrollY, width: ownerBox.width, height: ownerBox.height } : undefined,
    };
    geometry.set(target.frameId, result);
    return result;
  };

  const embedded = new Set<string>([mainTarget.frameId]);
  const extract = (target: FrameTarget): FrameOutput => {
    const frameGeometry = geometryOf(target);
    return extractFrame(
      {
        ordinal: ordinalOf(target),
        nodes: trees.get(target.frameId) ?? [],
        doc: docOf(target),
        viewport: frameGeometry.viewport,
        frameVisibility: frameGeometry.visibility,
        baseUrl: target.url,
        embed: (ownerBackendId) => {
          const child = targets.find(
            (candidate) =>
              candidate.parentFrameId === target.frameId &&
              owners.get(candidate.frameId) === ownerBackendId &&
              !embedded.has(candidate.frameId),
          );
          if (!child) return undefined;
          embedded.add(child.frameId);
          const output = extract(child);
          return {
            node: frameNode(child, ordinalOf(child), ownerBackendId, geometryOf(child).visibility, output.roots),
            lines: output.lines,
          };
        },
      },
      state.registry,
    );
  };

  const mainOutput = extract(mainTarget);
  const roots = mainOutput.roots;
  const lines = mainOutput.lines;
  for (const target of targets) {
    if (embedded.has(target.frameId)) continue;
    embedded.add(target.frameId);
    const output = extract(target);
    roots.push(frameNode(target, ordinalOf(target), -ordinalOf(target), geometryOf(target).visibility, output.roots));
    lines.push(...output.lines);
  }

  await confirmCovered(roots, main, mainDoc, 0);

  const frames: FrameView[] = targets
    .map((target) => ({
      ordinal: ordinalOf(target),
      frameId: target.frameId,
      url: target.url,
      session: target.session,
      complete: trees.get(target.frameId) !== undefined,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);

  const viewportHeight = layout.clientHeight;
  const contentHeight = mainDoc?.contentHeight || metrics.cssContentSize?.height || viewportHeight;
  const scrollY = mainDoc?.scrollY ?? layout.pageY;

  return {
    url: mainTarget.url,
    title: mainOutput.title,
    documentId: mainTarget.loaderId,
    scrollPercent: scrollPercent(scrollY, contentHeight, viewportHeight),
    frames,
    roots,
    lines,
    ...indexNodes(roots),
    unreadFrames: frames.filter((frame) => frame.ordinal > 0 && !frame.complete).length,
  };
}
