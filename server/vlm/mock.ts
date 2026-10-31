import { parseTheme, type Theme } from '../../shared/theme';
import { rng } from '../../shared/hash';

const THEMES = [
  { themeName: 'Frozen Catacombs', wallMaterial: 'ice', floorMaterial: 'ice', mood: 'night', palette: { wall: '#9fd8ff', floor: '#1d3557', sky: '#0b1426', accent: '#7df9ff' }, props: ['crystal', 'rock'] },
  { themeName: 'Neon Labyrinth', wallMaterial: 'neon', floorMaterial: 'metal', mood: 'neon', palette: { wall: '#ff2bd6', floor: '#1a1030', sky: '#08020f', accent: '#22d3ee' }, props: ['lantern', 'pillar'] },
  { themeName: 'Overgrown Garden', wallMaterial: 'hedge', floorMaterial: 'grass', mood: 'day', palette: { wall: '#2f6b2f', floor: '#7a9a4a', sky: '#9ad0ff', accent: '#ffd166' }, props: ['tree', 'mushroom'] },
  { themeName: 'Desert Ruins', wallMaterial: 'brick', floorMaterial: 'sand', mood: 'dusk', palette: { wall: '#b5653b', floor: '#d9b77e', sky: '#f4a259', accent: '#ffe066' }, props: ['torch', 'pillar', 'rock'] },
];
const COMMENTS = [
  'Those dead ends look personal. Respect.',
  'A maze with this many corners was clearly drawn by someone who hates their friends.',
  'Clean lines, sneaky detours. The referee approves.',
  'Short and spicy. Blink and you will miss the goal.',
];

/** Deterministic fake referee for offline dev and tests (MOCK_VLM=1). */
export function mockTheme(hash: string, shortestUnits: number): Theme {
  const r = rng(parseInt(hash, 16));
  const t = THEMES[Math.floor(r() * THEMES.length)];
  const score = Math.max(1, Math.min(10, Math.round(shortestUnits / 600 + r() * 2 - 1)));
  return parseTheme(
    {
      isMaze: true,
      contentSafe: true,
      difficulty: score <= 3 ? 'easy' : score <= 6 ? 'medium' : 'hard',
      difficultyScore: score,
      ...t,
      fogDensity: 0.01 + r() * 0.02,
      refereeComment: COMMENTS[Math.floor(r() * COMMENTS.length)] + ' (mock referee)',
    },
    shortestUnits,
  );
}
