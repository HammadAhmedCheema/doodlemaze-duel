/**
 * npm run vlm:test          one theme call on a bundled maze
 * npm run vlm:test -- walls one photo-to-walls call
 * Costs a fraction of a cent. Uses a longer timeout than the game so slow providers still answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
const loaded = fs.existsSync(envPath) ? dotenv.config({ path: envPath, override: true }) : null;
process.env.VLM_TIMEOUT_MS = String(Math.max(40000, Number(process.env.VLM_TIMEOUT_MS) || 0));

const { validate } = await import('../shared/geometry');
const { SAMPLES } = await import('../shared/samples');
const { callOpenRouter } = await import('../server/vlm/openrouter');
const { vlmConfig } = await import('../server/vlm');
const { requestWalls } = await import('../server/vlm/walls');
const { renderMazePng } = await import('../server/vlm/png');

console.log(loaded ? `Settings from ${envPath}` : `No .env found at ${envPath}: copy .env.example to .env and add your key.`);
if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is empty. Put it in .env.');
  process.exit(1);
}
const cfg = vlmConfig();
console.log(`  OPENROUTER_MODEL           = ${cfg.model}${process.env.OPENROUTER_MODEL ? '' : '  (not set in .env, using the default)'}`);
console.log(`  OPENROUTER_FALLBACK_MODELS = ${cfg.fallbacks.join(', ')}${process.env.OPENROUTER_FALLBACK_MODELS ? '' : '  (default)'}`);
console.log(`  MOCK_VLM                   = ${process.env.MOCK_VLM ?? '(unset)'}${process.env.MOCK_VLM === '1' ? '  <- the GAME will use the mock referee; set MOCK_VLM=0' : ''}`);
console.log(`  timeout per try            = ${process.env.VLM_TIMEOUT_MS} ms\n`);

const t0 = Date.now();
try {
  if (process.argv[2] === 'walls') {
    const m = SAMPLES[1];
    const img = 'data:image/png;base64,' + renderMazePng(validate(m).segments, m.start, m.goal).toString('base64');
    console.log(`Asking for the walls of "${m.name}" (the real maze has about 20 wall pieces)…`);
    const r = await requestWalls('photo', img, '', cfg);
    console.log(`\nOK: ${r.model} found ${r.strokes.length} walls in ${Date.now() - t0} ms, start ${JSON.stringify(r.start)}, goal ${JSON.stringify(r.goal)}`);
    console.log(JSON.stringify(r.strokes.slice(0, 8)));
  } else {
    const s = SAMPLES[1];
    const v = validate(s);
    console.log(`Asking for a theme for "${s.name}"…`);
    const r = await callOpenRouter({ segments: v.segments, start: s.start, goal: s.goal, stats: v.stats, warnings: v.warnings }, cfg);
    console.log(`\nOK: answered by ${r.model} in ${Date.now() - t0} ms:\n`);
    console.log(JSON.stringify(r.theme, null, 2));
  }
} catch (e) {
  const err = e as Error;
  const timeout = err.name === 'TimeoutError' || /timeout|time budget/i.test(err.message);
  console.error(`\nFAILED after ${Date.now() - t0} ms: ${err.message}`);
  if (timeout) console.error('The model did not answer in time. Try again (providers have slow moments), or set VLM_TIMEOUT_MS=60000 in .env. In the game, a timeout just falls back to the default theme or the built-in tracer.');
  process.exit(1);
}
