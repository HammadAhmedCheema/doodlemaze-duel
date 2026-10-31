import type { MazeInput } from '../types';
import serpentine from './serpentine.json';
import spiral from './spiral.json';
import columns from './columns.json';

export type SampleMaze = MazeInput & { name: string };
export const SAMPLES: SampleMaze[] = [serpentine, spiral, columns] as SampleMaze[];
