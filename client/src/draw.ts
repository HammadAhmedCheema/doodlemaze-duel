import { BORDER_INSET, CANVAS, CELL, GRID, WALL_THICKNESS } from '../../shared/constants';
import { distToSeg, validate, type ValidationResult } from '../../shared/geometry';
import type { MazeInput, Pt, Stroke } from '../../shared/types';
import { h, debugMode } from './ui';
import { marker } from './reveal';

type Tool = 'pen' | 'erase' | 'start' | 'goal';
type Snapshot = { strokes: Stroke[]; start: Pt | null; goal: Pt | null };

export type DrawBoardOpts = {
  onValidated?: (r: ValidationResult | null, input: MazeInput | null) => void;
  initial?: MazeInput;
};

/**
 * The freehand maze editor: pen, stroke eraser, undo/redo, Start/Goal markers,
 * and live validation through the shared geometry module.
 */
export class DrawBoard {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private start: Pt | null = null;
  private goal: Pt | null = null;
  private tool: Tool = 'pen';
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private current: Stroke | null = null;
  private dragging: 'start' | 'goal' | null = null;
  private px = 600; // css size
  private showGrid = true;
  showCleaned = false;
  private result: ValidationResult | null = null;
  private timer: number | undefined;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private ro: ResizeObserver;
  locked = false;

  constructor(private opts: DrawBoardOpts = {}) {
    this.canvas = h('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.el = h('div', { class: 'canvas-wrap' }, this.canvas);
    if (opts.initial) this.load(opts.initial);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    window.addEventListener('keydown', this.onKey);
  }

  mount() {
    this.ro.observe(this.el.parentElement ?? this.el);
    this.resize();
  }

  destroy() {
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    clearTimeout(this.timer);
  }

  /** Toolbar with the editing tools, wired to this board. */
  toolbar(): HTMLElement {
    const tb = (t: Tool, label: string, title: string) => {
      const b = h('button', { class: 'small', title, onclick: () => this.setTool(t) }, label);
      this.toolButtons.set(t, b);
      return b;
    };
    const bar = h(
      'div',
      { class: 'toolbar' },
      tb('pen', '✎ Pen', 'Draw walls (P)'),
      tb('erase', '⌫ Eraser', 'Click a stroke to remove it (E)'),
      tb('start', '● Start', 'Place the Start point (S)'),
      tb('goal', '⚑ Goal', 'Place the Goal point (G)'),
      h('button', { class: 'small', title: 'Undo (Ctrl+Z)', onclick: () => this.undo() }, '↶ Undo'),
      h('button', { class: 'small', title: 'Redo (Ctrl+Y)', onclick: () => this.redo() }, '↷ Redo'),
      h('button', { class: 'small', title: 'Clear everything', onclick: () => this.clear() }, '✕ Clear'),
    );
    this.setTool(this.tool);
    return bar;
  }

  toggles(): HTMLElement {
    const grid = h('button', { class: 'small on', onclick: () => { this.showGrid = !this.showGrid; grid.classList.toggle('on', this.showGrid); this.render(); } }, '# Grid');
    const clean = h('button', { class: 'small', onclick: () => { this.showCleaned = !this.showCleaned; clean.classList.toggle('on', this.showCleaned); this.render(); } }, '✓ Show cleaned walls');
    return h('div', { class: 'toolbar' }, grid, clean);
  }

  setTool(t: Tool) {
    this.tool = t;
    for (const [k, b] of this.toolButtons) b.classList.toggle('on', k === t);
  }

  /** Replace the drawing with a proposal (AI or tracer). Undo brings the old drawing back. Null start/goal keeps the current ones. */
  applyProposal(strokes: Stroke[], start: Pt | null, goal: Pt | null) {
    this.pushHistory();
    this.strokes = strokes.map((s) => s.map((p) => ({ ...p })));
    if (start) this.start = { ...start };
    if (goal) this.goal = { ...goal };
    this.changed();
  }

  get raw() {
    return { strokes: this.strokes, start: this.start, goal: this.goal };
  }

  getInput(): MazeInput | null {
    if (!this.start || !this.goal) return null;
    return { strokes: this.strokes, start: this.start, goal: this.goal };
  }

  get validation() {
    return this.result;
  }

  load(m: MazeInput) {
    this.strokes = m.strokes.map((s) => s.map((p) => ({ ...p })));
    this.start = { ...m.start };
    this.goal = { ...m.goal };
    this.changed();
  }

  // ---------- history ----------
  private snapshot(): Snapshot {
    return { strokes: this.strokes.slice(), start: this.start && { ...this.start }, goal: this.goal && { ...this.goal } };
  }
  private pushHistory() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }
  private restore(s: Snapshot) {
    this.strokes = s.strokes;
    this.start = s.start;
    this.goal = s.goal;
    this.changed();
  }
  undo() {
    if (this.locked) return;
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }
  redo() {
    if (this.locked) return;
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }
  clear() {
    if (this.locked) return;
    this.pushHistory();
    this.strokes = [];
    this.start = null;
    this.goal = null;
    this.changed();
  }

  // ---------- input ----------
  private toLogical(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CANVAS;
    const y = ((e.clientY - r.top) / r.height) * CANVAS;
    return { x: Math.max(0, Math.min(CANVAS, x)), y: Math.max(0, Math.min(CANVAS, y)) };
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || !this.el.isConnected || this.locked) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); return; }
    const map: Record<string, Tool> = { p: 'pen', e: 'erase', s: 'start', g: 'goal' };
    const t = map[e.key.toLowerCase()];
    if (t && !e.ctrlKey && !e.metaKey) this.setTool(t);
  };

  private onDown = (e: PointerEvent) => {
    if (this.locked) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toLogical(e);
    // dragging an existing marker works with any tool
    const near = (q: Pt | null) => q && Math.hypot(q.x - p.x, q.y - p.y) < 30;
    if (near(this.start)) { this.pushHistory(); this.dragging = 'start'; return; }
    if (near(this.goal)) { this.pushHistory(); this.dragging = 'goal'; return; }
    if (this.tool === 'start' || this.tool === 'goal') {
      this.pushHistory();
      this[this.tool] = p;
      this.dragging = this.tool;
      // after placing Start, move on to Goal; after Goal, back to the pen
      if (this.tool === 'start' && !this.goal) this.setTool('goal');
      else if (this.tool === 'goal' || (this.tool === 'start' && this.goal)) this.setTool('pen');
      this.changed();
      return;
    }
    if (this.tool === 'erase') {
      this.eraseAt(p);
      return;
    }
    this.current = [p];
    this.render();
  };

  private onMove = (e: PointerEvent) => {
    if (this.locked) return;
    if (this.dragging) {
      this[this.dragging] = this.toLogical(e);
      this.changed(true);
      return;
    }
    if (this.tool === 'erase' && e.buttons) { this.eraseAt(this.toLogical(e)); return; }
    if (!this.current) return;
    const events = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined;
    for (const ev of events && events.length ? events : [e]) {
      const p = this.toLogical(ev);
      const last = this.current[this.current.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) this.current.push(p);
    }
    this.render();
  };

  private onUp = () => {
    if (this.dragging) {
      this.dragging = null;
      this.changed();
      return;
    }
    if (!this.current) return;
    const s = this.current;
    this.current = null;
    if (s.length >= 2) {
      this.pushHistory();
      this.strokes = [...this.strokes, s];
      this.changed();
    } else this.render();
  };

  private eraseAt(p: Pt) {
    let best = -1;
    let bestD = 18;
    this.strokes.forEach((s, i) => {
      for (let k = 1; k < s.length; k++) {
        const d = distToSeg(p.x, p.y, { x1: s[k - 1].x, y1: s[k - 1].y, x2: s[k].x, y2: s[k].y });
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    if (best >= 0) {
      this.pushHistory();
      this.strokes = this.strokes.filter((_, i) => i !== best);
      this.changed();
    }
  }

  // ---------- validation ----------
  private changed(fast = false) {
    this.render();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.runValidation(), fast ? 120 : 300);
  }

  runValidation() {
    const input = this.getInput();
    if (!input) {
      this.result = null;
      this.opts.onValidated?.(null, null);
      this.render();
      return;
    }
    this.result = validate(input);
    this.opts.onValidated?.(this.result, input);
    this.render();
  }

  // ---------- rendering ----------
  private resize() {
    const parent = this.el.parentElement;
    if (!parent) return;
    const r = parent.getBoundingClientRect();
    const size = Math.max(280, Math.floor(Math.min(r.width, window.innerHeight - 170)));
    this.px = size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const k = this.canvas.width / CANVAS;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS, CANVAS);

    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(139,147,184,0.09)';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      for (let i = 50; i < CANVAS; i += 50) {
        ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS);
        ctx.moveTo(0, i); ctx.lineTo(CANVAS, i);
      }
      ctx.stroke();
    }

    // Start-reachable tint when the maze is not solvable: shows where the leak is (or isn't)
    const r = this.result;
    if (r && !r.ok && r.reachable && r.errors.some((e) => e.code === 'UNSOLVABLE' || e.code === 'TOO_NARROW')) {
      ctx.fillStyle = 'rgba(34,197,94,0.16)';
      for (let i = 0; i < GRID * GRID; i++) if (r.reachable[i]) ctx.fillRect((i % GRID) * CELL, Math.floor(i / GRID) * CELL, CELL + 0.3, CELL + 0.3);
    }

    // border (added automatically)
    ctx.strokeStyle = 'rgba(230,233,245,0.55)';
    ctx.lineWidth = WALL_THICKNESS;
    ctx.strokeRect(BORDER_INSET, BORDER_INSET, CANVAS - 2 * BORDER_INSET, CANVAS - 2 * BORDER_INSET);

    // raw strokes, drawn at true wall thickness (what you draw is what you get in 3D)
    ctx.strokeStyle = this.showCleaned ? 'rgba(230,233,245,0.35)' : '#e6e9f5';
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.current ? [...this.strokes, this.current] : this.strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (const p of s) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    if (this.showCleaned && r) {
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const s of r.segments) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
      ctx.stroke();
      ctx.fillStyle = '#ec4899';
      for (const s of r.segments) for (const p of [[s.x1, s.y1], [s.x2, s.y2]]) { ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 7); ctx.fill(); }
    }

    if (debugMode && r?.solved?.path.length) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      r.solved.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.start) marker(ctx, this.start, '#22c55e', 'S');
    if (this.goal) marker(ctx, this.goal, '#facc15', 'G');

    if (!this.strokes.length && !this.current && !this.start) {
      ctx.fillStyle = 'rgba(139,147,184,0.6)';
      ctx.font = '600 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Draw your walls here', CANVAS / 2, CANVAS / 2 - 20);
      ctx.font = '400 22px system-ui, sans-serif';
      ctx.fillText('then place Start ● and Goal ⚑', CANVAS / 2, CANVAS / 2 + 20);
    }
  }
}
