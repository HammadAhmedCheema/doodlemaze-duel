import { VLM_TIMEOUT_MS } from '../../shared/constants';
import { DIFFICULTIES, FLOOR_MATERIALS, MOODS, PROPS, WALL_MATERIALS, parseTheme, type Theme } from '../../shared/theme';
import type { ThemeRequest } from './index';
import { renderMazePng } from './png';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export const SYSTEM_PROMPT =
  'You are the referee of a maze-racing game. You receive a clean black-and-white picture of a hand-drawn maze (green disc S = start, red disc G = goal) and a small JSON summary. Judge the maze and design a visual theme for its 3D version. The theme must make walls and floor clearly distinguishable. Respond with a single JSON object matching the schema and nothing else.';

const hex = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: '#rrggbb' };

/** JSON schema sent to the model (strict mode: every property required, no extras). */
export const THEME_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isMaze', 'contentSafe', 'difficulty', 'difficultyScore', 'themeName', 'wallMaterial', 'floorMaterial', 'mood', 'palette', 'fogDensity', 'props', 'refereeComment'],
  properties: {
    isMaze: { type: 'boolean', description: 'does the picture look like a genuine maze' },
    contentSafe: { type: 'boolean', description: 'false if the drawing contains offensive, sexual or hateful imagery' },
    difficulty: { type: 'string', enum: [...DIFFICULTIES] },
    difficultyScore: { type: 'integer', minimum: 1, maximum: 10 },
    themeName: { type: 'string', description: '2-4 words, e.g. "Frozen Catacombs"' },
    wallMaterial: { type: 'string', enum: [...WALL_MATERIALS] },
    floorMaterial: { type: 'string', enum: [...FLOOR_MATERIALS] },
    mood: { type: 'string', enum: [...MOODS] },
    palette: { type: 'object', additionalProperties: false, required: ['wall', 'floor', 'sky', 'accent'], properties: { wall: hex, floor: hex, sky: hex, accent: hex } },
    fogDensity: { type: 'number', minimum: 0, maximum: 0.05 },
    props: { type: 'array', items: { type: 'string', enum: [...PROPS] }, maxItems: 4 },
    refereeComment: { type: 'string', description: 'max 140 chars, playful one-liner about THIS maze' },
  },
} as const;

/** Pull the last JSON object out of a model reply (handles code fences and chatty preambles). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const candidates: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < cleaned.length; j++) {
      const c = cleaned[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { candidates.push(cleaned.slice(i, j + 1)); i = j; break; }
    }
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    try { return JSON.parse(candidates[k]); } catch { /* try previous */ }
  }
  throw new Error('no JSON object in model reply');
}

type Cfg = { model: string; fallbacks: string[] };

async function post(body: object, signal: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/HammadAhmedCheema/doodlemaze-duel',
      'X-Title': 'DoodleMaze Duel',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Ask the open-weight VLM to judge and theme the maze.
 * json_schema first; on a 4xx that looks like a response_format problem, retry once with json_object.
 * One retry for fast transient failures; overall cap ~15 s. Output is always re-validated with zod.
 */
export async function callOpenRouter(req: ThemeRequest, cfg: Cfg, outer?: AbortSignal): Promise<{ theme: Theme; model: string }> {
  const png = renderMazePng(req.segments, req.start, req.goal).toString('base64');
  const summary = { wallCount: req.stats.wallCount, shortestUnits: req.stats.shortestUnits, deadEnds: req.stats.deadEnds, warnings: req.warnings.map((w) => w.code) };
  const base = {
    model: cfg.model,
    models: [cfg.model, ...cfg.fallbacks],
    temperature: 0.4,
    max_tokens: 600,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
          { type: 'text', text: `Summary: ${JSON.stringify(summary)}` },
        ],
      },
    ],
  };
  const deadline = Date.now() + 15_000;
  let format: object = { type: 'json_schema', json_schema: { name: 'maze_theme', strict: true, schema: THEME_JSON_SCHEMA } };
  let switchedFormat = false;
  let retried = false;

  for (;;) {
    const t0 = Date.now();
    const budget = Math.min(VLM_TIMEOUT_MS, deadline - t0);
    if (budget < 1500) throw new Error('VLM time budget exhausted');
    const signals = [AbortSignal.timeout(budget)];
    if (outer) signals.push(outer);
    try {
      const res = await post({ ...base, response_format: format }, AbortSignal.any(signals));
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 300);
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && !switchedFormat) {
          console.warn(`[vlm] ${res.status} with json_schema, retrying with json_object: ${errText}`);
          switchedFormat = true;
          format = { type: 'json_object' };
          continue;
        }
        throw Object.assign(new Error(`OpenRouter ${res.status}: ${errText}`), { fast: Date.now() - t0 < 6000 });
      }
      const j = (await res.json()) as { model?: string; choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: unknown };
      const content = j.choices?.[0]?.message?.content;
      const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content ?? '';
      const theme = parseTheme(extractJson(text), req.stats.shortestUnits);
      console.log(`[vlm] ${j.model ?? cfg.model} -> "${theme.themeName}" (${theme.difficulty} ${theme.difficultyScore}/10) in ${Date.now() - t0} ms`, j.usage ? JSON.stringify(j.usage) : '');
      return { theme, model: j.model ?? cfg.model };
    } catch (e) {
      if (outer?.aborted) throw e;
      const fast = (e as { fast?: boolean }).fast ?? Date.now() - t0 < 6000;
      if (!retried && fast) {
        retried = true;
        console.warn('[vlm] attempt failed fast, retrying once:', (e as Error).message);
        continue;
      }
      throw e;
    }
  }
}
