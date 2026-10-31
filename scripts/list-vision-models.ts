/** npm run models:vision — list OpenRouter models that accept images, with pricing, flagging open-weight families. */
import 'dotenv/config';
import { fetchModels, OPEN_WEIGHT } from '../server/vlm/models';

const perM = (s?: string) => (s ? `$${(Number(s) * 1e6).toFixed(2)}/M` : '-');

const models = (await fetchModels()).filter((m) => m.architecture?.input_modalities?.includes('image'));
models.sort((a, b) => Number(OPEN_WEIGHT.test(b.id)) - Number(OPEN_WEIGHT.test(a.id)) || a.id.localeCompare(b.id));
const configured = new Set([process.env.OPENROUTER_MODEL, ...(process.env.OPENROUTER_FALLBACK_MODELS ?? '').split(',')].map((s) => s?.trim()).filter(Boolean));
console.log(`${models.length} vision models on OpenRouter (open-weight families first)\n`);
console.log('open  cfg  model'.padEnd(64) + 'prompt'.padEnd(14) + 'completion');
for (const m of models) {
  const ow = OPEN_WEIGHT.test(m.id) ? ' yes ' : '     ';
  const cfg = configured.has(m.id) ? ' *  ' : '    ';
  const free = m.id.endsWith(':free') ? ' (free: rate-capped, not for the demo)' : '';
  console.log(`${ow} ${cfg} ${m.id}`.padEnd(64) + perM(m.pricing?.prompt).padEnd(14) + perM(m.pricing?.completion) + free);
}
for (const c of configured) if (!models.some((m) => m.id === c)) console.log(`\nWARNING: configured model "${c}" is not a listed vision model.`);
