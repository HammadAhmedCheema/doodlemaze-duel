import { CELL, GRID, WALK_SPEED_UNITS_S } from '../../../shared/constants';
import { cellCenter, cellOf, distanceField } from '../../../shared/geometry';
import type { Pt } from '../../../shared/types';

export const BEAST_SPEED = WALK_SPEED_UNITS_S * 0.72;
export const BEAST_CATCH = 24;
const WAKE_MS = 4000;
const REPLAN_MS = 300;

/**
 * The beast hunts the player through the maze. It replans on the same dilated grid the player
 * collides with (so it can never cut through walls), following the steepest descent of a
 * distance field rooted at the player, a bit slower than the player can run.
 */
export class Beast {
  x: number;
  y: number;
  angle = 0;
  private field: Float64Array | null = null;
  private lastPlan = -1e9;
  private target: Pt | null = null;
  private sleepUntil: number;

  constructor(private grid: Uint8Array, readonly spawn: Pt, now: number) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.sleepUntil = now + WAKE_MS;
  }

  get awake() {
    return performance.now() >= this.sleepUntil;
  }

  /** Put the beast back in its lair and let it sleep for a moment. */
  reset(now: number, sleepMs = 3000) {
    this.x = this.spawn.x;
    this.y = this.spawn.y;
    this.target = null;
    this.sleepUntil = now + sleepMs;
  }

  /** Returns the distance to the player after moving. */
  update(dt: number, now: number, player: Pt): number {
    const d0 = Math.hypot(player.x - this.x, player.y - this.y);
    if (now < this.sleepUntil) return d0;
    if (now - this.lastPlan > REPLAN_MS) {
      this.field = distanceField(this.grid, cellOf(player));
      this.lastPlan = now;
      this.target = null;
    }
    let step = BEAST_SPEED * Math.min(dt, 0.1);
    while (step > 0) {
      const here = cellOf(this);
      if (!this.target || Math.hypot(this.target.x - this.x, this.target.y - this.y) < 0.5) {
        this.target = this.nextCell(here) ?? player;
        if (Math.hypot(player.x - this.x, player.y - this.y) < CELL * 6) this.target = player;
      }
      const dx = this.target.x - this.x, dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) break;
      const m = Math.min(step, d);
      this.x += (dx / d) * m;
      this.y += (dy / d) * m;
      this.angle = Math.atan2(dy, dx);
      step -= m;
      if (m < d) break;
    }
    return Math.hypot(player.x - this.x, player.y - this.y);
  }

  private nextCell(here: number): Pt | null {
    const f = this.field;
    if (!f) return null;
    const x = here % GRID, y = (here / GRID) | 0;
    let best = -1, bestV = Number.isFinite(f[here]) ? f[here] : Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const j = ny * GRID + nx;
        if (this.grid[j]) continue;
        if (dx && dy && (this.grid[y * GRID + nx] || this.grid[ny * GRID + x])) continue;
        if (f[j] < bestV) { bestV = f[j]; best = j; }
      }
    return best >= 0 ? cellCenter(best) : null;
  }
}

/** Lair: the dead end farthest (by walking distance) from the start that is not right next to the goal. */
export function pickLair(deadEnds: Pt[], startField: Float64Array, start: Pt, goal: Pt): Pt {
  let best: Pt | null = null, bestD = -1;
  for (const p of deadEnds) {
    const d = startField[cellOf(p)];
    if (!Number.isFinite(d) || Math.hypot(p.x - goal.x, p.y - goal.y) < 150 || Math.hypot(p.x - start.x, p.y - start.y) < 250) continue;
    if (d > bestD) { bestD = d; best = p; }
  }
  if (best) return best;
  // fallback: farthest reachable cell from the start
  let bi = cellOf(goal);
  let bv = -1;
  for (let i = 0; i < startField.length; i++) if (Number.isFinite(startField[i]) && startField[i] > bv && Math.hypot(cellCenter(i).x - goal.x, cellCenter(i).y - goal.y) > 150) { bv = startField[i]; bi = i; }
  return cellCenter(bi);
}
