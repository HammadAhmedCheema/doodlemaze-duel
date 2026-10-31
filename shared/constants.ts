// All maze geometry uses a logical 1000 x 1000 unit square.
export const CANVAS = 1000;
export const WALL_THICKNESS = 10;
export const PLAYER_RADIUS = 8;
export const RDP_EPSILON = 6;
export const GAP_SNAP = 14;
export const MIN_STROKE_LEN = 20;
export const BORDER_INSET = 12;
export const GRID = 200;
export const CELL = CANVAS / GRID; // 5 units
export const MIN_TOTAL_WALL_LEN = 1500;
export const MIN_START_GOAL_DIST = 300;
export const TRIVIAL_RATIO = 1.25;
export const WORLD_SCALE = 0.03;
export const WALL_HEIGHT_M = 2.4;
export const EYE_HEIGHT_M = 1.5;
export const WALK_SPEED_M_S = 3.5;
export const WALK_SPEED_UNITS_S = WALK_SPEED_M_S / WORLD_SCALE;
export const MAX_SPEED_UNITS_S = 140;
export const VLM_TIMEOUT_MS = 12000;
export const BUILD_TIME_S = 180;
export const FINISH_RADIUS = 20;

export const MAX_STROKES = 400;
export const MAX_POINTS = 20000;
export const MAX_PAYLOAD_BYTES = 1_000_000;
