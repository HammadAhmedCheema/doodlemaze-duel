import type { Pt } from '../types';
import { closestOnSeg } from './math';

/** Ramer-Douglas-Peucker polyline simplification (iterative, no recursion limits). */
export function rdp(points: Pt[], epsilon: number): Pt[] {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const eps2 = epsilon * epsilon;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const seg = { x1: points[a].x, y1: points[a].y, x2: points[b].x, y2: points[b].y };
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = closestOnSeg(points[i].x, points[i].y, seg).d2;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}
