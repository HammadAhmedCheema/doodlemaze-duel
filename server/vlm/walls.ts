import { z } from 'zod';
import { CANVAS } from '../../shared/constants';
import type { Pt, Stroke } from '../../shared/types';
import { extractJson } from './openrouter';

export type WallMode = 'photo' | 'clean';
export type WallsResult = { strokes: Stroke[]; start: Pt | null; goal: Pt | null; model: string };

const PROMPTS: Record<WallMode, string> = {
  photo:
    'You convert a picture of a maze into wall geometry for a 3D maze game. Map the picture onto a 1000 x 1000 square, (0,0) is the top-left corner, x grows right, y grows down. ' +
    'Return every wall as a straight segment {x1,y1,x2,y2} that follows a drawn line. Split curves into a few straight pieces. Merge collinear pieces. At most 150 walls. ' +
    'Keep every opening between walls open: never add walls that are not in the picture. Ignore text, shading, arrows and anything that is not a wall. ' +
    'If the picture marks a start and an end (S/G, Start/End, In/Out, green/red dots, or gaps in the outer wall), return points inside the corridors next to them; otherwise null. ' +
    'Respond with a single JSON object matching the schema and nothing else.',
  clean:
    'You clean up a hand-drawn maze for a 3D maze game. The picture is a 1000 x 1000 square, (0,0) top-left, y grows down. Green disc S = start, red disc G = goal. ' +
    'Redraw it as clean straight walls {x1,y1,x2,y2}: straighten wobbly strokes, make nearly horizontal or vertical lines exactly horizontal or vertical, and join corners that were meant to touch. ' +
    'Keep the layout, every intentional opening and every dead end. Do not invent new walls and do not close the route from S to G. At most 150 walls. Also return the start and goal positions. ' +
    'Respond with a single JSON object matching the schema and nothing else.',
};

const pt = { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { type: 'number' }, y: { type: 'number' } } };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['walls', 'start', 'goal'],
  properties: {
    walls: {
      type: 'array',
      maxItems: 150,
      items: { type: 'object', additionalProperties: false, required: ['x1', 'y1', 'x2', 'y2'], properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } },
    },
    start: { anyOf: [pt, { type: 'null' }] },
    goal: { anyOf: [pt, { type: 'null' }] },
  },
} as const;

const clamp = (v: number) => Math.max(0, Math.min(CANVAS, v));
const P = z.object({ x: z.coerce.number(), y: z.coerce.number() }).transform((p) => ({ x: clamp(p.x), y: clamp(p.y) }));
const W = z.object({ x1: z.coerce.number(), y1: z.coerce.number(), x2: z.coerce.number(), y2: z.coerce.number() });
const Out = z.object({
  walls: z.array(z.unknown()).transform((a) => a.flatMap((w) => { const r = W.safeParse(w); return r.success ? [r.data] : []; })).catch([]),
  start: P.nullable().catch(null),
  goal: P.nullable().catch(null),
});

/** Parse a model answer into strokes. Exported for tests. */
export function parseWalls(raw: unknown): Omit<WallsResult, 'model'> {
  const o = Out.parse(raw && typeof raw === 'object' ? raw : {});
  const strokes: Stroke[] = [];
  for (const w of o.walls.slice(0, 200)) {
    const a = { x: clamp(w.x1), y: clamp(w.y1) }, b = { x: clamp(w.x2), y: clamp(w.y2) };
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || Math.hypot(a.x - b.x, a.y - b.y) < 8) continue;
    strokes.push([a, b]);
  }
  return { strokes, start: o.start, goal: o.goal };
}

/** Ask the VLM for wall geometry. The result is only a proposal: the client loads it into the editor and the normal validator decides. */
export async function requestWalls(mode: WallMode, image: string, hint: string, cfg: { model: string; fallbacks: string[] }, outer?: AbortSignal): Promise<WallsResult> {
  const body = (format: object) => ({
    model: cfg.model,
    models: [cfg.model, ...cfg.fallbacks],
    temperature: 0.1,
    max_tokens: 4000,
    response_format: format,
    messages: [
      { role: 'system', content: PROMPTS[mode] },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: hint || 'Extract the walls.' }] },
    ],
  });
  let format: object = { type: 'json_schema', json_schema: { name: 'maze_walls', strict: true, schema: SCHEMA } };
  for (let attempt = 0; attempt < 2; attempt++) {
    const signals = [AbortSignal.timeout(30_000)];
    if (outer) signals.push(outer);
    const t0 = Date.now();
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.any(signals),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://github.com/HammadAhmedCheema/doodlemaze-duel', 'X-Title': 'DoodleMaze Duel' },
      body: JSON.stringify(body(format)),
    });
    if (!res.ok) {
      const t = (await res.text()).slice(0, 300);
      if (attempt === 0 && res.status >= 400 && res.status < 500 && res.status !== 429) { format = { type: 'json_object' }; continue; }
      throw new Error(`OpenRouter ${res.status}: ${t}`);
    }
    const j = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    const out = parseWalls(extractJson(j.choices?.[0]?.message?.content ?? ''));
    console.log(`[vlm] ${mode}: ${j.model} returned ${out.strokes.length} walls in ${Date.now() - t0} ms`, j.usage ? JSON.stringify(j.usage) : '');
    return { ...out, model: j.model ?? cfg.model };
  }
  throw new Error('walls request failed');
}
