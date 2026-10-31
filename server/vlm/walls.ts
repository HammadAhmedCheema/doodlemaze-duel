import { z } from 'zod';
import { CANVAS } from '../../shared/constants';
import type { Pt, Stroke } from '../../shared/types';
import { extractJson } from './openrouter';

export type WallMode = 'photo' | 'clean';
export type WallsResult = { strokes: Stroke[]; start: Pt | null; goal: Pt | null; model: string };

// Compact output format: each wall is [x1, y1, x2, y2] in integers. About 12 tokens per wall, so a
// 100-wall maze fits easily in max_tokens and answers in a few seconds.
const FORMAT =
  'Coordinates: map the picture onto a 1000 x 1000 square, (0,0) is the top-left corner, x grows to the right, y grows down. Use integers.\n' +
  'Answer with ONE JSON object and nothing else, exactly in this shape:\n' +
  '{"walls":[[100,50,100,400],[100,400,600,400],[600,400,600,150]],"start":[60,60],"goal":[900,920]}\n' +
  'Each wall is [x1,y1,x2,y2], a straight line segment along a drawn line. Use null for start or goal if you cannot tell.';

const PROMPTS: Record<WallMode, string> = {
  photo:
    'You convert a picture of a maze into wall geometry for a 3D maze game.\n' +
    'List EVERY wall line you can see as straight segments. Follow the lines of the maze, including the outer frame. Split curved lines into a few straight pieces. ' +
    'Leave openings between walls open and never invent walls. Ignore text, shading and arrows. Up to 120 walls.\n' +
    'Start and goal: if the picture marks them (S/G, Start/End, In/Out, arrows, green/red dots, or gaps in the outer frame), give points inside the corridor next to them; otherwise null.\n' +
    FORMAT,
  clean:
    'You clean up a hand-drawn maze for a 3D maze game. The green disc S is the start, the red disc G is the goal.\n' +
    'Redraw every black stroke as clean straight walls: straighten wobbly lines, make nearly horizontal or vertical lines exactly horizontal or vertical, and join corners that were meant to touch. ' +
    'Keep the layout, every opening and every dead end. Do not invent walls and do not close the route from S to G. Up to 120 walls. Also give the start and goal positions.\n' +
    FORMAT,
};

const clamp = (v: number) => Math.max(0, Math.min(CANVAS, v));
const num = z.coerce.number().refine(Number.isFinite);
// accept [x,y] or {x,y} for points, [x1,y1,x2,y2] or {x1,y1,x2,y2} for walls
const P = z
  .union([z.tuple([num, num]).transform(([x, y]) => ({ x, y })), z.object({ x: num, y: num })])
  .transform((p) => ({ x: clamp(p.x), y: clamp(p.y) }));
const W = z.union([
  z.tuple([num, num, num, num]).transform(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2 })),
  z.object({ x1: num, y1: num, x2: num, y2: num }),
]);
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
    if (Math.hypot(a.x - b.x, a.y - b.y) < 8) continue;
    strokes.push([a, b]);
  }
  return { strokes, start: o.start, goal: o.goal };
}

/**
 * Ask the VLM for wall geometry. The result is only a proposal: the client loads it into the editor and
 * the normal validator decides. Uses json_object mode (strict json_schema made the model return empty
 * lists), retries once if the answer has no walls, and logs the raw reply when that happens.
 */
export async function requestWalls(mode: WallMode, image: string, hint: string, cfg: { model: string; fallbacks: string[] }, outer?: AbortSignal): Promise<WallsResult> {
  const deadline = Date.now() + 55_000;
  let nudge = '';
  let plainText = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const budget = deadline - Date.now();
    if (budget < 5000) break;
    const signals = [AbortSignal.timeout(Math.min(45_000, budget))];
    if (outer) signals.push(outer);
    const t0 = Date.now();
    const userText = [hint, nudge, 'List the walls now as JSON.'].filter(Boolean).join('\n');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.any(signals),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': 'https://github.com/HammadAhmedCheema/doodlemaze-duel', 'X-Title': 'DoodleMaze Duel' },
      body: JSON.stringify({
        model: cfg.model,
        models: [cfg.model, ...cfg.fallbacks],
        temperature: attempt ? 0.4 : 0.1,
        max_tokens: 2500,
        ...(plainText ? {} : { response_format: { type: 'json_object' } }),
        // instructions in the user turn: Gemma has no system role
        messages: [{ role: 'user', content: [{ type: 'text', text: PROMPTS[mode] }, { type: 'image_url', image_url: { url: image } }, { type: 'text', text: userText }] }],
      }),
    });
    if (!res.ok) {
      const t = (await res.text()).slice(0, 300);
      if (attempt < 2 && res.status >= 400 && res.status < 500 && ![401, 402, 429].includes(res.status) && !plainText) { console.warn(`[vlm] ${mode}: ${res.status} with json_object, retrying without response_format: ${t}`); plainText = true; continue; }
      throw new Error(`OpenRouter ${res.status}: ${t}`);
    }
    const j = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
    const c = j.choices?.[0]?.message?.content;
    const text = Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : c ?? '';
    let out: Omit<WallsResult, 'model'> = { strokes: [], start: null, goal: null };
    try { out = parseWalls(extractJson(text)); } catch { /* reported below */ }
    const u = j.usage;
    console.log(`[vlm] ${mode}: ${j.model} returned ${out.strokes.length} walls in ${Date.now() - t0} ms (tokens in ${u?.prompt_tokens ?? '?'}, out ${u?.completion_tokens ?? '?'}, cost $${u?.cost ?? '?'})`);
    if (out.strokes.length >= 3) return { ...out, model: j.model ?? cfg.model };
    console.warn(`[vlm] ${mode}: too few walls, raw reply was: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
    if (nudge) break; // already nudged once
    nudge = 'Your previous answer listed no walls, but the picture clearly contains black wall lines. Trace every one of them.';
  }
  throw new Error('the model returned no usable walls');
}
