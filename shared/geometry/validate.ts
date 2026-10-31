import { CELL, GRID, MIN_START_GOAL_DIST, MIN_TOTAL_WALL_LEN, TRIVIAL_RATIO } from '../constants';
import type { MazeInput, Pt, Seg } from '../types';
import { dist, segLen } from './math';
import { cellCenter, cellOf, rasterize, wallMask } from './rasterize';
import { sanitize, isBorderSeg } from './sanitize';
import { solve, type SolveResult } from './solve';

export type ErrorCode = 'START_IN_WALL' | 'GOAL_IN_WALL' | 'TOO_CLOSE' | 'NOT_ENOUGH_WALLS' | 'UNSOLVABLE' | 'TOO_NARROW';
export type WarningCode = 'VERY_EASY';
export type Issue<C extends string> = { code: C; message: string };

export type MazeStats = {
  wallCount: number;
  totalWallLen: number;
  shortestUnits: number;
  deadEnds: number;
};

export type ValidationResult = {
  ok: boolean;
  errors: Issue<ErrorCode>[];
  warnings: Issue<WarningCode>[];
  stats: MazeStats;
  segments: Seg[];
  grid: Uint8Array;
  solved?: SolveResult;
  reachable?: Uint8Array;
  deadEndPts: Pt[];
};

const MESSAGES: Record<ErrorCode | WarningCode, string> = {
  START_IN_WALL: 'Start is too close to a wall. Move it away from the walls.',
  GOAL_IN_WALL: 'Goal is too close to a wall. Move it away from the walls.',
  TOO_CLOSE: `Start and Goal are too close together. Put them at least ${MIN_START_GOAL_DIST} units apart.`,
  NOT_ENOUGH_WALLS: 'Not much of a maze yet. Draw more walls.',
  UNSOLVABLE: 'There is no way from Start to Goal. The tinted area is everywhere Start can reach: open a gap.',
  TOO_NARROW: 'A path exists, but the passages are too narrow for the player. Widen them.',
  VERY_EASY: 'Very easy: the shortest path is almost a straight line.',
};

const issue = <C extends ErrorCode | WarningCode>(code: C): Issue<C> => ({ code, message: MESSAGES[code] });

/** Local maxima of the goal distance field, at least 60 units apart: the tips of dead ends. */
export function findDeadEnds(grid: Uint8Array, d: Float32Array, onPath: Uint8Array): Pt[] {
  const cands: Array<[number, number]> = [];
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const i = y * GRID + x;
      if (grid[i] || !Number.isFinite(d[i]) || onPath[i]) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = i + dy * GRID + dx;
          if (!grid[j] && d[j] > d[i]) {
            isMax = false;
            break;
          }
        }
      if (isMax) cands.push([d[i], i]);
    }
  }
  cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const picked: Pt[] = [];
  for (const [, i] of cands) {
    const p = cellCenter(i);
    if (picked.every((q) => dist(p, q) >= 60)) picked.push(p);
    if (picked.length >= 40) break;
  }
  return picked;
}

/** Mark cells within ~25 units of the shortest path so props never block it. */
export function pathCorridor(path: Pt[]): Uint8Array {
  const m = new Uint8Array(GRID * GRID);
  const r = 5;
  for (const p of path) {
    const c = cellOf(p);
    const cx = c % GRID;
    const cy = (c / GRID) | 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < GRID && y < GRID) m[y * GRID + x] = 1;
      }
  }
  return m;
}

export function validateSegments(segments: Seg[], start: Pt, goal: Pt): ValidationResult {
  const errors: Issue<ErrorCode>[] = [];
  const warnings: Issue<WarningCode>[] = [];
  const inner = segments.filter((s) => !isBorderSeg(s));
  const totalWallLen = inner.reduce((a, s) => a + segLen(s), 0);
  const grid = rasterize(segments);
  const stats: MazeStats = { wallCount: inner.length, totalWallLen: Math.round(totalWallLen), shortestUnits: 0, deadEnds: 0 };
  const base = { segments, grid, deadEndPts: [] as Pt[] };

  if (totalWallLen < MIN_TOTAL_WALL_LEN) errors.push(issue('NOT_ENOUGH_WALLS'));
  const sIn = grid[cellOf(start)] === 1;
  const gIn = grid[cellOf(goal)] === 1;
  if (sIn) errors.push(issue('START_IN_WALL'));
  if (gIn) errors.push(issue('GOAL_IN_WALL'));
  if (dist(start, goal) < MIN_START_GOAL_DIST) errors.push(issue('TOO_CLOSE'));
  if (sIn || gIn) return { ok: false, errors, warnings, stats, ...base };

  const solved = solve(grid, start, goal);
  if (!solved.solvable) {
    const raw = solve(wallMask(segments), start, goal);
    errors.push(issue(raw.solvable ? 'TOO_NARROW' : 'UNSOLVABLE'));
    return { ok: false, errors, warnings, stats, ...base, solved, reachable: solved.reachable };
  }
  stats.shortestUnits = Math.round(solved.shortestUnits);
  if (solved.shortestUnits / Math.max(1, dist(start, goal)) < TRIVIAL_RATIO) warnings.push(issue('VERY_EASY'));
  const deadEndPts = findDeadEnds(grid, solved.distFromGoal, pathCorridor(solved.path));
  stats.deadEnds = deadEndPts.length;
  return { ok: errors.length === 0, errors, warnings, stats, segments, grid, solved, reachable: solved.reachable, deadEndPts };
}

export function validate(input: MazeInput): ValidationResult {
  return validateSegments(sanitize(input.strokes), input.start, input.goal);
}

export { CELL };
