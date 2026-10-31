import './style.css';
import QRCode from 'qrcode';
import { BUILD_TIME_S } from '../../shared/constants';
import { validateSegments, type ValidationResult } from '../../shared/geometry';
import type { PlayerView, RaceMaze, ResultPlayer, ServerMsg, Phase, ThemeSource } from '../../shared/protocol';
import { SAMPLES } from '../../shared/samples';
import { defaultTheme, type Theme } from '../../shared/theme';
import type { MazeInput } from '../../shared/types';
import { DrawBoard } from './draw';
import { Net } from './net';
import { Race } from './race';
import { MazeScene } from './render3d/scene';
import { drawMaze } from './reveal';
import { sfx } from './sound';
import { debugMode, fmtTime, h } from './ui';

// ---------------------------------------------------------------- app state
type Mode = 'solo' | 'duel';
const app = {
  mode: 'solo' as Mode,
  name: safeGet(localStorage, 'dmd.name') || '',
  model: 'loading…',
  mock: false,
  playerId: '',
  code: '',
  phase: 'LOBBY' as Phase,
  players: [] as PlayerView[],
  hostId: '',
  buildEndsAt: null as number | null,
  buildTimeS: BUILD_TIME_S,
  myMaze: null as MazeInput | null,
  myTheme: null as { theme: Theme; source: ThemeSource; model?: string } | null,
  myStats: null as ValidationResult['stats'] | null,
  raceMaze: null as RaceMaze | null,
  screen: '' as string,
  cleanup: [] as Array<() => void>,
  onMsg: null as ((m: ServerMsg) => void) | null,
};
const net = new Net();
let netStarted = false;

function safeGet(s: Storage, k: string) { try { return s.getItem(k); } catch { return null; } }
function safeSet(s: Storage, k: string, v: string | null) { try { v === null ? s.removeItem(k) : s.setItem(k, v); } catch { /* storage blocked */ } }

// ---------------------------------------------------------------- shell
const phaseLabel = h('b', {}, 'Home');
const modelLabel = h('code', {}, app.model);
const main = h('main');
const root = document.getElementById('app')!;
root.append(
  h('header', { class: 'top' },
    h('div', { class: 'logo', style: { cursor: 'pointer' }, onclick: () => { if (confirmLeave()) goHome(); } }, h('div', { class: 'mark' }), h('span', { class: 'grad' }, 'DOODLEMAZE'), h('span', {}, 'DUEL')),
    h('div', { class: 'phase-pill' }, phaseLabel)),
  main,
  h('footer', { class: 'bottom' },
    h('span', {}, 'Referee: ', modelLabel, ' (open-weight) via OpenRouter'),
    h('span', {}, 'Hacktoberfest Islamabad 2026 · MIT')),
);

fetch('/api/config').then((r) => r.json()).then((c) => setModel(c.model, c.mock)).catch(() => setModel('offline', true));
function setModel(m: string, mock: boolean) {
  app.model = m;
  app.mock = mock;
  modelLabel.textContent = mock ? `${m} (offline mock)` : m;
}

function show(name: string, el: HTMLElement, phase: string) {
  for (const c of app.cleanup.splice(0)) c();
  app.onMsg = null;
  app.screen = name;
  phaseLabel.textContent = phase;
  el.classList.add('screen');
  main.replaceChildren(el);
}

let errTimer = 0;
function flash(msg: string) {
  document.querySelector('.err-banner')?.remove();
  const b = h('div', { class: 'err-banner' }, msg);
  document.body.append(b);
  clearTimeout(errTimer);
  errTimer = window.setTimeout(() => b.remove(), 4000);
}

function confirmLeave() {
  if (app.mode === 'duel' && app.code) {
    if (!confirm('Leave this room? If a race is on, you forfeit.')) return false;
    net.send({ type: 'leave' });
    clearSession();
  }
  return true;
}

// ---------------------------------------------------------------- networking
function ensureNet() {
  if (netStarted) return;
  netStarted = true;
  net.on(onServer);
  net.onClose = () => {
    if (net.userClosed) return;
    if (app.mode === 'duel' && app.code) flash('Connection lost. Reconnecting…');
    setTimeout(() => {
      net.connect();
      const s = loadSession();
      if (app.mode === 'duel' && s) net.send({ type: 'join_room', code: s.code, name: s.name, token: s.token });
    }, 1500);
  };
  net.connect();
}

type Session = { code: string; token: string; name: string };
function saveSession(s: Session) { safeSet(sessionStorage, 'dmd.session', JSON.stringify(s)); }
function loadSession(): Session | null { try { return JSON.parse(safeGet(sessionStorage, 'dmd.session') || 'null'); } catch { return null; } }
function clearSession() { safeSet(sessionStorage, 'dmd.session', null); app.code = ''; }

function onServer(m: ServerMsg) {
  switch (m.type) {
    case 'welcome':
      app.playerId = m.playerId;
      app.code = m.code;
      app.mode = 'duel';
      setModel(m.model, m.mock);
      saveSession({ code: m.code, token: m.token, name: app.name });
      break;
    case 'room_state': {
      const prev = app.phase;
      app.phase = m.phase;
      app.players = m.players;
      app.hostId = m.hostId;
      app.buildEndsAt = m.buildEndsAt === null ? null : net.toLocal(m.buildEndsAt);
      app.buildTimeS = m.buildTimeS;
      if (m.phase === 'LOBBY' && app.screen !== 'lobby') lobbyScreen();
      else if (m.phase === 'BUILD' && (prev !== 'BUILD' || !['draw', 'theme'].includes(app.screen))) {
        app.myMaze = null;
        app.myTheme = null;
        drawScreen();
      }
      break;
    }
    case 'race_assign':
      app.raceMaze = m.maze;
      break;
    case 'countdown':
      if (app.raceMaze) raceScreen(app.raceMaze, net.toLocal(m.startAt));
      break;
    case 'race_result':
      if (currentRace) {
        const w = m.players.find((p) => p.id === m.winnerId);
        if (m.winnerId !== app.playerId) currentRace.toast(m.reason === 'forfeit' ? 'Opponent left the race' : `${w?.name ?? 'Opponent'} reached the goal first!`);
        currentRace.stop();
        setTimeout(() => resultScreen(m.winnerId, m.reason, m.players), 1800);
      } else resultScreen(m.winnerId, m.reason, m.players);
      break;
    case 'error':
      if (m.code === 'NO_ROOM' || m.code === 'ROOM_FULL') clearSession();
      flash(m.message);
      break;
  }
  app.onMsg?.(m);
}

// ---------------------------------------------------------------- landing
function goHome() {
  app.mode = 'solo';
  landingScreen();
}

function landingScreen() {
  const name = h('input', { type: 'text', placeholder: 'Your name', value: app.name, maxlength: 24 }) as HTMLInputElement;
  const code = h('input', { type: 'text', placeholder: 'CODE', maxlength: 4, style: { textTransform: 'uppercase', letterSpacing: '.3em', width: '130px', textAlign: 'center' } }) as HTMLInputElement;
  const timer = h('select', {},
    ...[[180, '3 min to draw'], [120, '2 min to draw'], [60, '1 min to draw'], [300, '5 min to draw'], [0, 'No timer']].map(([v, l]) => h('option', { value: String(v) }, String(l)))) as HTMLSelectElement;
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) code.value = urlCode.toUpperCase();
  const getName = () => {
    const n = name.value.trim() || `Player ${Math.floor(Math.random() * 90 + 10)}`;
    app.name = n;
    safeSet(localStorage, 'dmd.name', n);
    return n;
  };
  const create = () => {
    ensureNet();
    net.send({ type: 'create_room', name: getName(), buildTimeS: Number(timer.value) });
  };
  const join = () => {
    const c = code.value.trim().toUpperCase();
    if (c.length !== 4) { flash('Room codes have 4 letters.'); code.focus(); return; }
    ensureNet();
    net.send({ type: 'join_room', code: c, name: getName() });
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  const el = h('div', {},
    h('div', { class: 'card glow', style: { width: 'min(620px, 100%)' } },
      h('h1', {}, 'Draw a maze.', h('br'), h('span', { style: { color: 'var(--accent)' } }, 'Race through theirs.')),
      h('p', { class: 'sub' }, 'Each player doodles a maze. Our geometry engine makes it solid and checks it can be solved, an open-weight vision model judges it and designs its 3D look, then you swap and race. First to the goal wins.'),
      h('div', { class: 'stack' },
        name,
        h('div', { class: 'row' }, h('button', { class: 'primary grow', onclick: create }, '＋ Create room'), timer),
        h('div', { class: 'row' }, code, h('button', { class: 'grow', onclick: join }, '→ Join room')),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'ghost grow', onclick: () => { getName(); soloScreen(); } }, '◎ Solo practice'))),
    ),
  );
  show('landing', el, 'Home');
  if (urlCode) name.focus();
}

// ---------------------------------------------------------------- lobby
function lobbyScreen() {
  const url = `${location.origin}/?room=${app.code}`;
  const qr = h('canvas', { style: { width: '150px', height: '150px', borderRadius: '10px', background: '#fff' } }) as HTMLCanvasElement;
  QRCode.toCanvas(qr, url, { width: 150, margin: 1 }).catch(() => qr.remove());
  const list = h('div', { class: 'players' });
  const renderPlayers = () => {
    list.replaceChildren(...app.players.map((p) => h('div', { class: 'player' }, h('span', {}, h('span', { class: `dot ${p.connected ? 'on' : ''}` }), p.name, p.id === app.playerId ? ' (you)' : ''), p.id === app.hostId ? h('span', { class: 'tag accent' }, 'host') : '')));
    if (app.players.length < 2) list.append(h('div', { class: 'player muted' }, h('span', {}, h('span', { class: 'spinner', style: { marginRight: '10px', verticalAlign: 'middle' } }), 'Waiting for an opponent…')));
  };
  renderPlayers();
  const el = h('div', {},
    h('div', { class: 'card glow', style: { width: 'min(620px, 100%)' } },
      h('div', { class: 'muted', style: { textTransform: 'uppercase', letterSpacing: '.14em', fontSize: '12px' } }, 'Room code'),
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
        h('div', { class: 'code-big' }, app.code), qr),
      h('div', { class: 'row', style: { margin: '14px 0' } },
        h('input', { type: 'text', value: url, readonly: true, class: 'grow', onclick: (e: Event) => (e.target as HTMLInputElement).select() }),
        h('button', { onclick: () => navigator.clipboard?.writeText(url).then(() => flash('Link copied')) }, 'Copy link')),
      h('p', { class: 'sub' }, 'On the other device (same Wi-Fi), open the link or scan the code. Drawing starts as soon as both players are in.'),
      list,
      h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'ghost', onclick: () => { net.send({ type: 'leave' }); clearSession(); goHome(); } }, 'Leave room'))),
  );
  show('lobby', el, `Lobby · ${app.code}`);
  app.onMsg = (m) => { if (m.type === 'room_state') renderPlayers(); };
}

// ---------------------------------------------------------------- solo picker
function soloScreen() {
  app.mode = 'solo';
  const cards = SAMPLES.map((s) => {
    const c = h('canvas') as HTMLCanvasElement;
    const v = validateSegments(sanitizeOnce(s), s.start, s.goal);
    drawMaze(c, v.segments, s.start, s.goal, { size: 220 });
    return h('div', { class: 'sample', onclick: () => {
      const theme = { ...defaultTheme(v.stats.shortestUnits), refereeComment: 'A bundled practice maze.' };
      raceScreen({ segments: v.segments, start: s.start, goal: s.goal, theme, shortestUnits: v.stats.shortestUnits, authorName: 'DoodleMaze', themeSource: 'default' });
    } }, c, s.name);
  });
  const el = h('div', {},
    h('div', { class: 'card', style: { width: 'min(820px, 100%)' } },
      h('h2', {}, 'Solo practice'),
      h('p', { class: 'sub' }, 'Run a bundled maze, or draw your own and let the AI referee theme it.'),
      h('div', { class: 'samples' }, ...cards),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', { class: 'primary', onclick: () => { app.myMaze = null; app.myTheme = null; drawScreen(); } }, '✎ Draw my own'),
        h('button', { class: 'ghost', onclick: goHome }, 'Back'))),
  );
  show('solo', el, 'Solo practice');
}
import { sanitize } from '../../shared/geometry';
const sanitizeOnce = (m: MazeInput) => sanitize(m.strokes);

// ---------------------------------------------------------------- draw
function drawScreen() {
  const duel = app.mode === 'duel';
  const status = h('div', { class: 'status' }, 'Draw walls, then place Start and Goal.');
  const submit = h('button', { class: 'primary', disabled: true }, 'Submit maze →') as HTMLButtonElement;
  const timerBar = h('div', { class: 'timerbar' }, h('div', { style: { width: '100%' } }));
  const timerText = h('span', { class: 'muted' });
  const oppLine = h('div', { class: 'muted', style: { fontSize: '13px' } });
  let valid = false;
  const board = new DrawBoard({
    initial: app.myMaze ?? undefined,
    onValidated: (r) => {
      valid = !!r?.ok;
      submit.disabled = !valid;
      if (!r) { status.className = 'status'; status.textContent = 'Place Start ● and Goal ⚑ to check your maze.'; return; }
      if (r.ok) {
        status.className = 'status ok';
        status.textContent = `✓ Solvable. Shortest path about ${Math.round(r.stats.shortestUnits)} units (${r.stats.wallCount} wall pieces, ${r.stats.deadEnds} dead ends).`;
        if (r.warnings.length) status.append(h('div', { class: 'status warn', style: { border: 'none', padding: '6px 0 0', background: 'none' } }, '⚠ ' + r.warnings.map((w) => w.message).join(' ')));
      } else {
        status.className = 'status bad';
        status.replaceChildren(...r.errors.map((e) => h('div', {}, '✕ ' + e.message)));
      }
    },
  });

  const doSubmit = () => {
    const input = board.getInput();
    if (!input || !board.validation?.ok) return;
    app.myMaze = { strokes: input.strokes.map((s) => s.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))), start: input.start, goal: input.goal };
    app.myStats = board.validation.stats;
    app.myTheme = null;
    sfx.click();
    ensureNet();
    net.send({ type: 'submit_maze', ...app.myMaze });
    themeScreen(board.validation);
  };
  submit.onclick = doSubmit;

  const side = h('div', { class: 'stack' },
    h('div', { class: 'card', style: { padding: '16px' } },
      h('h3', {}, duel ? 'Draw a maze for your opponent' : 'Draw your maze'),
      h('p', { class: 'sub', style: { marginBottom: '12px', fontSize: '14px' } }, 'Walls are drawn at real thickness. Small gaps get closed automatically, and the outer border is added for you.'),
      board.toolbar(), h('div', { style: { height: '8px' } }), board.toggles()),
    status,
    duel ? h('div', { class: 'stack', style: { gap: '6px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'muted' }, 'Build timer'), timerText), timerBar) : '',
    submit,
    h('div', { class: 'row' },
      h('button', { class: 'small ghost', onclick: () => { const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)]; board.load(s); } }, '⟳ Load a sample'),
      !duel ? h('button', { class: 'small ghost', onclick: soloScreen }, 'Back') : ''),
    oppLine,
  );
  const canvasCol = h('div', { style: { minWidth: '0', width: '100%' } }, board.el);
  const el = h('div', {}, h('div', { class: 'draw-layout', style: { gridTemplateColumns: 'minmax(0, 1fr) 340px' } }, canvasCol, side));
  show('draw', el, duel ? `Build · ${app.code}` : 'Solo · Draw');
  board.mount();
  app.cleanup.push(() => board.destroy());
  if (app.myMaze) board.runValidation();

  if (duel) {
    let overtime = false;
    let fallbackDone = false;
    const renderOpp = () => {
      const o = app.players.find((p) => p.id !== app.playerId);
      oppLine.textContent = o ? `${o.name}: ${buildLabel(o.build)}` : '';
    };
    renderOpp();
    const tick = window.setInterval(() => {
      if (app.buildEndsAt === null) { timerText.textContent = 'no limit'; return; }
      const left = app.buildEndsAt + (overtime ? 30000 : 0) - performance.now();
      const total = overtime ? 30000 : app.buildTimeS * 1000;
      (timerBar.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, ((overtime ? left : left) / total) * 100))}%`;
      timerBar.classList.toggle('low', left < 20000);
      timerText.textContent = `${overtime ? 'overtime ' : ''}${Math.max(0, Math.ceil(left / 1000))} s`;
      if (left <= 0) {
        if (valid) { autoReady = true; doSubmit(); }
        else if (!overtime) { overtime = true; flash('Time is up! Your maze is not valid yet: 30 seconds of overtime.'); }
        else if (!fallbackDone) {
          fallbackDone = true;
          flash('Out of time. Using a bundled maze instead.');
          board.load(SAMPLES[Math.floor(Math.random() * SAMPLES.length)]);
          board.runValidation();
          autoReady = true;
          doSubmit();
        }
      }
    }, 250);
    app.cleanup.push(() => clearInterval(tick));
    app.onMsg = (m) => { if (m.type === 'room_state') renderOpp(); };
  }
}
let autoReady = false;

function buildLabel(b: PlayerView['build']) {
  return { drawing: 'drawing…', marked: 'fixing their maze…', validated: 'AI referee is judging their maze…', themed: 'maze ready, deciding…', ready: 'READY' }[b];
}

// ---------------------------------------------------------------- theme / waiting
function themeScreen(v: ValidationResult) {
  const duel = app.mode === 'duel';
  const thumb = h('canvas') as HTMLCanvasElement;
  drawMaze(thumb, v.segments, app.myMaze!.start, app.myMaze!.goal, { size: 220, wall: '#e6e9f5' });
  const body = h('div', { class: 'stack' });
  const actions = h('div', { class: 'row' });
  const oppLine = h('div', { class: 'muted', style: { fontSize: '13px' } });
  const card = h('div', { class: 'card glow theme-card' }, body, h('div', { style: { height: '16px' } }), actions, h('div', { style: { height: '10px' } }), oppLine);
  const previewBox = h('div', { style: { width: 'min(520px, 100%)', aspectRatio: '1', borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--line)', position: 'relative', display: 'none' } });
  const el = h('div', {}, h('div', { class: 'row', style: { gap: '24px', alignItems: 'stretch', justifyContent: 'center', width: '100%' } }, card, previewBox));
  show('theme', el, duel ? `Referee · ${app.code}` : 'Solo · Referee');
  let preview: MazeScene | null = null;
  app.cleanup.push(() => preview?.dispose());

  const waiting = () => {
    body.replaceChildren(
      h('div', { class: 'scanner' }, thumb),
      h('h2', { style: { textAlign: 'center' } }, 'The referee is inspecting your maze'),
      h('p', { class: 'sub', style: { textAlign: 'center' } }, h('span', { class: 'spinner', style: { verticalAlign: 'middle', marginRight: '8px' } }), 'Asking ', h('code', { style: { color: 'var(--accent)' } }, app.model), ' to judge difficulty and design a 3D theme…'),
    );
    actions.replaceChildren(
      h('button', { class: 'ghost', onclick: () => { net.send({ type: 'skip_theme' }); if (!duel) themed({ theme: defaultTheme(v.stats.shortestUnits), source: 'skipped' }); } }, 'Skip AI theme'),
      h('button', { class: 'ghost', onclick: () => { net.send({ type: 'skip_theme' }); drawScreen(); } }, '← Edit maze'),
    );
  };

  const themed = (t: { theme: Theme; source: ThemeSource; model?: string }) => {
    app.myTheme = t;
    const th = t.theme;
    const src = t.source === 'vlm' ? `Judged by ${t.model ?? app.model}` : t.source === 'skipped' ? 'AI theme skipped: default look' : 'Referee unavailable: default look';
    body.replaceChildren(
      h('div', { class: 'muted', style: { fontSize: '12px', letterSpacing: '.14em', textTransform: 'uppercase' } }, src),
      h('h1', { style: { fontSize: '36px', marginBottom: '4px' } }, th.themeName),
      h('div', { class: 'row', style: { gap: '18px' } },
        h('span', { class: `diff ${th.difficulty}` }, `${th.difficulty} · ${th.difficultyScore}/10`),
        h('span', { class: 'tag' }, `walls: ${th.wallMaterial}`), h('span', { class: 'tag' }, `floor: ${th.floorMaterial}`), h('span', { class: 'tag' }, `mood: ${th.mood}`)),
      h('div', { class: 'swatches', style: { margin: '6px 0 22px' } }, ...(['wall', 'floor', 'sky', 'accent'] as const).map((k) => h('div', { class: 'swatch', style: { background: th.palette[k] } }, h('span', {}, k)))),
      th.refereeComment ? h('div', { class: 'comment' }, `“${th.refereeComment}”`) : '',
      !th.isMaze ? h('div', { class: 'status warn' }, '🤔 The referee is not convinced this is a maze. The pathfinder says it is, so it counts.') : '',
      th.props.length ? h('div', { class: 'muted', style: { fontSize: '13px' } }, `Props: ${th.props.join(', ')}`) : '',
    );
    if (duel) {
      const ready = h('button', { class: 'primary grow', onclick: () => { sfx.click(); net.send({ type: 'ready' }); ready.disabled = true; ready.textContent = 'Waiting for opponent…'; edit.disabled = true; } }, 'Ready ✓') as HTMLButtonElement;
      const edit = h('button', { class: 'ghost', onclick: drawScreen }, '← Edit maze') as HTMLButtonElement;
      actions.replaceChildren(ready, edit);
      if (autoReady) { autoReady = false; ready.click(); }
    } else {
      actions.replaceChildren(
        h('button', { class: 'primary grow', onclick: () => raceScreen({ segments: v.segments, start: app.myMaze!.start, goal: app.myMaze!.goal, theme: th, shortestUnits: v.stats.shortestUnits, authorName: app.name || 'You', themeSource: t.source, model: t.model }) }, 'Play it in 3D →'),
        h('button', { class: 'ghost', onclick: drawScreen }, '← Edit maze'),
      );
    }
    // creator preview: an orbiting 3D view of your themed maze
    previewBox.style.display = '';
    preview?.dispose();
    try {
      preview = new MazeScene(previewBox, { segments: v.segments, start: app.myMaze!.start, goal: app.myMaze!.goal, theme: th, deadEnds: v.deadEndPts });
      preview.orbit = true;
    } catch { previewBox.style.display = 'none'; }
  };

  const renderOpp = () => {
    if (!duel) return;
    const o = app.players.find((p) => p.id !== app.playerId);
    oppLine.textContent = o ? `${o.name}: ${buildLabel(o.build)}` : '';
  };
  renderOpp();
  if (app.myTheme && !duel) themed(app.myTheme);
  else waiting();

  app.onMsg = (m) => {
    if (m.type === 'theme_ready') themed(m);
    else if (m.type === 'maze_rejected') {
      flash(m.errors.map((e) => e.message).join(' '));
      drawScreen();
    } else if (m.type === 'room_state') renderOpp();
  };
}

// ---------------------------------------------------------------- race
let currentRace: Race | null = null;
function raceScreen(maze: RaceMaze, startAt?: number) {
  const duel = app.mode === 'duel';
  const opp = app.players.find((p) => p.id !== app.playerId);
  let race: Race;
  try {
    race = new Race({
      maze,
      opponentName: duel ? opp?.name ?? 'Opponent' : undefined,
      startAt,
      onProgress: (p) => { if (duel) net.send({ type: 'progress', p }); },
      onFinish: (ms) => {
        if (duel) net.send({ type: 'finish', elapsedMs: ms });
        else setTimeout(() => soloResult(maze, ms), 1400);
      },
      onLeave: () => { if (confirmLeave()) goHome(); },
    });
  } catch (e) {
    flash('Could not start the 3D view: ' + (e as Error).message);
    return;
  }
  race.intro(maze.theme.themeName, `${duel ? `${maze.authorName}'s maze · ` : ''}${maze.theme.difficulty} ${maze.theme.difficultyScore}/10${maze.theme.refereeComment ? ` · “${maze.theme.refereeComment}”` : ''}`);
  const el = h('div', { style: { padding: '0' } }, race.el);
  show('race', el, duel ? `Race · ${app.code}` : 'Solo · Race');
  currentRace = race;
  app.cleanup.push(() => { race.dispose(); currentRace = null; });
  app.onMsg = (m) => {
    if (m.type === 'opponent_progress') race.setOpponentProgress(m.p);
  };
}

// ---------------------------------------------------------------- results
function revealCanvas(m: RaceMaze) {
  const c = h('canvas', { class: 'reveal' }) as HTMLCanvasElement;
  const v = validateSegments(m.segments, m.start, m.goal);
  drawMaze(c, m.segments, m.start, m.goal, { size: 420, path: v.solved?.path, pathColor: m.theme.palette.accent });
  return c;
}

function soloResult(maze: RaceMaze, ms: number) {
  sfx.jingle();
  const el = h('div', {},
    h('div', { class: 'card glow result', style: { width: 'min(640px, 100%)' } },
      h('div', { class: 'banner win' }, `Finished in ${fmtTime(ms)}`),
      h('div', { class: 'stat' }, h('span', {}, 'Maze'), h('b', {}, maze.theme.themeName)),
      h('div', { class: 'stat' }, h('span', {}, 'Shortest path'), h('b', {}, `${maze.shortestUnits} units`)),
      h('div', { class: 'stat' }, h('span', {}, 'Pace (ms per unit, lower is better)'), h('b', {}, (ms / Math.max(1, maze.shortestUnits)).toFixed(2))),
      h('div', { style: { height: '14px' } }), revealCanvas(maze),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', { class: 'primary grow', onclick: () => raceScreen(maze) }, '↻ Run again'),
        h('button', { class: 'ghost', onclick: soloScreen }, 'Other mazes'))),
  );
  show('result', el, 'Solo · Result');
}

function resultScreen(winnerId: string | null, reason: 'finish' | 'forfeit', players: ResultPlayer[]) {
  const won = winnerId === app.playerId;
  const winner = players.find((p) => p.id === winnerId);
  (won ? sfx.jingle : sfx.lose)();
  const banner = reason === 'forfeit' ? (won ? 'Your opponent left. You win!' : 'You forfeited.') : won ? 'You win! 🏆' : `${winner?.name ?? 'Opponent'} wins`;
  const cols = players.map((p) =>
    h('div', { class: 'card', style: { padding: '16px' } },
      h('h3', {}, p.name, p.id === winnerId ? ' 🏆' : '', p.id === app.playerId ? h('span', { class: 'muted' }, ' (you)') : ''),
      h('div', { class: 'stat' }, h('span', {}, 'Time'), h('b', {}, p.elapsedMs !== null ? fmtTime(p.elapsedMs) : 'did not finish')),
      h('div', { class: 'stat' }, h('span', {}, 'Pace (ms/unit)'), h('b', {}, p.pace !== null ? p.pace.toFixed(2) : '–')),
      p.maze ? h('div', { class: 'stat' }, h('span', {}, `Played ${p.maze.authorName}'s maze`), h('b', {}, p.maze.theme.themeName)) : '',
      p.maze ? h('div', { class: 'stat' }, h('span', {}, 'Referee difficulty'), h('b', { class: `diff ${p.maze.theme.difficulty}` }, `${p.maze.theme.difficulty} ${p.maze.theme.difficultyScore}/10`)) : '',
      p.maze?.theme.refereeComment ? h('div', { class: 'comment', style: { fontSize: '14px', margin: '10px 0' } }, `“${p.maze.theme.refereeComment}”`) : '',
      p.maze ? h('div', { style: { marginTop: '10px' } }, revealCanvas(p.maze)) : ''),
  );
  const rematch = h('button', { class: 'primary grow', onclick: () => { net.send({ type: 'rematch' }); rematch.disabled = true; } }, '↻ Rematch') as HTMLButtonElement;
  const el = h('div', {},
    h('div', { class: 'result' },
      h('div', { class: `banner ${won ? 'win' : 'lose'}` }, banner),
      h('p', { class: 'sub', style: { textAlign: 'center' } }, 'First to the goal wins. Pace is time divided by the shortest path length, so you can compare runs on different mazes.'),
      h('div', { class: 'result-grid' }, ...cols),
      h('div', { class: 'row', style: { marginTop: '16px' } }, app.players.length === 2 ? rematch : h('span', { class: 'muted grow' }, 'Your opponent has left the room.'),
        h('button', { class: 'ghost', onclick: () => { net.send({ type: 'leave' }); clearSession(); goHome(); } }, 'Leave'))),
  );
  show('result', el, `Result · ${app.code}`);
}

// ---------------------------------------------------------------- boot
const session = loadSession();
if (session && !new URLSearchParams(location.search).has('fresh')) {
  app.name = session.name;
  app.mode = 'duel';
  ensureNet();
  net.send({ type: 'join_room', code: session.code, name: session.name, token: session.token });
  landingScreen();
} else landingScreen();

if (debugMode) {
  const d = h('div', { class: 'debug', style: { position: 'fixed', bottom: '40px', right: '12px', zIndex: '60', background: 'rgba(0,0,0,.6)', padding: '6px 10px', borderRadius: '8px' } });
  document.body.append(d);
  setInterval(() => { d.textContent = `screen=${app.screen} mode=${app.mode} phase=${app.phase} room=${app.code || '-'} me=${app.players.find((p) => p.id === app.playerId)?.build ?? '-'} ws=${net.open ? 'open' : 'closed'}${currentRace ? ' racing' : ''}`; }, 300);
}
