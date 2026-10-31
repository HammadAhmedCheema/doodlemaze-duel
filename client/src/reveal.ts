import type { Pt, Seg } from '../../shared/types';
import { CANVAS, WALL_THICKNESS } from '../../shared/constants';

/** Draw a maze (segments) top-down onto a canvas, with optional path. Used for thumbnails and the result reveal. */
export function drawMaze(
  canvas: HTMLCanvasElement,
  segs: Seg[],
  start: Pt | null,
  goal: Pt | null,
  opts: { path?: Pt[]; wall?: string; bg?: string; pathColor?: string; size?: number } = {},
) {
  const size = opts.size ?? 400;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d')!;
  const k = (size * dpr) / CANVAS;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = opts.bg ?? '#0b1020';
  ctx.fillRect(0, 0, CANVAS, CANVAS);
  ctx.strokeStyle = opts.wall ?? '#e6e9f5';
  ctx.lineWidth = WALL_THICKNESS;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const s of segs) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  if (opts.path && opts.path.length > 1) {
    ctx.strokeStyle = opts.pathColor ?? '#22d3ee';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.setLineDash([16, 10]);
    ctx.beginPath();
    ctx.moveTo(opts.path[0].x, opts.path[0].y);
    for (const p of opts.path) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (start) marker(ctx, start, '#22c55e', 'S');
  if (goal) marker(ctx, goal, '#facc15', 'G');
}

export function marker(ctx: CanvasRenderingContext2D, p: Pt, color: string, label: string, r = 22) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b1020';
  ctx.font = `900 ${r * 1.1}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (label === 'G') {
    // flag icon
    ctx.fillRect(p.x - r * 0.35, p.y - r * 0.55, r * 0.12, r * 1.1);
    ctx.beginPath();
    ctx.moveTo(p.x - r * 0.23, p.y - r * 0.55);
    ctx.lineTo(p.x + r * 0.45, p.y - r * 0.3);
    ctx.lineTo(p.x - r * 0.23, p.y - r * 0.05);
    ctx.fill();
  } else ctx.fillText(label, p.x, p.y + 1);
  ctx.restore();
}
