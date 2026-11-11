import type { Visibility } from '../types.js';
import type { Box } from './snapshot.js';

/** Visible region of a frame, in that frame's document coordinates. */
export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function classify(box: Box, viewport: Viewport): Visibility {
  if (box.y + box.height <= viewport.top) return 'above';
  if (box.y >= viewport.top + viewport.height) return 'below';
  if (box.x + box.width <= viewport.left || box.x >= viewport.left + viewport.width) return 'offscreen';
  return 'in';
}

/** True when the centre of the box is inside the viewport, so a hit test there is meaningful. */
export function centreInside(box: Box, viewport: Viewport): boolean {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return x >= viewport.left && x < viewport.left + viewport.width && y >= viewport.top && y < viewport.top + viewport.height;
}

export function scrollPercent(scrollY: number, contentHeight: number, viewportHeight: number): number {
  const range = contentHeight - viewportHeight;
  if (range <= 1) return 0;
  return Math.max(0, Math.min(100, Math.round((scrollY / range) * 100)));
}
