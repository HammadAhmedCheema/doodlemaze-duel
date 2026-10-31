import { CANVAS, PLAYER_RADIUS, WALK_SPEED_UNITS_S, WALL_THICKNESS } from '../../../shared/constants';
import { closestOnSeg } from '../../../shared/geometry';
import type { Seg } from '../../../shared/types';

export type PlayerState = { x: number; y: number; angle: number };
export type Input = { forward: number; strafe: number; turn: number; lookDelta: number };

const TURN_SPEED = 2.6; // rad/s
const STEP = 1 / 60;
const SUBSTEPS = 3;
const REACH = PLAYER_RADIUS + WALL_THICKNESS / 2;

/** Circle-vs-thick-segment collision in logical units. Fixed 60 Hz step with substeps, slides along walls. */
export class Physics {
  private acc = 0;
  constructor(private segs: Seg[], public state: PlayerState) {}

  update(dt: number, input: Input) {
    this.state.angle += input.lookDelta;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(input);
    }
  }

  private step(input: Input) {
    const s = this.state;
    s.angle += input.turn * TURN_SPEED * STEP;
    const fx = Math.cos(s.angle);
    const fy = Math.sin(s.angle);
    // right vector (screen right) in a y-down plane
    const rx = -fy;
    const ry = fx;
    let vx = fx * input.forward + rx * input.strafe;
    let vy = fy * input.forward + ry * input.strafe;
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    const dx = (vx * WALK_SPEED_UNITS_S * STEP) / SUBSTEPS;
    const dy = (vy * WALK_SPEED_UNITS_S * STEP) / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      s.x += dx;
      s.y += dy;
      this.resolve();
    }
  }

  private resolve() {
    const s = this.state;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const seg of this.segs) {
        // cheap bbox reject
        if (s.x < Math.min(seg.x1, seg.x2) - REACH || s.x > Math.max(seg.x1, seg.x2) + REACH) continue;
        if (s.y < Math.min(seg.y1, seg.y2) - REACH || s.y > Math.max(seg.y1, seg.y2) + REACH) continue;
        const c = closestOnSeg(s.x, s.y, seg);
        if (c.d2 >= REACH * REACH) continue;
        const d = Math.sqrt(c.d2);
        let nx: number, ny: number;
        if (d > 1e-6) { nx = (s.x - c.x) / d; ny = (s.y - c.y) / d; }
        else {
          const L = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1;
          nx = -(seg.y2 - seg.y1) / L; ny = (seg.x2 - seg.x1) / L;
        }
        s.x = c.x + nx * (REACH + 0.01);
        s.y = c.y + ny * (REACH + 0.01);
        moved = true;
      }
      if (!moved) break;
    }
    s.x = Math.max(0, Math.min(CANVAS, s.x));
    s.y = Math.max(0, Math.min(CANVAS, s.y));
  }
}

/** Keyboard + pointer-lock mouse input. */
export class Controls {
  private keys = new Set<string>();
  private look = 0;
  enabled = false;
  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    target.addEventListener('click', this.lock);
    document.addEventListener('mousemove', this.mouse);
  }
  private down = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    this.keys.add(k);
  };
  private up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private clear = () => this.keys.clear();
  private lock = () => { if (this.enabled) this.target.requestPointerLock?.(); };
  private mouse = (e: MouseEvent) => { if (document.pointerLockElement === this.target) this.look += e.movementX * 0.0025; };
  read(): Input {
    const k = this.keys;
    const on = (...n: string[]) => (n.some((x) => k.has(x)) ? 1 : 0);
    const input: Input = {
      forward: on('w', 'arrowup') - on('s', 'arrowdown'),
      turn: on('d', 'arrowright') - on('a', 'arrowleft'),
      strafe: on('e') - on('q'),
      lookDelta: this.look,
    };
    this.look = 0;
    if (!this.enabled) return { forward: 0, turn: 0, strafe: 0, lookDelta: 0 };
    return input;
  }
  destroy() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('mousemove', this.mouse);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
