export type Pt = { x: number; y: number };
export type Stroke = Pt[];
export type Seg = { x1: number; y1: number; x2: number; y2: number };
export type MazeInput = { strokes: Stroke[]; start: Pt; goal: Pt };
