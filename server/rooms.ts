import type { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { BUILD_TIME_S, MAX_POINTS, MAX_SPEED_UNITS_S, MAX_STROKES } from '../shared/constants';
import { validate, type MazeStats, type Issue, type WarningCode } from '../shared/geometry';
import { ClientMsg, type BuildState, type Phase, type PlayerView, type RaceMaze, type ServerMsg, type ThemeSource, type ResultPlayer } from '../shared/protocol';
import { defaultTheme, type Theme } from '../shared/theme';
import type { Pt, Seg } from '../shared/types';
import { requestTheme, vlmConfig } from './vlm';
import { requestWalls } from './vlm/walls';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const MAX_ROOMS = 20;
const GRACE_MS = 20_000;
const ROOM_TTL_MS = 30 * 60_000;
const VLM_PER_ROOM_PER_MIN = 6;

type Maze = { segments: Seg[]; start: Pt; goal: Pt; stats: MazeStats; warnings: Issue<WarningCode>[]; beast: boolean };

type Player = {
  id: string;
  token: string;
  name: string;
  ws: WebSocket | null;
  build: BuildState;
  maze: Maze | null;
  theme: Theme | null;
  themeSource: ThemeSource;
  model?: string;
  abort: AbortController | null;
  progress: number;
  finishedMs: number | null;
  graceTimer: NodeJS.Timeout | null;
  playing: RaceMaze | null; // the opponent's maze this player races
};

type Room = {
  code: string;
  phase: Phase;
  players: Player[];
  hostId: string;
  buildTimeS: number;
  buildEndsAt: number | null;
  startAt: number;
  lastActive: number;
  vlmCalls: number[];
  timers: NodeJS.Timeout[];
};

/** Per-connection context. Players outside a room can still validate + theme a maze (solo practice). */
type Conn = { ws: WebSocket; room: Room | null; player: Player | null; soloAbort: AbortController | null; soloCalls: number[]; wallsBusy?: boolean };

const rooms = new Map<string, Room>();
const id = () => randomBytes(6).toString('hex');

function send(ws: WebSocket | null, m: ServerMsg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

function view(p: Player): PlayerView {
  return { id: p.id, name: p.name, build: p.build, connected: !!p.ws, themeName: p.theme?.themeName, progress: p.progress };
}

function broadcastState(room: Room) {
  room.lastActive = Date.now();
  const m: ServerMsg = { type: 'room_state', code: room.code, phase: room.phase, players: room.players.map(view), buildTimeS: room.buildTimeS, buildEndsAt: room.buildEndsAt, hostId: room.hostId };
  for (const p of room.players) send(p.ws, m);
}

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function newPlayer(name: string, ws: WebSocket): Player {
  return { id: id(), token: randomBytes(16).toString('hex'), name: name.trim().slice(0, 24) || 'Player', ws, build: 'drawing', maze: null, theme: null, themeSource: 'default', abort: null, progress: 0, finishedMs: null, graceTimer: null, playing: null };
}

function welcome(room: Room, p: Player) {
  const cfg = vlmConfig();
  send(p.ws, { type: 'welcome', playerId: p.id, token: p.token, code: room.code, model: cfg.mock ? 'mock-referee' : cfg.model, mock: cfg.mock });
}

function resetForBuild(room: Room) {
  room.timers.forEach(clearTimeout);
  room.timers = [];
  room.phase = 'BUILD';
  room.buildEndsAt = room.buildTimeS > 0 ? Date.now() + room.buildTimeS * 1000 : null;
  for (const p of room.players) {
    p.abort?.abort();
    Object.assign(p, { build: 'drawing', maze: null, theme: null, themeSource: 'default', abort: null, progress: 0, finishedMs: null, playing: null });
  }
}

function canCallVlm(calls: number[]): boolean {
  const now = Date.now();
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= VLM_PER_ROOM_PER_MIN) return false;
  calls.push(now);
  return true;
}

/** Validate on the server (never trust the client). Returns the maze or sends maze_rejected. */
function checkMaze(ws: WebSocket, m: Extract<ClientMsg, { type: 'submit_maze' }>): Maze | null {
  const pts = m.strokes.reduce((a, s) => a + s.length, 0);
  if (m.strokes.length > MAX_STROKES || pts > MAX_POINTS) {
    send(ws, { type: 'error', code: 'TOO_BIG', message: 'That maze has too many strokes. Simplify it a little.' });
    return null;
  }
  const r = validate({ strokes: m.strokes, start: m.start, goal: m.goal });
  if (!r.ok) {
    send(ws, { type: 'maze_rejected', errors: r.errors, warnings: r.warnings });
    return null;
  }
  send(ws, { type: 'maze_accepted', stats: r.stats, warnings: r.warnings });
  return { segments: r.segments, start: m.start, goal: m.goal, stats: r.stats, warnings: r.warnings, beast: !!m.beast };
}

function startTheme(room: Room, p: Player) {
  const maze = p.maze!;
  p.abort?.abort();
  const cfg = vlmConfig();
  if (!canCallVlm(room.vlmCalls)) {
    applyTheme(room, p, { theme: defaultTheme(maze.stats.shortestUnits), source: 'default' });
    return;
  }
  const ac = new AbortController();
  p.abort = ac;
  send(p.ws, { type: 'theme_pending', model: cfg.mock ? 'mock-referee' : cfg.model });
  requestTheme(maze, ac.signal).then((res) => {
    if (ac.signal.aborted || p.abort !== ac || p.maze !== maze) return;
    p.abort = null;
    applyTheme(room, p, res);
  });
}

function applyTheme(room: Room, p: Player, res: { theme: Theme; source: ThemeSource; model?: string }) {
  p.theme = res.theme;
  p.themeSource = res.source;
  p.model = res.model;
  if (p.build === 'validated') p.build = 'themed';
  send(p.ws, { type: 'theme_ready', theme: res.theme, source: res.source, model: res.model });
  broadcastState(room);
}

function raceMazeOf(p: Player): RaceMaze {
  const m = p.maze!;
  return { segments: m.segments, start: m.start, goal: m.goal, theme: p.theme ?? defaultTheme(m.stats.shortestUnits), shortestUnits: m.stats.shortestUnits, authorName: p.name, themeSource: p.themeSource, model: p.model, beast: m.beast };
}

function maybeStartRace(room: Room) {
  if (room.phase !== 'BUILD' || room.players.length !== 2 || !room.players.every((p) => p.build === 'ready')) return;
  const [a, b] = room.players;
  room.phase = 'SWAP';
  a.playing = raceMazeOf(b);
  b.playing = raceMazeOf(a);
  send(a.ws, { type: 'race_assign', maze: a.playing });
  send(b.ws, { type: 'race_assign', maze: b.playing });
  room.phase = 'COUNTDOWN';
  room.startAt = Date.now() + 3500;
  for (const p of room.players) send(p.ws, { type: 'countdown', startAt: room.startAt });
  broadcastState(room);
  room.timers.push(
    setTimeout(() => {
      if (room.phase === 'COUNTDOWN') {
        room.phase = 'RACING';
        broadcastState(room);
      }
    }, 3500),
  );
}

function finishRace(room: Room, winner: Player | null, reason: 'finish' | 'forfeit') {
  room.phase = 'FINISHED';
  room.timers.forEach(clearTimeout);
  room.timers = [];
  const players: ResultPlayer[] = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    elapsedMs: p.finishedMs,
    finished: p.finishedMs !== null,
    pace: p.finishedMs !== null && p.playing ? Math.round((p.finishedMs / Math.max(1, p.playing.shortestUnits)) * 100) / 100 : null,
    maze: p.playing,
  }));
  for (const p of room.players) send(p.ws, { type: 'race_result', winnerId: winner?.id ?? null, reason, players });
  broadcastState(room);
}

function removePlayer(room: Room, p: Player, forfeit: boolean) {
  p.abort?.abort();
  if (p.graceTimer) clearTimeout(p.graceTimer);
  const other = room.players.find((q) => q !== p);
  const inGame = room.phase !== 'LOBBY' && room.phase !== 'FINISHED';
  room.players = room.players.filter((q) => q !== p);
  if (forfeit && inGame && other) {
    room.players.push(p); // keep for the result list
    finishRace(room, other, 'forfeit');
    room.players = room.players.filter((q) => q !== p);
  }
  if (!room.players.length) {
    room.timers.forEach(clearTimeout);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === p.id) room.hostId = room.players[0].id;
  if (room.phase !== 'FINISHED') {
    room.phase = 'LOBBY';
    room.buildEndsAt = null;
    for (const q of room.players) Object.assign(q, { build: 'drawing' });
  }
  broadcastState(room);
}

export function handleConnection(ws: WebSocket) {
  const c: Conn = { ws, room: null, player: null, soloAbort: null, soloCalls: [] };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const raw = data.toString();
    if (raw.length > 1_000_000) return send(ws, { type: 'error', code: 'TOO_BIG', message: 'Payload too large.' });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const r = ClientMsg.safeParse(parsed);
    if (!r.success) return send(ws, { type: 'error', code: 'BAD_MESSAGE', message: 'Malformed message.' });
    try {
      onMessage(c, r.data);
    } catch (e) {
      console.error('[ws] handler error', e);
      send(ws, { type: 'error', code: 'SERVER', message: 'Something went wrong on the server.' });
    }
  });

  ws.on('close', () => {
    c.soloAbort?.abort();
    const { room, player } = c;
    if (!room || !player || player.ws !== ws) return;
    player.ws = null;
    broadcastState(room);
    player.graceTimer = setTimeout(() => {
      if (!player.ws && rooms.get(room.code) === room) removePlayer(room, player, true);
    }, room.phase === 'LOBBY' ? 3000 : GRACE_MS);
  });
}

function onMessage(c: Conn, m: ClientMsg) {
  const { ws } = c;
  if (m.type === 'ping') return send(ws, { type: 'pong', t: m.t, serverNow: Date.now() });

  if (m.type === 'create_room') {
    if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'FULL', message: 'The server is full. Try again in a bit.' });
    if (c.room && c.player) removePlayer(c.room, c.player, true);
    const p = newPlayer(m.name, ws);
    const room: Room = { code: newCode(), phase: 'LOBBY', players: [p], hostId: p.id, buildTimeS: m.buildTimeS ?? BUILD_TIME_S, buildEndsAt: null, startAt: 0, lastActive: Date.now(), vlmCalls: [], timers: [] };
    rooms.set(room.code, room);
    c.room = room;
    c.player = p;
    welcome(room, p);
    return broadcastState(room);
  }

  if (m.type === 'join_room') {
    const room = rooms.get(m.code.toUpperCase().trim());
    if (!room) return send(ws, { type: 'error', code: 'NO_ROOM', message: `No room with code ${m.code.toUpperCase()}. Check the code and try again.` });
    // reconnect with a token
    const back = m.token ? room.players.find((p) => p.token === m.token) : undefined;
    if (back) {
      if (back.graceTimer) clearTimeout(back.graceTimer);
      back.graceTimer = null;
      back.ws = ws;
      c.room = room;
      c.player = back;
      welcome(room, back);
      broadcastState(room);
      if (back.theme && room.phase === 'BUILD') send(ws, { type: 'theme_ready', theme: back.theme, source: back.themeSource, model: back.model });
      if ((room.phase === 'COUNTDOWN' || room.phase === 'RACING') && back.playing) {
        send(ws, { type: 'race_assign', maze: back.playing });
        send(ws, { type: 'countdown', startAt: room.startAt });
      }
      return;
    }
    if (room.players.length >= 2) return send(ws, { type: 'error', code: 'ROOM_FULL', message: 'That room already has two players.' });
    if (c.room && c.player) removePlayer(c.room, c.player, true);
    const p = newPlayer(m.name, ws);
    room.players.push(p);
    c.room = room;
    c.player = p;
    welcome(room, p);
    if (room.players.length === 2 && room.phase === 'LOBBY') resetForBuild(room);
    return broadcastState(room);
  }

  // ---- AI wall extraction (photo upload / doodle clean-up), allowed in and out of rooms ----
  if (m.type === 'ai_walls') {
    const cfg = vlmConfig();
    if (cfg.mock) return send(ws, { type: 'ai_walls_result', ok: false, mode: m.mode, reason: 'The AI referee is offline (mock mode), so this used the built-in tracer instead.' });
    if (c.wallsBusy) return send(ws, { type: 'ai_walls_result', ok: false, mode: m.mode, reason: 'Still working on your last request.' });
    if (!canCallVlm(c.room ? c.room.vlmCalls : c.soloCalls)) return send(ws, { type: 'ai_walls_result', ok: false, mode: m.mode, reason: 'Too many AI requests this minute. Try again shortly.' });
    c.wallsBusy = true;
    requestWalls(m.mode, m.image, m.hint ?? '', cfg)
      .then((r) => send(ws, { type: 'ai_walls_result', ok: true, mode: m.mode, ...r }))
      .catch((e) => { console.warn('[vlm] walls failed:', (e as Error).message); send(ws, { type: 'ai_walls_result', ok: false, mode: m.mode, reason: 'The AI could not read that picture, so this used the built-in tracer instead.' }); })
      .finally(() => { c.wallsBusy = false; });
    return;
  }

  // ---- solo practice: validate + theme without a room ----
  if (!c.room || !c.player) {
    if (m.type === 'submit_maze') {
      const maze = checkMaze(ws, m);
      if (!maze) return;
      c.soloAbort?.abort();
      if (!canCallVlm(c.soloCalls)) {
        send(ws, { type: 'theme_ready', theme: defaultTheme(maze.stats.shortestUnits), source: 'default' });
        return;
      }
      const ac = new AbortController();
      c.soloAbort = ac;
      const cfg = vlmConfig();
      send(ws, { type: 'theme_pending', model: cfg.mock ? 'mock-referee' : cfg.model });
      requestTheme(maze, ac.signal).then((res) => {
        if (c.soloAbort !== ac || ac.signal.aborted) return;
        send(ws, { type: 'theme_ready', ...res });
      });
    } else if (m.type === 'skip_theme') {
      c.soloAbort?.abort();
      c.soloAbort = null;
    }
    return;
  }

  const room = c.room;
  const p = c.player;
  room.lastActive = Date.now();

  switch (m.type) {
    case 'submit_maze': {
      if (room.phase !== 'BUILD' || p.build === 'ready') return send(ws, { type: 'error', code: 'BAD_PHASE', message: 'You cannot change your maze right now.' });
      const maze = checkMaze(ws, m);
      if (!maze) {
        p.build = 'marked';
        return broadcastState(room);
      }
      p.maze = maze;
      p.theme = null;
      p.build = 'validated';
      broadcastState(room);
      return startTheme(room, p);
    }
    case 'skip_theme': {
      if (p.build !== 'validated' || !p.maze) return;
      p.abort?.abort();
      p.abort = null;
      return applyTheme(room, p, { theme: defaultTheme(p.maze.stats.shortestUnits), source: 'skipped' });
    }
    case 'ready': {
      if (room.phase !== 'BUILD' || p.build !== 'themed') return;
      p.build = 'ready';
      broadcastState(room);
      return maybeStartRace(room);
    }
    case 'progress': {
      if (room.phase !== 'RACING' && room.phase !== 'COUNTDOWN') return;
      p.progress = m.p;
      for (const q of room.players) if (q !== p) send(q.ws, { type: 'opponent_progress', p: m.p });
      return;
    }
    case 'finish': {
      if (room.phase !== 'RACING' || !p.playing || p.finishedMs !== null) return;
      const serverElapsed = Date.now() - room.startAt;
      const minMs = (p.playing.shortestUnits / (MAX_SPEED_UNITS_S * 1.1)) * 1000;
      const elapsed = Math.min(m.elapsedMs, serverElapsed + 500);
      if (elapsed < minMs) return send(ws, { type: 'error', code: 'TOO_FAST', message: 'That finish was faster than physically possible. Ignored.' });
      p.finishedMs = Math.round(elapsed);
      p.progress = 1;
      return finishRace(room, p, 'finish');
    }
    case 'rematch': {
      if (room.phase !== 'FINISHED' || room.players.length !== 2) return;
      resetForBuild(room);
      return broadcastState(room);
    }
    case 'leave': {
      c.room = null;
      c.player = null;
      return removePlayer(room, p, true);
    }
  }
}

// clean up idle rooms
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) if (now - r.lastActive > ROOM_TTL_MS && r.players.every((p) => !p.ws)) rooms.delete(r.code);
}, 60_000).unref();

export const _rooms = rooms;
