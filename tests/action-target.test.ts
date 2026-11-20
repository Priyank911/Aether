import { describe, expect, it, vi } from 'vitest';
import type { CDPSession } from '@aether/cdp';
import type { FrameView } from '@aether/perceiver';
import { actionTargetPoint } from '../packages/actor/src/action-target.js';

function session(send: (method: string) => unknown): CDPSession {
  // This visual-coordinate unit test only exercises the session's send contract.
  return { send: vi.fn(async (method: string) => send(method)) } as unknown as CDPSession;
}
const frame = (ordinal: number, frameId: string, value: CDPSession): FrameView => ({ ordinal, frameId, session: value, url: 'https://fixture.test', complete: true });

describe('shell action target projection', () => {
  it('keeps root-session coordinates unchanged without extra CDP calls', async () => {
    const root = session(() => { throw new Error('Unexpected CDP'); });
    expect(await actionTargetPoint(root, frame(0, 'root', root), [], { x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });
  it('projects nested out-of-process targets through their iframe content origins', async () => {
    const root = session((method) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'root' }, childFrames: [{ frame: { id: 'child' }, childFrames: [{ frame: { id: 'nested' } }] }] } } : method === 'DOM.getFrameOwner' ? { backendNodeId: 1 } : { model: { content: [100, 200] } });
    const child = session((method) => method === 'DOM.getFrameOwner' ? { backendNodeId: 2 } : { model: { content: [30, 40] } });
    const nested = session(() => undefined);
    const frames = [frame(0, 'root', root), frame(1, 'child', child), frame(2, 'nested', nested)];
    expect(await actionTargetPoint(root, frames[2], frames, { x: 5, y: 6 })).toEqual({ x: 135, y: 246 });
  });
  it('clears feedback rather than guessing when a frame detaches', async () => {
    const root = session(() => { throw new Error('Detached'); });
    const child = frame(1, 'child', session(() => undefined));
    expect(await actionTargetPoint(root, child, [child], { x: 1, y: 2 })).toBeUndefined();
  });
});
