import * as THREE from 'three';
import type { Theme } from '../../../shared/theme';
import { rng } from '../../../shared/hash';

type Ctx = CanvasRenderingContext2D;
const SIZE = 256;

function canvas(): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!];
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function noise(ctx: Ctx, base: string, amount: number, rand: () => number, dots = 2600, size = 3) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < dots; i++) {
    const f = 1 + (rand() - 0.5) * amount;
    ctx.fillStyle = shade(base, f);
    ctx.globalAlpha = 0.35 + rand() * 0.4;
    const s = 1 + rand() * size;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, s, s);
  }
  ctx.globalAlpha = 1;
}

function bricks(ctx: Ctx, base: string, mortar: string, rand: () => number, rows = 8, cols = 4) {
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const bh = SIZE / rows;
  const bw = SIZE / cols;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let c = -1; c < cols + 1; c++) {
      ctx.fillStyle = shade(base, 0.8 + rand() * 0.4);
      ctx.fillRect(c * bw + off + 3, r * bh + 3, bw - 6, bh - 6);
    }
  }
}

/** Build a procedural texture for a wall or floor material, tinted with the palette color. */
export function makeTexture(kind: string, color: string, seed: number, isFloor: boolean): { tex: THREE.CanvasTexture; emissive?: THREE.CanvasTexture } {
  const rand = rng(seed);
  const [c, ctx] = canvas();
  let emissive: THREE.CanvasTexture | undefined;
  switch (kind) {
    case 'brick':
      bricks(ctx, color, shade(color, 0.45), rand);
      break;
    case 'stone':
      noise(ctx, color, 0.5, rand, 2200, 6);
      if (!isFloor) {
        ctx.strokeStyle = shade(color, 0.55);
        ctx.lineWidth = 3;
        for (let y = 0; y <= SIZE; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke(); }
        for (let y = 0; y < SIZE; y += 64) for (let x = (y / 64) % 2 ? 0 : 48; x < SIZE; x += 96) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 64); ctx.stroke(); }
      }
      break;
    case 'hedge':
    case 'grass':
      noise(ctx, color, 0.8, rand, kind === 'hedge' ? 5000 : 3500, kind === 'hedge' ? 6 : 3);
      break;
    case 'ice':
      noise(ctx, color, 0.15, rand, 800, 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        let x = rand() * SIZE, y = rand() * SIZE;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 5; j++) { x += (rand() - 0.5) * 70; y += (rand() - 0.5) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    case 'wood':
      ctx.fillStyle = color; ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = shade(color, 0.7 + rand() * 0.5);
        ctx.lineWidth = 1 + rand() * 3;
        const y = rand() * SIZE;
        ctx.beginPath(); ctx.moveTo(0, y);
        ctx.bezierCurveTo(SIZE / 3, y + (rand() - 0.5) * 20, (2 * SIZE) / 3, y + (rand() - 0.5) * 20, SIZE, y);
        ctx.stroke();
      }
      ctx.fillStyle = shade(color, 0.4);
      for (let x = 0; x < SIZE; x += 64) ctx.fillRect(x, 0, 2, SIZE);
      break;
    case 'metal':
      noise(ctx, color, 0.12, rand, 1500, 2);
      ctx.strokeStyle = shade(color, 0.6);
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
      ctx.fillStyle = shade(color, 1.35);
      for (const [x, y] of [[16, 16], [SIZE - 16, 16], [16, SIZE - 16], [SIZE - 16, SIZE - 16]]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
      break;
    case 'crystal': {
      ctx.fillStyle = shade(color, 0.6); ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = shade(color, 0.7 + rand() * 0.9);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        const x = rand() * SIZE, y = rand() * SIZE, r = 15 + rand() * 40;
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + rand(); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'neon': {
      ctx.fillStyle = shade(color, 0.18); ctx.fillRect(0, 0, SIZE, SIZE);
      const [ec, ectx] = canvas();
      ectx.fillStyle = '#000'; ectx.fillRect(0, 0, SIZE, SIZE);
      for (const g of [ctx, ectx]) {
        g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, SIZE - 6, SIZE - 6);
        g.lineWidth = 2; g.beginPath(); g.moveTo(0, SIZE / 2); g.lineTo(SIZE, SIZE / 2); g.stroke();
      }
      emissive = new THREE.CanvasTexture(ec);
      break;
    }
    case 'sand':
      noise(ctx, color, 0.25, rand, 6000, 1.5);
      break;
    case 'tiles':
      ctx.fillStyle = shade(color, 0.6); ctx.fillRect(0, 0, SIZE, SIZE);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { ctx.fillStyle = shade(color, 0.85 + rand() * 0.35); ctx.fillRect(x * 64 + 2, y * 64 + 2, 60, 60); }
      break;
    case 'void': {
      ctx.fillStyle = shade(color, 0.5); ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(255,255,255,${rand() * 0.8})`; ctx.fillRect(rand() * SIZE, rand() * SIZE, 1.5, 1.5); }
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
      for (let i = 0; i <= SIZE; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, SIZE); ctx.moveTo(0, i); ctx.lineTo(SIZE, i); ctx.stroke(); }
      break;
    }
    default:
      noise(ctx, color, 0.3, rand);
  }
  const tex = new THREE.CanvasTexture(c);
  for (const t of [tex, emissive]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  return { tex, emissive };
}

export function wallMaterial(theme: Theme, seed: number): THREE.MeshStandardMaterial {
  const { tex, emissive } = makeTexture(theme.wallMaterial, theme.palette.wall, seed, false);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: theme.wallMaterial === 'metal' ? 0.45 : theme.wallMaterial === 'ice' || theme.wallMaterial === 'crystal' ? 0.2 : 0.9, metalness: theme.wallMaterial === 'metal' ? 0.6 : 0 });
  if (emissive) { m.emissiveMap = emissive; m.emissive = new THREE.Color(theme.palette.wall); m.emissiveIntensity = 1.6; }
  if (theme.wallMaterial === 'crystal') { m.emissive = new THREE.Color(theme.palette.wall); m.emissiveIntensity = 0.15; }
  return m;
}

export function floorMaterial(theme: Theme, seed: number): THREE.MeshStandardMaterial {
  const { tex } = makeTexture(theme.floorMaterial, theme.palette.floor, seed + 7, true);
  tex.repeat.set(15, 15);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: theme.floorMaterial === 'ice' || theme.floorMaterial === 'metal' ? 0.35 : 0.95, metalness: theme.floorMaterial === 'metal' ? 0.5 : 0 });
}
