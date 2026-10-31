/** npm run vlm:test — send ONE bundled maze to the configured OpenRouter model and print the theme. Costs a fraction of a cent. */
import 'dotenv/config';
import { validate } from '../shared/geometry';
import { SAMPLES } from '../shared/samples';
import { callOpenRouter } from '../server/vlm/openrouter';
import { vlmConfig } from '../server/vlm';

if (!process.env.OPENROUTER_API_KEY) {
  console.error('No OPENROUTER_API_KEY in .env. Copy .env.example to .env and add your key.');
  process.exit(1);
}
const cfg = vlmConfig();
const s = SAMPLES[Number(process.argv[2] ?? 1) % SAMPLES.length];
const v = validate(s);
console.log(`Asking ${cfg.model} (fallbacks: ${cfg.fallbacks.join(', ')}) about "${s.name}"…`);
const t0 = Date.now();
const r = await callOpenRouter({ segments: v.segments, start: s.start, goal: s.goal, stats: v.stats, warnings: v.warnings }, cfg);
console.log(`\nAnswered by ${r.model} in ${Date.now() - t0} ms:\n`);
console.log(JSON.stringify(r.theme, null, 2));
