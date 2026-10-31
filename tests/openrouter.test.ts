import { afterEach, describe, expect, it, vi } from 'vitest';
import { callOpenRouter, formatLadder } from '../server/vlm/openrouter';
import { requestWalls } from '../server/vlm/walls';
import { validate } from '../shared/geometry';
import { SAMPLES } from '../shared/samples';

const reply = (content: string, model = 'google/gemma-3-27b-it') =>
  new Response(JSON.stringify({ model, choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });

const cfg = { model: 'google/gemma-3-27b-it', fallbacks: ['qwen/qwen3-vl-235b-a22b-instruct'] };
const s = SAMPLES[1];
const v = validate(s);
const req = { segments: v.segments, start: s.start, goal: s.goal, stats: v.stats, warnings: v.warnings };

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter requests (fetch stubbed)', () => {
  it('starts Gemma on json_object, keeps instructions in the user turn, and parses a fenced reply', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return reply('Here you go:\n```json\n{"themeName":"Moss Halls","wallMaterial":"hedge","difficulty":"hard","difficultyScore":8}\n```');
    }));
    const r = await callOpenRouter(req, cfg);
    expect(r.theme.themeName).toBe('Moss Halls');
    expect(r.theme.wallMaterial).toBe('hedge');
    expect(bodies[0].response_format).toEqual({ type: 'json_object' });
    expect(bodies[0].messages.every((m: any) => m.role === 'user')).toBe(true);
    expect(bodies[0].models).toEqual(['google/gemma-3-27b-it', 'qwen/qwen3-vl-235b-a22b-instruct']);
  });

  it('steps down to no response_format when the provider rejects json_object', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      bodies.push(b);
      if (b.response_format) return new Response('response_format not supported', { status: 400 });
      return reply('{"themeName":"Plain Text Win"}');
    }));
    const r = await callOpenRouter(req, cfg);
    expect(r.theme.themeName).toBe('Plain Text Win');
    expect(bodies.length).toBe(2);
    expect(bodies[1].response_format).toBeUndefined();
  });

  it('non-Gemma models still try json_schema first', () => {
    expect((formatLadder('qwen/qwen3-vl-235b-a22b-instruct')[0] as any).type).toBe('json_schema');
    expect((formatLadder('google/gemma-3-27b-it')[0] as any).type).toBe('json_object');
  });

  it('walls: nudges once after an empty list, then accepts the compact format', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? reply('{"walls":[],"start":null,"goal":null}') : reply('{"walls":[[12,12,988,12],[300,12,300,700],[600,300,600,988]],"start":[60,60],"goal":[900,900]}'))));
    const r = await requestWalls('photo', 'data:image/png;base64,AAAA', '', cfg);
    expect(n).toBe(2);
    expect(r.strokes.length).toBe(3);
    expect(r.start).toEqual({ x: 60, y: 60 });
  });
});

describe('walls streaming', () => {
  it('keeps the complete walls from a cut-off, looping stream', async () => {
    const chunks = ['{"walls":[[12,12,988,12],', '[300,12,300,700],[600,300,600,988],', '[600,300,600,988],[600,300,600,988],[600,3'];
    const sse = chunks.map((c) => `data: ${JSON.stringify({ model: 'google/gemma-3-27b-it', choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const r = await requestWalls('clean', 'data:image/jpeg;base64,AAAA', '', cfg);
    expect(r.strokes.length).toBe(3);
    expect(r.model).toBe('google/gemma-3-27b-it');
  });
});

import { scanWalls } from '../server/vlm/walls';
describe('scanWalls', () => {
  it('finds arrays, objects and start/goal in messy text', () => {
    const r = scanWalls('x {"walls":[{"x1":1,"y1":2,"x2":300,"y2":2}, [5,5,5,500]], "start":{"x":10,"y":20},"goal":[900,900');
    expect(r.walls.length).toBe(2);
    expect(r.start).toEqual([10, 20]);
    expect(r.goal).toBeNull();
  });
});
