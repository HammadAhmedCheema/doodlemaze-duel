import type { ThemeRequest } from './index';
import type { Theme } from '../../shared/theme';

/** Placeholder until phase 5: real OpenRouter integration. */
export async function callOpenRouter(_req: ThemeRequest, _cfg: { model: string; fallbacks: string[] }, _signal?: AbortSignal): Promise<{ theme: Theme; model: string }> {
  throw new Error('OpenRouter integration not enabled yet');
}
