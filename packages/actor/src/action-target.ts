import type { CDPSession } from '@aether/cdp';
import type { FrameView } from '@aether/perceiver';
import type { Point } from './geometry.js';

interface FrameTree { frame: { id: string }; childFrames?: FrameTree[] }

/** Project out-of-process frame coordinates for shell-only feedback, never for input. */
export async function actionTargetPoint(root: CDPSession, frame: FrameView | undefined, frames: readonly FrameView[], point: Point): Promise<Point | undefined> {
  if (!frame) return undefined;
  if (frame.session === root) return point;
  try {
    const { frameTree } = await root.send<{ frameTree: FrameTree }>('Page.getFrameTree');
    const parents = new Map<string, string>();
    const visit = (tree: FrameTree) => { for (const child of tree.childFrames ?? []) { parents.set(child.frame.id, tree.frame.id); visit(child); } };
    visit(frameTree);
    let current = frame;
    let projected = { ...point };
    const seen = new Set<string>();
    while (current.session !== root) {
      if (seen.has(current.frameId)) return undefined;
      seen.add(current.frameId);
      const parentId = parents.get(current.frameId);
      const parent = frames.find((candidate) => candidate.frameId === parentId);
      if (!parent) return undefined;
      if (parent.session !== current.session) {
        const owner = await parent.session.send<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: current.frameId });
        const { model } = await parent.session.send<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId: owner.backendNodeId });
        const [x, y] = model.content;
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
        projected = { x: projected.x + x, y: projected.y + y };
      }
      current = parent;
    }
    return projected;
  } catch { return undefined; }
}
