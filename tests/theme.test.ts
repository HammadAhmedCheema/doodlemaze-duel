import { describe, expect, it } from 'vitest';
import { parseTheme, defaultTheme, playablePalette, contrast } from '../shared/theme';
import { extractJson } from '../server/vlm/openrouter';
import { renderMazePng } from '../server/vlm/png';
import { sanitize } from '../shared/geometry';
import { SAMPLES } from '../shared/samples';

describe('theme parsing', () => {
  it('keeps valid fields and defaults invalid ones individually', () => {
    const t = parseTheme({ themeName: 'Frozen Catacombs', wallMaterial: 'lava', mood: 'night', palette: { wall: '#ABCDEF', floor: 'blue', sky: '#000000', accent: '#ff0000' }, fogDensity: 9, props: ['torch', 'torch', 'dragon', 'tree'], refereeComment: 'x'.repeat(300) });
    expect(t.themeName).toBe('Frozen Catacombs');
    expect(t.wallMaterial).toBe('stone');
    expect(t.mood).toBe('night');
    expect(t.palette.wall).toBe('#abcdef');
    expect(t.palette.floor).toBe(defaultTheme().palette.floor);
    expect(t.fogDensity).toBe(0.05);
    expect(t.props).toEqual(['torch', 'tree']);
    expect(t.refereeComment.length).toBe(140);
  });
  it('falls back to the default theme for unsafe content and hides the comment', () => {
    const t = parseTheme({ contentSafe: false, themeName: 'Bad', refereeComment: 'nope' }, 3000);
    expect(t.themeName).toBe(defaultTheme().themeName);
    expect(t.refereeComment).toBe('');
  });
  it('handles garbage', () => {
    expect(parseTheme(null).themeName).toBe(defaultTheme().themeName);
    expect(parseTheme('hello').wallMaterial).toBe('stone');
  });
  it('enforces playable wall/floor contrast', () => {
    const p = playablePalette({ wall: '#222222', floor: '#202020', sky: '#000000', accent: '#222222' });
    expect(contrast(p.wall, p.floor)).toBeGreaterThanOrEqual(2.2);
  });
});

describe('extractJson', () => {
  it('strips fences and chatty text, taking the last object', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Thinking {"draft":true} ... final: {"a":2,"s":"}{"}')).toEqual({ a: 2, s: '}{' });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('maze png', () => {
  it('renders a 600x600 PNG', () => {
    const s = SAMPLES[1];
    const buf = renderMazePng(sanitize(s.strokes), s.start, s.goal);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(600);
  });
});

import { parseWalls } from '../server/vlm/walls';
describe('parseWalls', () => {
  it('turns model walls into clamped 2-point strokes and drops junk', () => {
    const r = parseWalls({ walls: [{ x1: 0, y1: 100, x2: 1200, y2: 100 }, { x1: 5, y1: 5, x2: 6, y2: 6 }, { x1: 'a' }, { x1: 300, y1: 0, x2: 300, y2: 500 }], start: { x: 50, y: 50 }, goal: null });
    expect(r.strokes).toEqual([[{ x: 0, y: 100 }, { x: 1000, y: 100 }], [{ x: 300, y: 0 }, { x: 300, y: 500 }]]);
    expect(r.start).toEqual({ x: 50, y: 50 });
    expect(r.goal).toBeNull();
    expect(parseWalls('nonsense').strokes).toEqual([]);
  });
});
