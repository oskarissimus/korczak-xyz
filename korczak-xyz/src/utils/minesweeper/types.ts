export type CellState = 'hidden' | 'revealed' | 'flagged';

export interface Cell {
  row: number;
  col: number;
  isMine: boolean;
  adjacentMines: number;
  state: CellState;
}

export type Difficulty = 'beginner' | 'intermediate' | 'expert';

export interface DifficultyConfig {
  rows: number;
  cols: number;
  mines: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};

export type GameStatus = 'idle' | 'playing' | 'won' | 'lost';

export interface GameState {
  board: Cell[][];
  difficulty: Difficulty;
  status: GameStatus;
  minesRemaining: number;
  startTime: number | null;
  elapsedTime: number;
  firstClickDone: boolean;
}
