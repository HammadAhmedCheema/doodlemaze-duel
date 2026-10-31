import type { Pt, Seg } from '../types';

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closest point on segment (ax,ay)-(bx,by) to (px,py), plus squared distance. */
export function closestOnSeg(px: number, py: number, s: Seg): { x: number; y: number; d2: number; t: number } {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - s.x1) * dx + (py - s.y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = s.x1 + t * dx;
  const y = s.y1 + t * dy;
  const ex = px - x;
  const ey = py - y;
  return { x, y, d2: ex * ex + ey * ey, t };
}

export function distToSeg(px: number, py: number, s: Seg): number {
  return Math.sqrt(closestOnSeg(px, py, s).d2);
}

export function segLen(s: Seg): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}
