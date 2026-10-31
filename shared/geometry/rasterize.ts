import { CELL, GRID, PLAYER_RADIUS, WALL_THICKNESS } from '../constants';
import type { Pt, Seg } from '../types';
import { closestOnSeg } from './math';

/** Mark every cell whose center is within `radius` of a segment. */
export function rasterizeRadius(segs: Seg[], radius: number): Uint8Array {
  const g = new Uint8Array(GRID * GRID);
  const r2 = radius * radius;
  for (const s of segs) {
    const minX = Math.max(0, Math.floor((Math.min(s.x1, s.x2) - radius) / CELL));
    const maxX = Math.min(GRID - 1, Math.floor((Math.max(s.x1, s.x2) + radius) / CELL));
    const minY = Math.max(0, Math.floor((Math.min(s.y1, s.y2) - radius) / CELL));
    const maxY = Math.min(GRID - 1, Math.floor((Math.max(s.y1, s.y2) + radius) / CELL));
    for (let cy = minY; cy <= maxY; cy++) {
      const py = (cy + 0.5) * CELL;
      for (let cx = minX; cx <= maxX; cx++) {
        const i = cy * GRID + cx;
        if (g[i]) continue;
        if (closestOnSeg((cx + 0.5) * CELL, py, s).d2 <= r2) g[i] = 1;
      }
    }
  }
  return g;
}

/** Walls dilated by the player radius: a free cell is a place the player's center can be. */
export function rasterize(segs: Seg[]): Uint8Array {
  return rasterizeRadius(segs, WALL_THICKNESS / 2 + PLAYER_RADIUS);
}

/** Undilated wall mask (what the walls actually cover). */
export function wallMask(segs: Seg[]): Uint8Array {
  return rasterizeRadius(segs, WALL_THICKNESS / 2);
}

export function cellOf(p: Pt): number {
  const cx = Math.min(GRID - 1, Math.max(0, Math.floor(p.x / CELL)));
  const cy = Math.min(GRID - 1, Math.max(0, Math.floor(p.y / CELL)));
  return cy * GRID + cx;
}

export function cellCenter(i: number): Pt {
  return { x: ((i % GRID) + 0.5) * CELL, y: (Math.floor(i / GRID) + 0.5) * CELL };
}
