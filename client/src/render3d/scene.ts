import * as THREE from 'three';
import { CANVAS, EYE_HEIGHT_M, WALL_HEIGHT_M, WALL_THICKNESS, WORLD_SCALE } from '../../../shared/constants';
import { playablePalette, type Theme } from '../../../shared/theme';
import { hashString, rng } from '../../../shared/hash';
import type { Pt, Seg } from '../../../shared/types';
import { floorMaterial, wallMaterial } from './materials';

export type SceneMaze = { segments: Seg[]; start: Pt; goal: Pt; theme: Theme; deadEnds?: Pt[]; path?: Pt[] };

const S = WORLD_SCALE;
const H = WALL_HEIGHT_M;
const T = WALL_THICKNESS * S;
export const toWorld = (p: Pt) => new THREE.Vector3((p.x - CANVAS / 2) * S, 0, (p.y - CANVAS / 2) * S);

/** Merge every wall segment into one BufferGeometry (one draw call), with UVs in meters so textures tile evenly. */
export function buildWallGeometry(segs: Seg[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tile = H; // one texture tile per wall height
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], uw: number, vh: number, u0 = 0) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(...n);
    uv.push(u0, 0, u0 + uw, 0, u0 + uw, vh, u0, vh);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const s of segs) {
    const ax = (s.x1 - CANVAS / 2) * S, az = (s.y1 - CANVAS / 2) * S;
    const bx = (s.x2 - CANVAS / 2) * S, bz = (s.y2 - CANVAS / 2) * S;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx;
    const e = T / 2; // extend ends so corners overlap like round caps
    const x0 = ax - dx * e, z0 = az - dz * e, x1 = bx + dx * e, z1 = bz + dz * e;
    const L = len + 2 * e;
    const p = (x: number, z: number, side: number, y: number) => [x + nx * side * (T / 2), y, z + nz * side * (T / 2)];
    const u0 = ((ax * 7.13 + az * 3.71) % 1 + 1) % 1; // break up repetition between walls
    // +n side
    quad(p(x0, z0, 1, 0), p(x1, z1, 1, 0), p(x1, z1, 1, H), p(x0, z0, 1, H), [nx, 0, nz], L / tile, H / tile, u0);
    // -n side (reverse winding)
    quad(p(x1, z1, -1, 0), p(x0, z0, -1, 0), p(x0, z0, -1, H), p(x1, z1, -1, H), [-nx, 0, -nz], L / tile, H / tile, u0);
    // end caps
    quad(p(x0, z0, -1, 0), p(x0, z0, 1, 0), p(x0, z0, 1, H), p(x0, z0, -1, H), [-dx, 0, -dz], T / tile, H / tile);
    quad(p(x1, z1, 1, 0), p(x1, z1, -1, 0), p(x1, z1, -1, H), p(x1, z1, 1, H), [dx, 0, dz], T / tile, H / tile);
    // top
    quad(p(x0, z0, 1, H), p(x1, z1, 1, H), p(x1, z1, -1, H), p(x0, z0, -1, H), [0, 1, 0], L / tile, T / tile);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const MOODS: Record<Theme['mood'], { amb: number; hemi: number; sun: number; sunColor: number; player: number; exposure: number }> = {
  day: { amb: 0.7, hemi: 0.9, sun: 2.2, sunColor: 0xfff4e0, player: 1.5, exposure: 1.0 },
  dusk: { amb: 0.45, hemi: 0.55, sun: 1.3, sunColor: 0xffa860, player: 3, exposure: 1.0 },
  night: { amb: 0.2, hemi: 0.22, sun: 0.3, sunColor: 0x8aa0ff, player: 6, exposure: 1.1 },
  neon: { amb: 0.25, hemi: 0.28, sun: 0.35, sunColor: 0xc084fc, player: 5, exposure: 1.1 },
};

export class MazeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);
  private ro: ResizeObserver;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private goalRing!: THREE.Mesh;
  private beacon!: THREE.Mesh;
  private flames: THREE.Object3D[] = [];
  private playerLight: THREE.PointLight;
  orbit = false;
  private orbitFog = false;
  onFrame?: (dt: number, now: number) => void;
  fps = 0;

  constructor(private container: HTMLElement, maze: SceneMaze) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);

    const theme = { ...maze.theme, palette: playablePalette(maze.theme.palette) };
    const seed = parseInt(hashString(JSON.stringify(maze.segments) + JSON.stringify(maze.start) + JSON.stringify(maze.goal)), 16);
    const mood = MOODS[theme.mood];
    this.renderer.toneMappingExposure = mood.exposure;

    const sky = new THREE.Color(theme.palette.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(sky, Math.max(0.006, theme.fogDensity) * 1.6);

    // lights
    this.scene.add(new THREE.AmbientLight(0xffffff, mood.amb));
    this.scene.add(new THREE.HemisphereLight(sky.clone().lerp(new THREE.Color(0xffffff), 0.5), new THREE.Color(theme.palette.floor), mood.hemi));
    const sun = new THREE.DirectionalLight(mood.sunColor, mood.sun);
    sun.position.set(12, 25, 8);
    this.scene.add(sun);
    this.playerLight = new THREE.PointLight(0xfff1d6, mood.player, 12, 2);
    this.scene.add(this.playerLight);

    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(CANVAS * S, CANVAS * S), floorMaterial(theme, seed));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // walls: one merged geometry, one material, one draw call
    const walls = new THREE.Mesh(buildWallGeometry(maze.segments), wallMaterial(theme, seed));
    this.scene.add(walls);

    // start pad
    const sp = toWorld(maze.start);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 40), new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(sp.x, 0.02, sp.z);
    this.scene.add(pad);

    // goal: tall glowing column, visible above the walls from anywhere, plus a pulsing ring
    const gp = toWorld(maze.goal);
    const accent = new THREE.Color(theme.palette.accent);
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beacon.position.set(gp.x, 7, gp.z);
    this.scene.add(this.beacon);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: accent }));
    core.position.set(gp.x, 1.3, gp.z);
    this.flames.push(core);
    this.scene.add(core);
    this.goalRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 40), new THREE.MeshBasicMaterial({ color: accent, transparent: true, side: THREE.DoubleSide }));
    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.set(gp.x, 0.03, gp.z);
    this.scene.add(this.goalRing);
    const gl = new THREE.PointLight(accent, 8, 8, 1.5);
    gl.position.set(gp.x, 1.6, gp.z);
    this.scene.add(gl);

    this.segs = maze.segments;
    this.addProps(theme, maze.deadEnds ?? [], seed);

    if (maze.path && maze.path.length > 1) {
      const pts = maze.path.map((p) => toWorld(p).setY(0.06));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfacc15 }));
      this.scene.add(line);
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.setPlayer(maze.start.x, maze.start.y, 0);
    this.loop();
  }

  private addProps(theme: Theme, deadEnds: Pt[], seed: number) {
    const kinds = theme.props.length ? theme.props : ['torch' as const];
    const rand = rng(seed ^ 0x9e3779b9);
    const pts = deadEnds.slice().sort(() => rand() - 0.5).slice(0, 14);
    const accent = new THREE.Color(theme.palette.accent);
    const wallC = new THREE.Color(theme.palette.wall);
    let lights = 0;
    const std = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...extra });
    const glow = new THREE.MeshBasicMaterial({ color: accent });
    pts.forEach((p, i) => {
      const kind = kinds[i % kinds.length];
      const g = new THREE.Group();
      const w = toWorld(p);
      g.position.set(w.x, 0, w.z);
      g.rotation.y = rand() * Math.PI * 2;
      let emits = false;
      switch (kind) {
        case 'torch': {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), std(0x5b3a1e));
          pole.position.y = 0.65;
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 10), glow);
          flame.position.y = 1.42;
          this.flames.push(flame);
          g.add(pole, flame);
          emits = true;
          break;
        }
        case 'lantern': {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), std(0x333333, { metalness: 0.6 }));
          pole.position.y = 0.8;
          const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), glow);
          box.position.y = 1.7;
          this.flames.push(box);
          g.add(pole, box);
          emits = true;
          break;
        }
        case 'crystal': {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), std(accent, { emissive: accent, emissiveIntensity: 0.9, roughness: 0.2 }));
          c.scale.y = 2;
          c.position.y = 0.6;
          g.add(c);
          emits = true;
          break;
        }
        case 'tree': {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 8), std(0x6b4423));
          trunk.position.y = 0.4;
          const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 10), std(0x2f7d32));
          top.position.y = 1.3;
          g.add(trunk, top);
          break;
        }
        case 'pillar': {
          const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.1, 12), std(wallC));
          p1.position.y = 1.05;
          g.add(p1);
          break;
        }
        case 'mushroom': {
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 8), std(0xf3e9d2));
          stem.position.y = 0.2;
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(accent, { emissive: accent, emissiveIntensity: 0.4 }));
          cap.position.y = 0.38;
          g.add(stem, cap);
          emits = true;
          break;
        }
        case 'rock': {
          const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3), std(0x777777, { flatShading: true }));
          r.scale.set(1, 0.6, 1.2);
          r.position.y = 0.15;
          g.add(r);
          break;
        }
      }
      if (emits && lights < 4) {
        const l = new THREE.PointLight(accent, 4, 6, 1.6);
        l.position.y = 1.4;
        g.add(l);
        lights++;
      }
      this.scene.add(g);
    });
  }

  /** Camera mode during a race: first-person, third-person chase, or a high overhead view. */
  view: 'first' | 'third' | 'top' = 'first';
  private avatar: THREE.Group | null = null;
  private beast: THREE.Group | null = null;
  private beastEyes: THREE.Object3D[] = [];
  private segs: Seg[] = [];

  private limbs: THREE.Object3D[] = [];
  private walkPhase = 0;
  private lastPos: { x: number; z: number } | null = null;

  /** Blocky toy-style character: box head, torso, arms and legs. Local +x is forward. */
  private ensureAvatar() {
    if (this.avatar) return this.avatar;
    const g = new THREE.Group();
    const accent = new THREE.Color(0x22d3ee);
    const mat = (color: number, glow = 0) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: accent, emissiveIntensity: glow });
    const skin = mat(0xf6c453), shirt = mat(0x22d3ee, 0.25), pants = mat(0x3b4cca), shoe = mat(0x1f2937);
    const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(d, h, w), m);
    // limb hanging from a pivot at its top so it can swing
    const limb = (len: number, thick: number, m: THREE.Material, z: number, y: number, foot?: THREE.Material) => {
      const pivot = new THREE.Group();
      pivot.position.set(0, y, z);
      const part = box(thick, len, thick, m);
      part.position.y = -len / 2;
      pivot.add(part);
      if (foot) { const f = box(thick, 0.08, thick + 0.06, foot); f.position.set(0.03, -len + 0.04, 0); pivot.add(f); }
      g.add(pivot);
      this.limbs.push(pivot);
      return pivot;
    };
    limb(0.5, 0.17, pants, -0.1, 0.5, shoe); // left leg
    limb(0.5, 0.17, pants, 0.1, 0.5, shoe); // right leg
    const torso = box(0.42, 0.44, 0.22, shirt);
    torso.position.y = 0.72;
    limb(0.42, 0.14, skin, -0.29, 0.92); // left arm
    limb(0.42, 0.14, skin, 0.29, 0.92); // right arm
    const head = box(0.3, 0.3, 0.3, skin);
    head.position.y = 1.12;
    const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const face = new THREE.Group();
    for (const z of [-0.07, 0.07]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.04), black); eye.position.set(0.151, 1.15, z); face.add(eye); }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.12), black);
    mouth.position.set(0.151, 1.06, 0);
    face.add(mouth);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(torso, head, face, ring);
    this.scene.add(g);
    this.avatar = g;
    return g;
  }

  /** Swing arms and legs in proportion to distance walked; settle back when standing still. */
  private animateWalk(x: number, z: number) {
    const moved = this.lastPos ? Math.hypot(x - this.lastPos.x, z - this.lastPos.z) : 0;
    this.lastPos = { x, z };
    if (moved > 0.0005 && moved < 1) this.walkPhase += moved * 9;
    const amp = moved > 0.0005 ? 0.6 : 0;
    const [ll, rl, la, ra] = this.limbs;
    const sw = Math.sin(this.walkPhase) * amp;
    const ease = (o: THREE.Object3D, target: number) => { o.rotation.z += (target - o.rotation.z) * 0.35; };
    ease(ll, sw); ease(rl, -sw); ease(la, -sw * 0.8); ease(ra, sw * 0.8);
  }

  /** Distance (logical units) a ray from (x,y) in direction (dx,dy) travels before hitting a wall line, capped at max. */
  private rayToWall(x: number, y: number, dx: number, dy: number, max: number): number {
    let best = max;
    for (const s of this.segs) {
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.x1 - x) * ey - (s.y1 - y) * ex) / den;
      const u = ((s.x1 - x) * dy - (s.y1 - y) * dx) / den;
      if (t > 0 && t < best && u >= -0.02 && u <= 1.02) best = t;
    }
    return best;
  }

  setPlayer(x: number, y: number, angle: number) {
    const w = toWorld({ x, y });
    const fx = Math.cos(angle), fz = Math.sin(angle);
    const avatar = this.view === 'first' ? this.avatar : this.ensureAvatar();
    if (avatar) {
      avatar.visible = this.view !== 'first';
      avatar.position.set(w.x, 0, w.z);
      avatar.rotation.y = -angle;
      if (avatar.visible) this.animateWalk(w.x, w.z);
    }
    if (this.view === 'first') {
      this.camera.position.set(w.x, EYE_HEIGHT_M, w.z);
      this.camera.lookAt(w.x + fx, EYE_HEIGHT_M, w.z + fz);
    } else if (this.view === 'third') {
      // boom behind the player, shortened so it never pokes through a wall
      const want = 2.6 / S;
      const room = this.rayToWall(x, y, -fx, -fz, want) - 12;
      const back = Math.max(0.4 / S, room) * S;
      this.camera.position.set(w.x - fx * back, 2.05, w.z - fz * back);
      this.camera.lookAt(w.x + fx * 1.5, 1.0, w.z + fz * 1.5);
    } else {
      this.camera.position.set(w.x - fx * 3, 13, w.z - fz * 3);
      this.camera.lookAt(w.x + fx * 1.5, 0, w.z + fz * 1.5);
    }
    // a little behind and above the eye, so walls right next to you are lit but not blown out
    this.playerLight.position.set(w.x - fx * 1.2, EYE_HEIGHT_M + 0.9, w.z - fz * 1.2);
  }

  /** The beast: a spiky shadow creature with glowing eyes and its own red light. */
  setBeast(p: { x: number; y: number; angle: number; awake: boolean } | null) {
    if (!p) { if (this.beast) this.beast.visible = false; return; }
    if (!this.beast) {
      const g = new THREE.Group();
      const dark = new THREE.MeshStandardMaterial({ color: 0x14061f, emissive: 0x3b0a45, emissiveIntensity: 0.6, roughness: 0.6, flatShading: true });
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), dark);
      body.position.y = 0.95;
      g.add(body);
      const spikeGeo = new THREE.ConeGeometry(0.09, 0.45, 6);
      for (let i = 0; i < 14; i++) {
        const sp = new THREE.Mesh(spikeGeo, dark);
        const a = (i / 14) * Math.PI * 2, el = ((i % 3) - 1) * 0.6;
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) + 0.2, Math.sin(a) * Math.cos(el)).normalize();
        sp.position.copy(dir.clone().multiplyScalar(0.55)).add(new THREE.Vector3(0, 0.95, 0));
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        g.add(sp);
      }
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), eyeMat);
        eye.position.set(0.48, 1.08, side * 0.17);
        g.add(eye);
        this.beastEyes.push(eye);
      }
      const light = new THREE.PointLight(0xff2244, 5, 7, 1.6);
      light.position.set(0.6, 1.1, 0);
      g.add(light);
      this.scene.add(g);
      this.beast = g;
    }
    const w = toWorld(p);
    const t = performance.now() / 1000;
    this.beast.visible = true;
    this.beast.position.set(w.x, Math.sin(t * 6) * 0.08 + (p.awake ? 0 : -0.4), w.z);
    this.beast.rotation.y = -p.angle;
    this.beast.children[0].rotation.x = t * 1.5;
    for (const e of this.beastEyes) e.visible = p.awake || Math.sin(t * 2) > 0.7;
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const hgt = Math.max(1, r.height);
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  private frames = 0;
  private fpsT = performance.now();
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.onFrame?.(dt, now);
    const t = now / 1000;
    const pulse = 1 + 0.25 * Math.sin(t * 4);
    this.goalRing.scale.set(pulse, pulse, pulse);
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.15 * Math.sin(t * 3);
    for (const f of this.flames) f.rotation.y = t * 2;
    if (this.orbit) {
      const r = 26;
      if (this.scene.fog instanceof THREE.FogExp2 && !this.orbitFog) { this.orbitFog = true; this.scene.fog.density /= 4; }
      this.camera.position.set(Math.cos(t * 0.25) * r, 20, Math.sin(t * 0.25) * r);
      this.camera.lookAt(0, 0, 0);
      this.playerLight.position.set(0, 10, 0);
    }
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (now - this.fpsT > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
