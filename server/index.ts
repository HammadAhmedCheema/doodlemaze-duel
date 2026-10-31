import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { handleConnection } from './rooms';
import { vlmConfig } from './vlm';
import { checkConfiguredModels } from './vlm/models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get('/api/config', (_req, res) => {
  const c = vlmConfig();
  res.json({ model: c.mock ? 'mock-referee' : c.model, fallbacks: c.mock ? [] : c.fallbacks, mock: c.mock });
});

const clientDir = path.resolve(__dirname, '../dist/client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Client not built. Run <code>npm run build</code>, or use <code>npm run dev</code> and open port 5173.'));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1_100_000 });
wss.on('connection', handleConnection);

server.listen(PORT, '0.0.0.0', () => {
  const c = vlmConfig();
  console.log(`\n  DoodleMaze Duel on port ${PORT}`);
  console.log(`  Local:  http://localhost:${PORT}`);
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`  LAN:    http://${i.address}:${PORT}   <- open this on the second device`);
  }
  console.log(c.mock ? '  VLM:    MOCK (set OPENROUTER_API_KEY in .env and MOCK_VLM=0 for the real referee)\n' : `  VLM:    ${c.model} (fallbacks: ${c.fallbacks.join(', ') || 'none'})\n`);
  if (!c.mock) checkConfiguredModels().catch(() => {});
});
