import { FINISH_RADIUS, GRID, CELL } from '../../shared/constants';
import { validateSegments, distanceField, cellOf } from '../../shared/geometry';
import { Beast, BEAST_CATCH, pickLair } from './game/beast';
import type { Theme } from '../../shared/theme';
import type { Pt, Seg } from '../../shared/types';
import { Controls, Physics } from './game/physics';
import { MazeScene } from './render3d/scene';
import { h, fmtTime, debugMode } from './ui';
import { sfx } from './sound';

export type RaceOpts = {
  maze: { segments: Seg[]; start: Pt; goal: Pt; theme: Theme; authorName?: string; beast?: boolean };
  allowTopView?: boolean;
  opponentName?: string;
  startAt?: number; // local performance-clock ms when control starts; default: 3.5 s from now
  onProgress?: (p: number) => void;
  onFinish?: (elapsedMs: number) => void;
  onLeave?: () => void;
};

/** One run through a maze in first person: scene, controls, collision, HUD, countdown, finish. */
export class Race {
  readonly el: HTMLDivElement;
  private scene: MazeScene;
  private controls: Controls;
  private physics: Physics;
  private dist: Float32Array;
  private startDist: number;
  private progress = 0;
  private startAt: number;
  private finishedAt: number | null = null;
  private stopped = false;
  private lastSent = 0;
  private lastCount = -1;
  private beast: Beast | null = null;
  private catches = 0;
  private lastGrowl = 0;
  private vignette: HTMLElement;
  private viewLabel: HTMLElement;
  private ui: {
    clock: HTMLElement; me: HTMLElement; mePct: HTMLElement; opp?: HTMLElement; oppPct?: HTMLElement;
    center: HTMLElement; debug: HTMLElement; toast: HTMLElement;
  };

  constructor(private opts: RaceOpts) {
    const m = opts.maze;
    const v = validateSegments(m.segments, m.start, m.goal);
    if (!v.solved || !v.solved.solvable) throw new Error('Race maze is not solvable');
    this.dist = v.solved.distFromGoal;
    this.startDist = v.solved.shortestUnits || 1;
    const path = v.solved.path;
    const look = path[Math.min(8, path.length - 1)] ?? m.goal;
    const angle = Math.atan2(look.y - m.start.y, look.x - m.start.x);

    this.el = h('div', { class: 'race' });
    this.scene = new MazeScene(this.el, { ...m, deadEnds: v.deadEndPts, path: debugMode ? path : undefined });
    this.physics = new Physics(m.segments, { x: m.start.x, y: m.start.y, angle });
    this.controls = new Controls(this.el);
    this.startAt = opts.startAt ?? performance.now() + 3500;
    if (m.beast) {
      const lair = pickLair(v.deadEndPts, distanceField(v.grid, cellOf(m.start)), m.start, m.goal);
      this.beast = new Beast(v.grid, lair, this.startAt);
    }
    this.vignette = h('div', { class: 'vignette' });
    this.viewLabel = h('span', {}, 'first-person');
    const views: Array<'first' | 'third' | 'top'> = opts.allowTopView ? ['first', 'third', 'top'] : ['first', 'third'];
    const cycle = () => {
      this.scene.view = views[(views.indexOf(this.scene.view) + 1) % views.length];
      this.viewLabel.textContent = { first: 'first-person', third: 'third-person', top: 'overhead' }[this.scene.view];
    };
    const onV = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'v') cycle(); };
    window.addEventListener('keydown', onV);
    this.viewCleanup = () => window.removeEventListener('keydown', onV);
    this.cycleView = cycle;

    const clock = h('div', { class: 'clock' }, '0:00.00');
    const me = h('div');
    const mePct = h('span', {}, '0%');
    const center = h('div', { class: 'overlay-center' });
    const debug = h('div', { class: 'debug' });
    const toast = h('div', { class: 'toast', style: { display: 'none' } });
    let opp: HTMLElement | undefined, oppPct: HTMLElement | undefined;
    const tl = h('div', { class: 'tl' },
      h('div', { class: 'pane' }, clock,
        h('div', { class: 'plabel' }, h('span', {}, 'You'), mePct), h('div', { class: 'pbar' }, me)),
    );
    if (opts.opponentName) {
      opp = h('div');
      oppPct = h('span', {}, '0%');
      tl.firstElementChild!.append(h('div', { style: { height: '8px' } }), h('div', { class: 'plabel' }, h('span', {}, opts.opponentName), oppPct), h('div', { class: 'pbar opp' }, opp));
    }
    const tr = h('div', { class: 'tr' },
      h('div', { class: 'pane', style: { textAlign: 'right' } },
        h('div', { style: { fontWeight: '800' } }, m.theme.themeName),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, `${m.theme.mood} · ${m.theme.difficulty} ${m.theme.difficultyScore}/10${m.authorName ? ` · by ${m.authorName}` : ''}`)),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'small', title: 'Switch camera (V)', onclick: () => this.cycleView() }, '🎥 ', this.viewLabel),
        h('button', { class: 'small', onclick: () => opts.onLeave?.() }, 'Leave')),
      m.beast ? h('div', { class: 'pane beast-pane' }, '👹 A beast hunts this maze') : '',
    );
    const bl = h('div', { class: 'bl' }, h('div', { class: 'pane muted', style: { fontSize: '12px' } },
      h('span', { class: 'kbd' }, 'W/S'), ' move  ', h('span', { class: 'kbd' }, 'A/D'), ' turn  ', h('span', { class: 'kbd' }, 'Q/E'), ' strafe  ', h('span', { class: 'kbd' }, 'V'), ' camera  · click for mouse look'), debug);
    this.el.append(this.vignette, h('div', { class: 'hud' }, tl, tr, bl, h('div', { class: 'crosshair' }), toast), center);
    this.ui = { clock, me, mePct, opp, oppPct, center, debug, toast };

    this.scene.onFrame = (dt, now) => this.frame(dt, now);
    if (debugMode) {
      // debug-only shortcut for testing and screenshots: T jumps next to the goal (the server still enforces the speed check)
      const near = path[Math.max(0, path.length - 3)];
      const onKey = (e: KeyboardEvent) => { if (e.key === 't' && near) Object.assign(this.physics.state, { x: near.x, y: near.y }); };
      window.addEventListener('keydown', onKey);
      this.debugCleanup = () => window.removeEventListener('keydown', onKey);
    }
  }

  setOpponentProgress(p: number) {
    if (!this.ui.opp) return;
    this.ui.opp.style.width = `${Math.round(p * 100)}%`;
    this.ui.oppPct!.textContent = `${Math.round(p * 100)}%`;
  }

  toast(msg: string) {
    this.ui.toast.textContent = msg;
    this.ui.toast.style.display = '';
  }

  /** Show the intro card (opponent theme) above the countdown. */
  intro(title: string, sub: string) {
    this.introEl = h('div', { class: 'intro' }, h('div', { class: 'muted', style: { fontSize: '12px', letterSpacing: '.14em', textTransform: 'uppercase' } }, 'Entering'), h('div', { style: { fontSize: '30px', fontWeight: '900' } }, title), h('div', { class: 'muted' }, sub));
  }
  private introEl: HTMLElement | null = null;
  private debugCleanup?: () => void;
  private viewCleanup?: () => void;
  private cycleView: () => void = () => {};

  private frame(dt: number, now: number) {
    if (this.stopped) return;
    const until = this.startAt - now;
    if (until > 0) {
      const n = Math.ceil(until / 1000);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.ui.center.replaceChildren(...(this.introEl ? [this.introEl] : []), h('div', { class: 'countnum' }, n > 3 ? '' : String(n)));
        if (n <= 3) sfx.beep(440, 0.12);
      }
      this.scene.setPlayer(this.physics.state.x, this.physics.state.y, this.physics.state.angle);
      if (this.beast) this.scene.setBeast({ x: this.beast.x, y: this.beast.y, angle: this.beast.angle, awake: false });
      return;
    }
    if (this.lastCount !== 0) {
      this.lastCount = 0;
      this.controls.enabled = true;
      sfx.beep(880, 0.25);
      this.ui.center.replaceChildren(h('div', { class: 'countnum' }, 'GO!'));
      setTimeout(() => { if (this.lastCount === 0 && !this.finishedAt) this.ui.center.replaceChildren(); }, 700);
    }
    if (this.finishedAt === null) {
      this.physics.update(dt, this.controls.read());
      const s = this.physics.state;
      this.scene.setPlayer(s.x, s.y, s.angle);
      const cx = Math.min(GRID - 1, Math.max(0, Math.floor(s.x / CELL)));
      const cy = Math.min(GRID - 1, Math.max(0, Math.floor(s.y / CELL)));
      const d = this.dist[cy * GRID + cx];
      if (Number.isFinite(d)) this.progress = Math.max(0, Math.min(1, 1 - d / this.startDist));
      const elapsed = now - this.startAt;
      if (this.beast) this.updateBeast(dt, now);
      this.ui.clock.textContent = fmtTime(elapsed);
      this.ui.me.style.width = `${Math.round(this.progress * 100)}%`;
      this.ui.mePct.textContent = `${Math.round(this.progress * 100)}%`;
      if (now - this.lastSent > 100) {
        this.lastSent = now;
        this.opts.onProgress?.(this.progress);
      }
      if (Math.hypot(s.x - this.opts.maze.goal.x, s.y - this.opts.maze.goal.y) < FINISH_RADIUS) {
        this.finishedAt = now;
        this.controls.enabled = false;
        this.ui.me.style.width = '100%';
        this.ui.mePct.textContent = '100%';
        sfx.jingle();
        this.ui.center.replaceChildren(h('div', { class: 'countnum', style: { fontSize: '90px' } }, 'FINISHED'), h('div', { class: 'clock', style: { fontSize: '40px', fontWeight: '900' } }, fmtTime(elapsed)));
        this.opts.onProgress?.(1);
        this.opts.onFinish?.(Math.round(elapsed));
      }
    }
    if (debugMode) this.ui.debug.textContent = `fps ${this.scene.fps} · x ${this.physics.state.x.toFixed(0)} y ${this.physics.state.y.toFixed(0)} · p ${(this.progress * 100).toFixed(1)}%`;
  }

  private updateBeast(dt: number, now: number) {
    const b = this.beast!;
    const s = this.physics.state;
    const wasAwake = b.awake;
    const d = b.update(dt, now, s);
    this.scene.setBeast({ x: b.x, y: b.y, angle: b.angle, awake: b.awake });
    if (!wasAwake && b.awake && this.catches === 0 && now - this.startAt < 6000) this.flashToast('👹 The beast is awake!', 1800);
    // fear: red vignette and growls as it gets close
    const fear = b.awake ? Math.max(0, Math.min(1, 1 - (d - 40) / 260)) : 0;
    this.vignette.style.opacity = String(fear * 0.85);
    if (fear > 0.25 && now - this.lastGrowl > 1400 - fear * 900) {
      this.lastGrowl = now;
      sfx.growl(fear);
    }
    if (b.awake && d < BEAST_CATCH) {
      this.catches++;
      sfx.lose();
      Object.assign(s, { x: this.opts.maze.start.x, y: this.opts.maze.start.y });
      this.progress = 0;
      b.reset(now, 3000);
      this.flashToast(`👹 Caught! Back to the start (${this.catches}×)`, 2200);
    }
  }

  private toastTimer = 0;
  private flashToast(msg: string, ms: number) {
    this.toast(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.ui.toast.style.display = 'none'), ms);
  }

  stop() {
    this.stopped = true;
    this.controls.enabled = false;
  }

  dispose() {
    this.debugCleanup?.();
    this.viewCleanup?.();
    clearTimeout(this.toastTimer);
    this.stop();
    this.controls.destroy();
    this.scene.dispose();
    this.el.remove();
  }
}
