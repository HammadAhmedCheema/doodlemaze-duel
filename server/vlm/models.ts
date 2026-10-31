import { vlmConfig } from './index';

export type ModelInfo = { id: string; name: string; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string; completion?: string; image?: string } };

export async function fetchModels(): Promise<ModelInfo[]> {
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`models API ${r.status}`);
  const j = (await r.json()) as { data: ModelInfo[] };
  return j.data;
}

export const OPEN_WEIGHT = /(qwen|gemma|llama|mistral|pixtral|internvl|molmo|glm|deepseek|phi|nemotron|kimi)/i;

/** On boot, warn about configured models that OpenRouter does not list (typos, retired slugs). */
export async function checkConfiguredModels() {
  const cfg = vlmConfig();
  const models = await fetchModels();
  const ids = new Set(models.map((m) => m.id));
  for (const m of [cfg.model, ...cfg.fallbacks]) {
    if (!ids.has(m)) console.warn(`  [vlm] WARNING: model "${m}" is not in the OpenRouter model list. Run npm run models:vision.`);
    else {
      const info = models.find((x) => x.id === m)!;
      if (!info.architecture?.input_modalities?.includes('image')) console.warn(`  [vlm] WARNING: model "${m}" does not accept images.`);
    }
  }
}
