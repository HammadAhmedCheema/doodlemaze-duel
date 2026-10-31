import { z } from 'zod';
import type { Theme } from './theme';
import type { Pt, Seg } from './types';
import type { MazeStats, Issue, ErrorCode, WarningCode } from './geometry/validate';

const pt = z.object({ x: z.number().finite(), y: z.number().finite() });

export const ClientMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_room'), name: z.string().max(24), buildTimeS: z.number().int().min(0).max(900).optional() }),
  z.object({ type: z.literal('join_room'), code: z.string().max(8), name: z.string().max(24), token: z.string().max(64).optional() }),
  z.object({ type: z.literal('submit_maze'), strokes: z.array(z.array(pt)).max(400), start: pt, goal: pt, beast: z.boolean().optional() }),
  z.object({ type: z.literal('skip_theme') }),
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('progress'), p: z.number().min(0).max(1) }),
  z.object({ type: z.literal('finish'), elapsedMs: z.number().min(0) }),
  z.object({ type: z.literal('rematch') }),
  z.object({ type: z.literal('ping'), t: z.number() }),
  z.object({ type: z.literal('leave') }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export type Phase = 'LOBBY' | 'BUILD' | 'SWAP' | 'COUNTDOWN' | 'RACING' | 'FINISHED';
export type BuildState = 'drawing' | 'marked' | 'validated' | 'themed' | 'ready';
export type ThemeSource = 'vlm' | 'default' | 'skipped';

export type PlayerView = {
  id: string;
  name: string;
  build: BuildState;
  connected: boolean;
  themeName?: string;
  progress: number;
};

export type RaceMaze = { segments: Seg[]; start: Pt; goal: Pt; theme: Theme; shortestUnits: number; authorName: string; themeSource: ThemeSource; model?: string; beast?: boolean };

export type ResultPlayer = { id: string; name: string; elapsedMs: number | null; pace: number | null; maze: RaceMaze | null; finished: boolean };

export type ServerMsg =
  | { type: 'welcome'; playerId: string; token: string; code: string; model: string; mock: boolean }
  | { type: 'room_state'; code: string; phase: Phase; players: PlayerView[]; buildTimeS: number; buildEndsAt: number | null; hostId: string }
  | { type: 'maze_rejected'; errors: Issue<ErrorCode>[]; warnings: Issue<WarningCode>[] }
  | { type: 'maze_accepted'; stats: MazeStats; warnings: Issue<WarningCode>[] }
  | { type: 'theme_pending'; model: string }
  | { type: 'theme_ready'; theme: Theme; source: ThemeSource; model?: string }
  | { type: 'race_assign'; maze: RaceMaze }
  | { type: 'countdown'; startAt: number }
  | { type: 'opponent_progress'; p: number }
  | { type: 'opponent_finished'; name: string }
  | { type: 'race_result'; winnerId: string | null; reason: 'finish' | 'forfeit'; players: ResultPlayer[] }
  | { type: 'pong'; t: number; serverNow: number }
  | { type: 'error'; code: string; message: string };
