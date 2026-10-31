/**
 * Headless end-to-end check: boots the server with MOCK_VLM=1, connects two WebSocket clients,
 * runs the full flow (create, join, invalid maze, valid mazes, theme, ready, swap, countdown,
 * progress, a too-fast finish that must be rejected, a real finish) and asserts the right winner.
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { SAMPLES } from '../shared/samples';
import type { ServerMsg, ClientMsg } from '../shared/protocol';
import { MAX_SPEED_UNITS_S } from '../shared/constants';

const PORT = 3999;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ✓', msg);
}

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  waiters: Array<{ pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }> = [];
  constructor(public name: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  wait<T extends ServerMsg['type']>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, timeout = 8000): Promise<Extract<ServerMsg, { type: T }>> {
    const found = this.msgs.find((m) => m.type === type && pred(m as any));
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found as any); }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: timeout waiting for ${type}`)), timeout);
      this.waiters.push({ pred: (m) => m.type === type && pred(m as any), res: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m as any); } });
    });
  }
}

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), MOCK_VLM: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('server did not start')), 15000);
      server.stdout!.on('data', (d) => { if (String(d).includes('DoodleMaze Duel on port')) { clearTimeout(t); res(); } });
    });
    console.log('sim: server up');
    const a = new Client('Alice');
    const b = new Client('Bob');
    await Promise.all([a.open(), b.open()]);

    a.send({ type: 'create_room', name: 'Alice', buildTimeS: 0 });
    const wa = await a.wait('welcome');
    assert(/^[A-HJ-NP-Z]{4}$/.test(wa.code), `room code ${wa.code} is 4 letters without I/O`);
    b.send({ type: 'join_room', code: wa.code.toLowerCase(), name: 'Bob' });
    const wb = await b.wait('welcome');
    await a.wait('room_state', (m) => m.phase === 'BUILD');
    assert(true, 'both players in, room moved to BUILD');

    // invalid maze is rejected with a reason
    b.send({ type: 'submit_maze', strokes: [[{ x: 12, y: 500 }, { x: 988, y: 500 }], [{ x: 300, y: 100 }, { x: 300, y: 450 }]], start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } });
    const rej = await b.wait('maze_rejected');
    assert(rej.errors.some((e) => e.code === 'UNSOLVABLE'), 'unsolvable maze rejected by the server');

    const [ma, mb] = [SAMPLES[0], SAMPLES[2]];
    a.send({ type: 'submit_maze', strokes: ma.strokes, start: ma.start, goal: ma.goal });
    b.send({ type: 'submit_maze', strokes: mb.strokes, start: mb.start, goal: mb.goal });
    await a.wait('maze_accepted');
    await b.wait('maze_accepted');
    const ta = await a.wait('theme_ready');
    assert(ta.source === 'vlm' && ta.theme.themeName.length > 0, `Alice themed by mock referee: "${ta.theme.themeName}"`);
    // Bob skips the AI theme
    b.send({ type: 'skip_theme' });
    const tb = await b.wait('theme_ready');
    assert(tb.source === 'skipped' || tb.source === 'vlm', `Bob theme resolved (${tb.source})`);

    a.send({ type: 'ready' });
    b.send({ type: 'ready' });
    const ra = await a.wait('race_assign');
    const rb = await b.wait('race_assign');
    assert(ra.maze.authorName === 'Bob' && rb.maze.authorName === 'Alice', 'mazes swapped');
    const ca = await a.wait('countdown');
    assert(ca.startAt > Date.now(), 'countdown startAt is in the future');
    await sleep(ca.startAt - Date.now() + 100);
    await a.wait('room_state', (m) => m.phase === 'RACING');

    a.send({ type: 'progress', p: 0.4 });
    const op = await b.wait('opponent_progress');
    assert(Math.abs(op.p - 0.4) < 1e-9, 'progress relayed to the opponent');

    // Bob tries to finish instantly: rejected by the sanity check
    b.send({ type: 'finish', elapsedMs: 50 });
    const err = await b.wait('error');
    assert(err.code === 'TOO_FAST', 'impossibly fast finish rejected');

    const minMs = (ra.maze.shortestUnits / (MAX_SPEED_UNITS_S * 1.1)) * 1000;
    const wait = Math.max(0, minMs - (Date.now() - ca.startAt)) + 200;
    console.log(`  … waiting ${Math.round(wait)} ms so a finish is physically possible`);
    await sleep(wait);
    a.send({ type: 'finish', elapsedMs: Date.now() - ca.startAt });
    const res = await b.wait('race_result');
    const resA = await a.wait('race_result');
    assert(res.winnerId === wa.playerId && resA.winnerId === wa.playerId, 'Alice declared winner on both clients');
    assert(res.reason === 'finish', 'reason is finish');
    const alice = res.players.find((p) => p.id === wa.playerId)!;
    assert(alice.pace !== null && alice.pace > 0, `pace computed (${alice.pace} ms/unit)`);

    // rematch goes back to BUILD
    b.send({ type: 'rematch' });
    await a.wait('room_state', (m) => m.phase === 'BUILD');
    assert(true, 'rematch returns to BUILD');

    // forfeit: Bob leaves during build, Alice wins by forfeit
    b.send({ type: 'leave' });
    const ff = await a.wait('race_result');
    assert(ff.reason === 'forfeit' && ff.winnerId === wa.playerId, 'leaving mid-game is a forfeit');
    void wb;
    console.log('\nsim: ALL CHECKS PASSED');
    a.ws.close();
    b.ws.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('\nsim: FAILED', e);
  process.exit(1);
});
