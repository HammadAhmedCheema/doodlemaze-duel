import { z } from 'zod';

export const WALL_MATERIALS = ['stone', 'brick', 'hedge', 'ice', 'neon', 'wood', 'metal', 'crystal'] as const;
export const FLOOR_MATERIALS = ['stone', 'grass', 'sand', 'ice', 'tiles', 'metal', 'void'] as const;
export const MOODS = ['day', 'dusk', 'night', 'neon'] as const;
export const PROPS = ['torch', 'tree', 'crystal', 'pillar', 'mushroom', 'lantern', 'rock'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type Theme = {
  isMaze: boolean;
  contentSafe: boolean;
  difficulty: Difficulty;
  difficultyScore: number;
  themeName: string;
  wallMaterial: (typeof WALL_MATERIALS)[number];
  floorMaterial: (typeof FLOOR_MATERIALS)[number];
  mood: (typeof MOODS)[number];
  palette: { wall: string; floor: string; sky: string; accent: string };
  fogDensity: number;
  props: Array<(typeof PROPS)[number]>;
  refereeComment: string;
};

export function difficultyFromLength(shortestUnits: number): { difficulty: Difficulty; difficultyScore: number } {
  const score = Math.max(1, Math.min(10, Math.round(shortestUnits / 600)));
  return { difficulty: score <= 3 ? 'easy' : score <= 6 ? 'medium' : 'hard', difficultyScore: score };
}

export function defaultTheme(shortestUnits = 0): Theme {
  return {
    isMaze: true,
    contentSafe: true,
    ...difficultyFromLength(shortestUnits),
    themeName: 'Dusk Stoneworks',
    wallMaterial: 'stone',
    floorMaterial: 'tiles',
    mood: 'dusk',
    palette: { wall: '#8a8f98', floor: '#2b2f3a', sky: '#1b2030', accent: '#ffb703' },
    fogDensity: 0.015,
    props: ['torch'],
    refereeComment: '',
  };
}

const hex = /^#[0-9a-fA-F]{6}$/;

/** Field-by-field schema: an invalid field falls back to its default instead of failing the whole object. */
export function themeSchema(shortestUnits = 0) {
  const d = defaultTheme(shortestUnits);
  const color = (def: string) => z.string().trim().regex(hex).transform((s) => s.toLowerCase()).catch(def);
  return z
    .object({
      isMaze: z.boolean().catch(true),
      contentSafe: z.boolean().catch(true),
      difficulty: z.enum(DIFFICULTIES).catch(d.difficulty),
      difficultyScore: z.coerce.number().transform((n) => Math.max(1, Math.min(10, Math.round(n)))).catch(d.difficultyScore),
      themeName: z.string().trim().min(1).transform((s) => s.slice(0, 40)).catch(d.themeName),
      wallMaterial: z.enum(WALL_MATERIALS).catch(d.wallMaterial),
      floorMaterial: z.enum(FLOOR_MATERIALS).catch(d.floorMaterial),
      mood: z.enum(MOODS).catch(d.mood),
      palette: z
        .object({ wall: color(d.palette.wall), floor: color(d.palette.floor), sky: color(d.palette.sky), accent: color(d.palette.accent) })
        .catch(d.palette),
      fogDensity: z.coerce.number().transform((n) => (Number.isFinite(n) ? Math.max(0, Math.min(0.05, n)) : d.fogDensity)).catch(d.fogDensity),
      props: z
        .array(z.string())
        .transform((a) => [...new Set(a.filter((p): p is Theme['props'][number] => (PROPS as readonly string[]).includes(p)))].slice(0, 4))
        .catch(d.props),
      refereeComment: z.string().trim().transform((s) => s.slice(0, 140)).catch(''),
    })
    .catch(d);
}

/** Parse anything into a valid Theme. Unsafe content gets the default theme and no comment. */
export function parseTheme(raw: unknown, shortestUnits = 0): Theme {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const t = themeSchema(shortestUnits).parse(obj) as Theme;
  if (!t.contentSafe) return { ...defaultTheme(shortestUnits), contentSafe: false, isMaze: t.isMaze };
  return t;
}

// ---- colour helpers (used by the client to keep palettes playable) ----
export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function luminance(h: string): number {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function mix(h: string, target: number, t: number): string {
  const [r, g, b] = hexToRgb(h);
  return rgbToHex([r + (target - r) * t, g + (target - g) * t, b + (target - b) * t]);
}
/** Push `fg` lighter or darker until it has at least `min` contrast against `bg`. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) < 0.25 ? 255 : 0;
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target ? '#ffffff' : '#000000';
}
export function playablePalette(p: Theme['palette']): Theme['palette'] {
  const wall = ensureContrast(p.wall, p.floor, 2.2);
  const accent = ensureContrast(p.accent, wall, 1.8);
  return { ...p, wall, accent };
}
