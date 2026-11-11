import type { CDPSession } from '@aether/cdp';

export interface Point {
  x: number;
  y: number;
}

/** Thrown when the target cannot receive input; nothing was done. */
export class ActionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionBlockedError';
  }
}

function quadCentre(quad: number[]): Point | undefined {
  if (quad.length < 8) return undefined;
  const xs = [quad[0], quad[2], quad[4], quad[6]] as number[];
  const ys = [quad[1], quad[3], quad[5], quad[7]] as number[];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < 1 || height < 1) return undefined;
  return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 };
}

/** Scroll the element into view and return the centre of its first visible content quad, in its frame's viewport. */
export async function centreOf(session: CDPSession, backendNodeId: number): Promise<Point> {
  await session.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
  try {
    const { quads } = await session.send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId });
    for (const quad of quads) {
      const centre = quadCentre(quad);
      if (centre) return { x: Math.round(centre.x), y: Math.round(centre.y) };
    }
  } catch (error) {
    if (error instanceof Error && /No node|Could not find/.test(error.message)) throw error;
  }
  throw new ActionBlockedError('the element has no visible box on screen');
}

/** Describe the element the browser hits at a point. */
async function describeHit(session: CDPSession, backendNodeId: number): Promise<string> {
  try {
    const { node } = await session.send<{ node: { nodeName: string; attributes?: string[] } }>('DOM.describeNode', { backendNodeId });
    const attributes = node.attributes ?? [];
    const get = (name: string): string | undefined => {
      const index = attributes.indexOf(name);
      return index >= 0 ? attributes[index + 1] : undefined;
    };
    const id = get('id');
    const className = get('class')?.split(/\s+/)[0];
    return `<${node.nodeName.toLowerCase()}${id ? ` id=${id}` : className ? ` class=${className}` : ''}>`;
  } catch {
    return 'another element';
  }
}

const IN_OVERLAY = `function () {
  for (let n = this; n; n = n.parentNode || n.host || null) if (n.nodeType === 1 && n.hasAttribute('data-aether-overlay')) return true;
  return false;
}`;

/** Ask the Aether overlay to step aside for a moment; the extension's content script listens for this event. */
export async function yieldOverlay(session: CDPSession): Promise<void> {
  await session
    .send('Runtime.evaluate', { expression: "document.dispatchEvent(new Event('aether-overlay-yield'))" })
    .catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function isOverlay(session: CDPSession, backendNodeId: number): Promise<boolean> {
  try {
    const { object } = await session.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
    if (!object.objectId) return false;
    const result = await session.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: IN_OVERLAY, returnByValue: true });
    return result.result.value === true;
  } catch {
    return false;
  }
}

const RELATED_TO_HIT = `function (hit) {
  for (let n = hit; n; n = n.parentNode || n.host || null) if (n === this) return true;
  for (let n = this; n; n = n.parentNode || n.host || null) if (n === hit) return true;
  const label = hit.closest ? hit.closest('label') : null;
  return !!label && (label.contains(this) || (!!label.htmlFor && label.htmlFor === this.id));
}`;

/**
 * Fail unless the browser's hit test at the point lands on the target, inside
 * it (across shadow roots), on an ancestor, or on its label.
 */
export async function assertReachable(session: CDPSession, backendNodeId: number, point: Point, label: (backendId: number) => string | undefined): Promise<void> {
  const hitAt = async (): Promise<number | undefined> => {
    try {
      return (await session.send<{ backendNodeId: number }>('DOM.getNodeForLocation', { ...point, includeUserAgentShadowDOM: true })).backendNodeId;
    } catch {
      return undefined;
    }
  };
  let hit = await hitAt();
  if (hit !== undefined && hit !== backendNodeId && (await isOverlay(session, hit))) {
    await yieldOverlay(session);
    hit = await hitAt();
  }
  if (hit === undefined) return;
  if (hit === backendNodeId) return;
  try {
    const [target, other] = await Promise.all([
      session.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId }),
      session.send<{ object: { objectId?: string } }>('DOM.resolveNode', { backendNodeId: hit }),
    ]);
    if (!target.object.objectId || !other.object.objectId) return;
    const related = await session.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
      objectId: target.object.objectId,
      functionDeclaration: RELATED_TO_HIT,
      arguments: [{ objectId: other.object.objectId }],
      returnByValue: true,
    });
    if (related.result.value) return;
  } catch {
    return;
  }
  const blocker = label(hit) ?? (await describeHit(session, hit));
  throw new ActionBlockedError(`covered by ${blocker} at (${point.x}, ${point.y}); deal with it first`);
}
