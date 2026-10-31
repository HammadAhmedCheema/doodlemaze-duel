import { defaultTheme, type Theme } from '../../shared/theme';
import type { MazeStats, Issue, WarningCode } from '../../shared/geometry/validate';
import type { Pt, Seg } from '../../shared/types';
import type { ThemeSource } from '../../shared/protocol';
import { hashString } from '../../shared/hash';
import { mockTheme } from './mock';
import { callOpenRouter } from './openrouter';

export type ThemeRequest = { segments: Seg[]; start: Pt; goal: Pt; stats: MazeStats; warnings: Issue<WarningCode>[] };
export type ThemeResult = { theme: Theme; source: ThemeSource; model?: string };

export const vlmConfig = () => ({
  mock: process.env.MOCK_VLM === '1' || !process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it',
  fallbacks: (process.env.OPENROUTER_FALLBACK_MODELS || 'qwen/qwen3-vl-235b-a22b-instruct').split(',').map((s) => s.trim()).filter(Boolean),
});

const cache = new Map<string, ThemeResult>();

export function mazeHash(r: Pick<ThemeRequest, 'segments' | 'start' | 'goal'>) {
  return hashString(JSON.stringify([r.segments, r.start, r.goal]));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); });
  });

/** Get a theme for a validated maze. Never throws: failures resolve to the default theme. */
export async function requestTheme(req: ThemeRequest, signal?: AbortSignal): Promise<ThemeResult> {
  const cfg = vlmConfig();
  const key = mazeHash(req);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    let result: ThemeResult;
    if (cfg.mock) {
      await sleep(800, signal);
      result = { theme: mockTheme(key, req.stats.shortestUnits), source: 'vlm', model: 'mock-referee (MOCK_VLM=1)' };
    } else {
      const r = await callOpenRouter(req, cfg, signal);
      result = { theme: r.theme, source: 'vlm', model: r.model };
    }
    cache.set(key, result);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return result;
  } catch (e) {
    if (signal?.aborted) return { theme: defaultTheme(req.stats.shortestUnits), source: 'skipped' };
    console.warn('[vlm] falling back to default theme:', (e as Error).message);
    return { theme: defaultTheme(req.stats.shortestUnits), source: 'default' };
  }
}
