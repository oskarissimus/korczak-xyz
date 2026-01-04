import type { Card, GameState, Location } from '../types';

export interface SolverConfig {
  maxTimeMs: number;
  maxStatesExplored: number;
}

export interface SolverResult {
  winnable: boolean;
  timedOut: boolean;
  statesExplored: number;
  timeMs: number;
}

export type SolvabilityStatus =
  | 'idle'
  | 'analyzing'
  | 'winnable'
  | 'not-winnable'
  | 'unknown';

export interface SolverMove {
  type: 'pool-to-foundation' | 'pool-to-tableau' | 'tableau-to-foundation' | 'tableau-to-tableau';
  from?: Location & { cardId?: string };
  to?: Location;
  cardCount?: number;
}

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  maxTimeMs: 60000,
  maxStatesExplored: Infinity,
};
