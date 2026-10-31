import { PNG } from 'pngjs';
import { CANVAS, WALL_THICKNESS } from '../../shared/constants';
import { closestOnSeg } from '../../shared/geometry';
import type { Pt, Seg } from '../../shared/types';

const SIZE = 600;
const K = SIZE / CANVAS;

// 5x7 bitmap glyphs for the two letters we need
const GLYPHS: Record<string, string[]> = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
};

/**
 * Render the sanitized maze as a clean 600x600 PNG: black walls on white, green disc "S" for start,
 * red disc "G" for goal. Pure JS (pngjs), no native canvas dependency.
 */
export function renderMazePng(segs: Seg[], start: Pt, goal: Pt): Buffer {
  const png = new PNG({ width: SIZE, height: SIZE });
  const d = png.data;
  d.fill(255);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  };
  const rad = (WALL_THICKNESS / 2) * K + 0.6;
  for (const s0 of segs) {
    const s = { x1: s0.x1 * K, y1: s0.y1 * K, x2: s0.x2 * K, y2: s0.y2 * K };
    const minX = Math.floor(Math.min(s.x1, s.x2) - rad), maxX = Math.ceil(Math.max(s.x1, s.x2) + rad);
    const minY = Math.floor(Math.min(s.y1, s.y2) - rad), maxY = Math.ceil(Math.max(s.y1, s.y2) + rad);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) if (closestOnSeg(x + 0.5, y + 0.5, s).d2 <= rad * rad) set(x, y, 0, 0, 0);
  }
  const disc = (p: Pt, rgb: [number, number, number], letter: string) => {
    const cx = p.x * K, cy = p.y * K, r = 20;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, ...rgb);
    const g = GLYPHS[letter];
    const px = 4; // glyph pixel size
    const ox = Math.round(cx - (5 * px) / 2), oy = Math.round(cy - (7 * px) / 2);
    g.forEach((row, gy) => [...row].forEach((bit, gx) => {
      if (bit === '1') for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) set(ox + gx * px + xx, oy + gy * px + yy, 255, 255, 255);
    }));
  };
  disc(start, [22, 163, 74], 'S');
  disc(goal, [220, 38, 38], 'G');
  return PNG.sync.write(png);
}
