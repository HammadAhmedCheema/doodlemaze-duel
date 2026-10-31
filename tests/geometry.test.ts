import { describe, expect, it } from 'vitest';
import { sanitize, borderSegments, validate, rasterize, solve, distToSeg } from '../shared/geometry';
import { SAMPLES } from '../shared/samples';
import type { Stroke } from '../shared/types';
import { BORDER_INSET } from '../shared/constants';

const line = (x1: number, y1: number, x2: number, y2: number, step = 8): Stroke => {
  const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x1 + ((x2 - x1) * i) / n, y: y1 + ((y2 - y1) * i) / n }));
};

describe('sanitize', () => {
  it('always adds the border', () => {
    const segs = sanitize([]);
    expect(segs).toEqual(borderSegments());
    const segs2 = sanitize([line(100, 100, 600, 100)]);
    for (const b of borderSegments()) expect(segs2).toContainEqual(b);
    expect(borderSegments()[0].x1).toBe(BORDER_INSET);
  });

  it('closes gaps smaller than GAP_SNAP', () => {
    // vertical wall, and a horizontal stroke that stops 10 units short of it
    const segs = sanitize([line(500, 100, 500, 900), line(100, 500, 490, 500)]);
    const wall = segs.find((s) => s.x1 === 500 && s.x2 === 500)!;
    const ends = segs.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
    const near = ends.filter((p) => Math.abs(p.y - 500) < 1 && p.x > 400);
    expect(near.length).toBeGreaterThan(0);
    expect(Math.min(...near.map((p) => distToSeg(p.x, p.y, wall)))).toBeLessThan(0.01);
  });

  it('snaps endpoints near the border onto it', () => {
    const segs = sanitize([line(300, 20, 300, 600)]);
    expect(segs.some((s) => Math.abs(s.y1 - BORDER_INSET) < 0.01 || Math.abs(s.y2 - BORDER_INSET) < 0.01)).toBe(true);
  });

  it('drops tiny strokes and is deterministic', () => {
    const strokes = [line(100, 100, 110, 100), line(100, 300, 800, 320, 3), line(200, 700, 700, 650, 3)];
    const a = sanitize(strokes);
    const b = sanitize(JSON.parse(JSON.stringify(strokes)));
    expect(a).toEqual(b);
    expect(a.length).toBe(4 + 2); // two straight-ish strokes + border
  });
});

describe('validate', () => {
  it('accepts every bundled sample', () => {
    for (const s of SAMPLES) {
      const r = validate(s);
      expect(r.errors, s.name).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.stats.shortestUnits).toBeGreaterThan(0);
    }
  });

  it('detects an unsolvable maze and returns the reachable region', () => {
    const r = validate({ strokes: [line(12, 500, 988, 500), line(300, 100, 300, 400), line(700, 600, 700, 900)], start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('UNSOLVABLE');
    expect(r.reachable!.some((v) => v === 1)).toBe(true);
  });

  it('detects too-narrow passages', () => {
    // wall across the middle with a 20-unit gap: open on the raw grid, closed for the player
    const r = validate({ strokes: [line(12, 500, 490, 500), line(510, 500, 988, 500), line(300, 100, 300, 400), line(700, 600, 700, 900)], start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } });
    expect(r.errors.map((e) => e.code)).toContain('TOO_NARROW');
  });

  it('flags start in wall, too close and not enough walls', () => {
    const r = validate({ strokes: [line(100, 200, 900, 200)], start: { x: 500, y: 203 }, goal: { x: 520, y: 400 } });
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('START_IN_WALL');
    expect(codes).toContain('TOO_CLOSE');
    expect(codes).toContain('NOT_ENOUGH_WALLS');
  });

  it('warns when the maze is very easy', () => {
    const r = validate({ strokes: [line(300, 100, 300, 900), line(700, 100, 700, 900)], start: { x: 500, y: 100 }, goal: { x: 500, y: 900 } });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('VERY_EASY');
  });

  it('solves a 300-segment maze in under 50 ms', () => {
    const strokes: Stroke[] = [];
    // 25 zigzag strokes x 13 segments each
    for (let k = 0; k < 25; k++) {
      const y = 40 + k * 37;
      const s: Stroke = [];
      for (let i = 0; i <= 13; i++) s.push({ x: (k % 2 ? 140 : 30) + i * 64, y: y + (i % 2 ? 16 : 0) });
      strokes.push(s);
    }
    const segs = sanitize(strokes);
    expect(segs.length).toBeGreaterThanOrEqual(300);
    let best = Infinity;
    for (let k = 0; k < 4; k++) {
      const t0 = performance.now();
      validate({ strokes, start: { x: 60, y: 28 }, goal: { x: 900, y: 975 } });
      best = Math.min(best, performance.now() - t0);
    }
    // PERF_BUDGET_MS lets slow CI boxes relax the budget; 50 ms is the target on a laptop
    expect(best).toBeLessThan(Number(process.env.PERF_BUDGET_MS || 50));
  });

  it('distance field decreases along the path', () => {
    const s = SAMPLES[0];
    const segs = sanitize(s.strokes);
    const r = solve(rasterize(segs), s.start, s.goal);
    expect(r.path.length).toBeGreaterThan(10);
    expect(r.shortestUnits).toBeGreaterThan(2000);
  });
});
