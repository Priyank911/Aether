import type { CDPSession } from '@aether/cdp';

interface RawFrame {
  id: string;
  parentId?: string;
  loaderId: string;
  url: string;
  urlFragment?: string;
}

interface RawFrameTree {
  frame: RawFrame;
  childFrames?: RawFrameTree[];
}

export interface FrameTarget {
  frameId: string;
  parentFrameId?: string;
  loaderId: string;
  url: string;
  /** Session whose renderer owns this frame. */
  session: CDPSession;
  /** True when this frame is the root frame of its session. */
  sessionRoot: boolean;
}

/**
 * List the frames of a page: the main session's frame tree depth first, then
 * each out-of-process frame session below it. A frame reported by both keeps
 * its first position and takes the session that owns it.
 */
export async function discoverFrames(main: CDPSession): Promise<FrameTarget[]> {
  const frames = new Map<string, FrameTarget>();

  const walk = (tree: RawFrameTree, session: CDPSession, isRoot: boolean): void => {
    const { frame } = tree;
    const existing = frames.get(frame.id);
    const entry: FrameTarget = {
      frameId: frame.id,
      parentFrameId: frame.parentId ?? existing?.parentFrameId,
      loaderId: frame.loaderId,
      url: `${frame.url}${frame.urlFragment ?? ''}`,
      session,
      sessionRoot: isRoot,
    };
    frames.set(frame.id, entry);
    for (const child of tree.childFrames ?? []) walk(child, session, false);
  };

  const mainTree = await main.send<{ frameTree: RawFrameTree }>('Page.getFrameTree');
  walk(mainTree.frameTree, main, true);

  for (const child of main.descendants()) {
    if (child.targetType !== 'iframe') continue;
    try {
      const tree = await child.send<{ frameTree: RawFrameTree }>('Page.getFrameTree');
      walk(tree.frameTree, child, true);
    } catch {
      // The frame is navigating or gone; it is reported as unread by the caller if still listed.
    }
  }

  return [...frames.values()];
}
