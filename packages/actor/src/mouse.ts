import type { CDPSession } from '@aether/cdp';
import type { Point } from './geometry.js';

export async function moveTo(session: CDPSession, point: Point): Promise<void> {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
}

/** A trusted left click: move, press, release. */
export async function clickAt(session: CDPSession, point: Point): Promise<void> {
  await moveTo(session, point);
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
}

/** A trusted wheel event at a point; positive delta scrolls down. */
export async function wheelAt(session: CDPSession, point: Point, deltaY: number): Promise<void> {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY });
}
