import { CANVAS, WALL_THICKNESS } from '../../shared/constants';
import { cleanStrokes } from '../../shared/geometry';
import type { Pt, Stroke } from '../../shared/types';

export const IMG = 768;

/** Load an image file onto a white square canvas (contain-fit), so photo pixels map 1:1 onto the 1000x1000 maze square. */
export async function loadSquare(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file is not an image the browser can read.'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = c.height = IMG;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, IMG, IMG);
    const k = Math.min(IMG / img.width, IMG / img.height);
    const w = img.width * k, h = img.height * k;
    ctx.drawImage(img, (IMG - w) / 2, (IMG - h) / 2, w, h);
    return cropToContent(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Zoom onto the drawn part of the picture (bounding box of dark pixels + a small margin), so the maze fills the square. */
function cropToContent(c: HTMLCanvasElement): HTMLCanvasElement {
  const { data } = c.getContext('2d')!.getImageData(0, 0, IMG, IMG);
  const rows = new Uint16Array(IMG), cols = new Uint16Array(IMG);
  for (let y = 0; y < IMG; y++)
    for (let x = 0; x < IMG; x++) {
      const i = (y * IMG + x) * 4;
      if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 110) { rows[y]++; cols[x]++; }
    }
  const first = (a: Uint16Array) => a.findIndex((v) => v >= 3);
  const last = (a: Uint16Array) => IMG - 1 - [...a].reverse().findIndex((v) => v >= 3);
  const y0 = first(rows), y1 = last(rows), x0 = first(cols), x1 = last(cols);
  if (y0 < 0 || x0 < 0 || x1 - x0 < 60 || y1 - y0 < 60) return c;
  const side = Math.max(x1 - x0, y1 - y0) * 1.03;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = document.createElement('canvas');
  out.width = out.height = IMG;
  const o = out.getContext('2d')!;
  o.fillStyle = '#fff';
  o.fillRect(0, 0, IMG, IMG);
  o.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, IMG, IMG);
  return out;
}

/**
 * Built-in tracer (no AI): threshold the picture, then turn long horizontal and vertical runs of dark
 * cells into wall segments. Works well on grid-style mazes; green/red blobs become Start/Goal.
 */
export function traceWalls(c: HTMLCanvasElement): { strokes: Stroke[]; start: Pt | null; goal: Pt | null } {
  const ctx = c.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, IMG, IMG);
  const N = 125; // cells per side, 8 maze units each
  const px = IMG / N;
  // Otsu threshold on luminance
  const hist = new Array(256).fill(0);
  const lum = new Uint8Array(IMG * IMG);
  let gx = 0, gy = 0, gn = 0, rx = 0, ry = 0, rn = 0;
  for (let i = 0; i < IMG * IMG; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = (r * 299 + g * 587 + b * 114) / 1000;
    if (g > r + 50 && g > b + 30) { gx += i % IMG; gy += (i / IMG) | 0; gn++; lum[i] = 255; continue; }
    if (r > g + 70 && r > b + 50) { rx += i % IMG; ry += (i / IMG) | 0; rn++; lum[i] = 255; continue; }
    lum[i] = l;
    hist[l | 0]++;
  }
  let sum = 0, total = 0;
  for (let t = 0; t < 256; t++) { sum += t * hist[t]; total += hist[t]; }
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  const dark = new Uint8Array(N * N);
  for (let cy = 0; cy < N; cy++)
    for (let cx = 0; cx < N; cx++) {
      let n = 0, d = 0;
      for (let y = Math.floor(cy * px); y < Math.floor((cy + 1) * px); y++)
        for (let x = Math.floor(cx * px); x < Math.floor((cx + 1) * px); x++) { n++; if (lum[y * IMG + x] < thr) d++; }
      dark[cy * N + cx] = d / n > 0.3 ? 1 : 0;
    }
  const U = CANVAS / N;
  const strokes: Stroke[] = [];
  const MIN = 4;
  const runs = (horizontal: boolean) => {
    for (let a = 0; a < N; a++) {
      let b = 0;
      while (b < N) {
        const at = (i: number, j: number) => (horizontal ? dark[i * N + j] : dark[j * N + i]);
        if (!at(a, b)) { b++; continue; }
        const s = b;
        while (b < N && at(a, b)) b++;
        if (b - s < MIN) continue;
        // skip if the previous row/column already covers most of this run (thick lines)
        if (a > 0) {
          let cov = 0;
          for (let k = s; k < b; k++) cov += at(a - 1, k);
          if (cov / (b - s) > 0.6) continue;
        }
        const fixed = (a + 0.5) * U;
        const p0 = s * U + U / 2, p1 = (b - 1) * U + U / 2;
        strokes.push(horizontal ? [{ x: p0, y: fixed }, { x: p1, y: fixed }] : [{ x: fixed, y: p0 }, { x: fixed, y: p1 }]);
      }
    }
  };
  runs(true);
  runs(false);
  const toMaze = (x: number, y: number) => ({ x: (x / IMG) * CANVAS, y: (y / IMG) * CANVAS });
  return { strokes, start: gn > 30 ? toMaze(gx / gn, gy / gn) : null, goal: rn > 30 ? toMaze(rx / rn, ry / rn) : null };
}

/** Built-in clean-up (no AI): simplify, square up nearly axis-aligned segments and round to a 10-unit grid. */
export function straighten(strokes: Stroke[]): Stroke[] {
  const out: Stroke[] = [];
  const r10 = (v: number) => Math.round(v / 10) * 10;
  for (const poly of cleanStrokes(strokes)) {
    const pts = poly.map((p) => ({ ...p }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dy) < Math.abs(dx) * 0.25) b.y = a.y;
      else if (Math.abs(dx) < Math.abs(dy) * 0.25) b.x = a.x;
    }
    const snapped = pts.map((p) => ({ x: r10(p.x), y: r10(p.y) }));
    const dedup = snapped.filter((p, i) => !i || p.x !== snapped[i - 1].x || p.y !== snapped[i - 1].y);
    if (dedup.length >= 2) out.push(dedup);
  }
  return out;
}

/** Black-on-white render of the raw doodle (what the AI sees for clean-up), as a JPEG data URL. */
export function doodleImage(strokes: Stroke[], start: Pt | null, goal: Pt | null): string {
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  const ctx = c.getContext('2d')!;
  const k = 640 / CANVAS;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = WALL_THICKNESS;
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  }
  const disc = (p: Pt | null, col: string, t: string) => {
    if (!p) return;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, p.x, p.y + 1);
  };
  disc(start, '#16a34a', 'S');
  disc(goal, '#dc2626', 'G');
  return c.toDataURL('image/jpeg', 0.85);
}

import { sanitize, rasterize, distanceField, cellCenter, floodReachable } from '../../shared/geometry';

/** When a picture has no marked Start/Goal: take the largest open region and use its two farthest-apart points (double sweep). */
export function autoPlace(strokes: Stroke[]): { start: Pt; goal: Pt } | null {
  const grid = rasterize(sanitize(strokes));
  const seen = new Uint8Array(grid.length);
  let bestSeed = -1, bestSize = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] || seen[i]) continue;
    const r = floodReachable(grid, i);
    let n = 0;
    for (let j = 0; j < r.length; j++) if (r[j]) { seen[j] = 1; n++; }
    if (n > bestSize) { bestSize = n; bestSeed = i; }
  }
  if (bestSeed < 0) return null;
  const far = (from: number) => {
    const f = distanceField(grid, from);
    let g = from, gd = -1;
    for (let i = 0; i < f.length; i++) if (Number.isFinite(f[i]) && f[i] > gd) { gd = f[i]; g = i; }
    return g;
  };
  const a = far(bestSeed);
  const b = far(a);
  return { start: cellCenter(a), goal: cellCenter(b) };
}
