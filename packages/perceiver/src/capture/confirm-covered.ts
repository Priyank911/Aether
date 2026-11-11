import type { CDPSession } from '@aether/cdp';
import type { PageNode } from '../types.js';
import type { DocumentIndex } from './snapshot.js';

/** Hit tests per capture; past this many, the paint-order result stands. */
const MAX_CONFIRMATIONS = 40;

function collectCovered(roots: PageNode[], ordinal: number): PageNode[] {
  const found: PageNode[] = [];
  const visit = (node: PageNode): void => {
    if (node.frameOrdinal === ordinal && node.states.includes('covered')) found.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return found;
}

/**
 * The paint-order check cannot see clipping, so confirm each element it marked
 * as covered with the browser's own hit test at the element centre, and clear
 * the mark when the hit lands on the element or something that forwards to it.
 */
export async function confirmCovered(roots: PageNode[], session: CDPSession, doc: DocumentIndex | undefined, ordinal: number): Promise<void> {
  if (!doc) return;
  const covered = collectCovered(roots, ordinal).slice(0, MAX_CONFIRMATIONS);
  await Promise.all(
    covered.map(async (node) => {
      const nodeIndex = doc.nodeIndex(node.backendDOMNodeId);
      const box = nodeIndex !== undefined ? doc.box(nodeIndex) : undefined;
      if (nodeIndex === undefined || !box) return;
      try {
        const hit = await session.send<{ backendNodeId: number }>('DOM.getNodeForLocation', {
          x: Math.round(box.x - doc.scrollX + box.width / 2),
          y: Math.round(box.y - doc.scrollY + box.height / 2),
          includeUserAgentShadowDOM: true,
        });
        const hitIndex = doc.nodeIndex(hit.backendNodeId);
        if (hitIndex !== undefined && doc.isRelated(nodeIndex, hitIndex)) {
          node.states = node.states.filter((state) => state !== 'covered');
        }
      } catch {
        // Keep the paint-order result when the browser cannot hit test the point.
      }
    }),
  );
}
