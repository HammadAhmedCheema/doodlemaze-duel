import { CANVAS, WALL_THICKNESS } from '../../shared/constants';
import type { Pt, Seg } from '../../shared/types';

/** Small top-down map for the HUD: walls drawn once, then player (with heading), goal and beast each frame. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private size: number;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private trail: Pt[] = [];

  constructor(segs: Seg[], private start: Pt, private goal: Pt, size = 190) {
    this.size = size;
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = this.el.height = size * this.dpr;
    this.el.style.width = this.el.style.height = `${size}px`;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = size * this.dpr;
    const ctx = this.base.getContext('2d')!;
    const k = (size * this.dpr) / CANVAS;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = 'rgba(8,10,24,0.9)';
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.strokeStyle = 'rgba(230,233,245,0.85)';
    ctx.lineWidth = WALL_THICKNESS * 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
    ctx.stroke();
  }

  draw(player: { x: number; y: number; angle: number }, beast: { x: number; y: number; awake: boolean } | null) {
    const ctx = this.el.getContext('2d')!;
    const k = (this.size * this.dpr) / CANVAS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - player.x, last.y - player.y) > 12) {
      this.trail.push({ x: player.x, y: player.y });
      if (this.trail.length > 400) this.trail.shift();
    }
    // trail
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    const dot = (p: Pt, r: number, c: string) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); };
    dot(this.start, 18, 'rgba(34,197,94,0.8)');
    const pulse = 26 + Math.sin(performance.now() / 200) * 6;
    dot(this.goal, pulse, 'rgba(250,204,21,0.35)');
    dot(this.goal, 18, '#facc15');
    if (beast) {
      const t = performance.now() / 150;
      dot(beast, beast.awake ? 26 + Math.sin(t) * 4 : 18, beast.awake ? 'rgba(244,63,94,0.35)' : 'rgba(244,63,94,0.15)');
      dot(beast, 16, beast.awake ? '#f43f5e' : '#7f1d2d');
    }
    // player arrow
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.lineTo(-18, 18);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-18, -18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
