import { CELL, GRID } from '../constants';
import type { Pt } from '../types';
import { cellCenter, cellOf } from './rasterize';

export type SolveResult = {
  solvable: boolean;
  shortestUnits: number;
  path: Pt[];
  distFromGoal: Float32Array; // units, Infinity if unreachable
  reachable: Uint8Array; // cells reachable from start
};

const SQ2 = Math.SQRT2;
// dx, dy, cost
const NB: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
];

/** Visit neighbors of cell i with 8-connectivity and no corner cutting. */
function forNeighbors(grid: Uint8Array, i: number, fn: (j: number, cost: number) => void) {
  const x = i % GRID;
  const y = (i / GRID) | 0;
  for (const [dx, dy, c] of NB) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
    const j = ny * GRID + nx;
    if (grid[j]) continue;
    if (dx && dy && (grid[y * GRID + nx] || grid[ny * GRID + x])) continue;
    fn(j, c);
  }
}

/** Dijkstra over the whole grid from `src`, returns distance in cells. Typed-array heap for speed. */
export function distanceField(grid: Uint8Array, src: number): Float64Array {
  const N = GRID * GRID;
  const d = new Float64Array(N).fill(Infinity);
  if (grid[src]) return d;
  const cap = N * 4;
  const hd = new Float64Array(cap);
  const hi = new Int32Array(cap);
  let size = 0;
  const push = (dv: number, iv: number) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hd[p] <= dv) break;
      hd[k] = hd[p];
      hi[k] = hi[p];
      k = p;
    }
    hd[k] = dv;
    hi[k] = iv;
  };
  d[src] = 0;
  push(0, src);
  while (size > 0) {
    const dv = hd[0];
    const i = hi[0];
    // pop
    size--;
    if (size > 0) {
      const ld = hd[size];
      const li = hi[size];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= size) break;
        const r = l + 1;
        const m = r < size && hd[r] < hd[l] ? r : l;
        if (hd[m] >= ld) break;
        hd[k] = hd[m];
        hi[k] = hi[m];
        k = m;
      }
      hd[k] = ld;
      hi[k] = li;
    }
    if (dv > d[i]) continue;
    const x = i % GRID;
    const y = (i / GRID) | 0;
    const L = x > 0 && !grid[i - 1];
    const R = x < GRID - 1 && !grid[i + 1];
    const U = y > 0 && !grid[i - GRID];
    const D = y < GRID - 1 && !grid[i + GRID];
    const relax = (j: number, c: number) => {
      const nd = dv + c;
      if (nd < d[j] && size < cap) {
        d[j] = nd;
        push(nd, j);
      }
    };
    if (L) relax(i - 1, 1);
    if (R) relax(i + 1, 1);
    if (U) relax(i - GRID, 1);
    if (D) relax(i + GRID, 1);
    if (L && U && !grid[i - GRID - 1]) relax(i - GRID - 1, SQ2);
    if (R && U && !grid[i - GRID + 1]) relax(i - GRID + 1, SQ2);
    if (L && D && !grid[i + GRID - 1]) relax(i + GRID - 1, SQ2);
    if (R && D && !grid[i + GRID + 1]) relax(i + GRID + 1, SQ2);
  }
  return d;
}

export function floodReachable(grid: Uint8Array, src: number): Uint8Array {
  const r = new Uint8Array(GRID * GRID);
  if (grid[src]) return r;
  const q = new Int32Array(GRID * GRID);
  let h = 0;
  let t = 0;
  q[t++] = src;
  r[src] = 1;
  while (h < t) {
    const i = q[h++];
    forNeighbors(grid, i, (j) => {
      if (!r[j]) {
        r[j] = 1;
        q[t++] = j;
      }
    });
  }
  return r;
}

export function solve(grid: Uint8Array, start: Pt, goal: Pt): SolveResult {
  const s = cellOf(start);
  const g = cellOf(goal);
  const dCells = distanceField(grid, g);
  const distFromGoal = new Float32Array(dCells.length);
  for (let i = 0; i < dCells.length; i++) distFromGoal[i] = dCells[i] * CELL;
  const solvable = Number.isFinite(dCells[s]);
  let reachable: Uint8Array;
  if (solvable) {
    // same connected component as the goal
    reachable = new Uint8Array(dCells.length);
    for (let i = 0; i < dCells.length; i++) if (dCells[i] !== Infinity) reachable[i] = 1;
  } else reachable = floodReachable(grid, s);
  const path: Pt[] = [];
  if (solvable) {
    let cur = s;
    path.push(cellCenter(cur));
    let guard = GRID * GRID;
    while (cur !== g && guard-- > 0) {
      let best = cur;
      let bestV = dCells[cur];
      forNeighbors(grid, cur, (j, c) => {
        const v = dCells[j] + c * 1e-6; // tie-break straight moves
        if (v < bestV) {
          bestV = v;
          best = j;
        }
      });
      if (best === cur) break;
      cur = best;
      path.push(cellCenter(cur));
    }
  }
  return { solvable, shortestUnits: solvable ? dCells[s] * CELL : Infinity, path, distFromGoal, reachable };
}
