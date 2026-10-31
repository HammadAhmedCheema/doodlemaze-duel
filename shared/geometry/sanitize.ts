import { BORDER_INSET, CANVAS, GAP_SNAP, MIN_STROKE_LEN, RDP_EPSILON } from '../constants';
import type { Pt, Seg, Stroke } from '../types';
import { closestOnSeg } from './math';
import { rdp } from './rdp';

export function borderSegments(): Seg[] {
  const a = BORDER_INSET;
  const b = CANVAS - BORDER_INSET;
  return [
    { x1: a, y1: a, x2: b, y2: a },
    { x1: b, y1: a, x2: b, y2: b },
    { x1: b, y1: b, x2: a, y2: b },
    { x1: a, y1: b, x2: a, y2: a },
  ];
}

const clamp = (v: number) => (v < 0 ? 0 : v > CANVAS ? CANVAS : v);

function polyLen(p: Pt[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return L;
}

/** Clean, simplify and drop tiny strokes. Exported for the "show cleaned walls" overlay. */
export function cleanStrokes(strokes: Stroke[]): Pt[][] {
  const out: Pt[][] = [];
  for (const s of strokes) {
    const pts: Pt[] = [];
    for (const p of s) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const q = { x: clamp(p.x), y: clamp(p.y) };
      const last = pts[pts.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
    }
    if (pts.length < 2) continue;
    const simp = rdp(pts, RDP_EPSILON);
    if (simp.length < 2 || polyLen(simp) < MIN_STROKE_LEN) continue;
    out.push(simp);
  }
  return out;
}

/**
 * Turn freehand strokes into clean wall segments:
 * dedupe + clamp, RDP simplify, drop short strokes, snap dangling endpoints
 * onto nearby walls (closing small gaps), then add the outer border.
 */
export function sanitize(strokes: Stroke[]): Seg[] {
  const polys = cleanStrokes(strokes).map((p) => p.map((q) => ({ x: q.x, y: q.y })));
  const border = borderSegments();
  const ownSkip = GAP_SNAP * 3;

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let si = 0; si < polys.length; si++) {
      const poly = polys[si];
      for (const end of [0, poly.length - 1] as const) {
        const p = poly[end];
        let best: { x: number; y: number; d2: number } | null = null;
        const consider = (s: Seg) => {
          const c = closestOnSeg(p.x, p.y, s);
          if (c.d2 < GAP_SNAP * GAP_SNAP && (!best || c.d2 < best.d2)) best = c;
        };
        border.forEach(consider);
        for (let sj = 0; sj < polys.length; sj++) {
          const other = polys[sj];
          if (sj !== si) {
            for (let k = 1; k < other.length; k++)
              consider({ x1: other[k - 1].x, y1: other[k - 1].y, x2: other[k].x, y2: other[k].y });
          } else {
            // own stroke: skip segments within a short arc length of this endpoint
            let arc = 0;
            const n = other.length;
            for (let k = 1; k < n; k++) {
              const idx = end === 0 ? k : n - k; // walk away from the endpoint
              const a = other[end === 0 ? idx - 1 : idx];
              const b = other[end === 0 ? idx : idx - 1];
              const segArcStart = arc;
              arc += Math.hypot(b.x - a.x, b.y - a.y);
              if (segArcStart < ownSkip) continue;
              consider({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
            }
          }
        }
        const b = best as { x: number; y: number; d2: number } | null;
        if (b && b.d2 > 1e-9) {
          p.x = b.x;
          p.y = b.y;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const segs: Seg[] = [];
  for (const poly of polys) {
    for (let k = 1; k < poly.length; k++) {
      const a = poly[k - 1];
      const b = poly[k];
      if (a.x === b.x && a.y === b.y) continue;
      segs.push({ x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) });
    }
  }
  return segs.concat(border);
}

const round = (v: number) => Math.round(v * 100) / 100;

export function isBorderSeg(s: Seg): boolean {
  return borderSegments().some((b) => b.x1 === s.x1 && b.y1 === s.y1 && b.x2 === s.x2 && b.y2 === s.y2);
}
