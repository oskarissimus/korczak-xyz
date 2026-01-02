import type { Cell, Difficulty, DifficultyConfig } from './types';
import { DIFFICULTIES } from './types';

export function createEmptyBoard(config: DifficultyConfig): Cell[][] {
  const board: Cell[][] = [];
  for (let row = 0; row < config.rows; row++) {
    board[row] = [];
    for (let col = 0; col < config.cols; col++) {
      board[row][col] = {
        row,
        col,
        isMine: false,
        adjacentMines: 0,
        state: 'hidden',
      };
    }
  }
  return board;
}

export function placeMines(
  board: Cell[][],
  config: DifficultyConfig,
  safeRow: number,
  safeCol: number
): Cell[][] {
  const newBoard = board.map(row => row.map(cell => ({ ...cell })));
  const { rows, cols, mines } = config;

  // Create list of all valid positions (excluding safe cell and its neighbors)
  const validPositions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Exclude the safe cell and its 8 neighbors
      if (Math.abs(r - safeRow) <= 1 && Math.abs(c - safeCol) <= 1) {
        continue;
      }
      validPositions.push([r, c]);
    }
  }

  // Shuffle and pick first N positions for mines
  for (let i = validPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validPositions[i], validPositions[j]] = [validPositions[j], validPositions[i]];
  }

  const minePositions = validPositions.slice(0, mines);
  for (const [r, c] of minePositions) {
    newBoard[r][c].isMine = true;
  }

  // Calculate adjacent mine counts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!newBoard[r][c].isMine) {
        newBoard[r][c].adjacentMines = countAdjacentMines(newBoard, r, c);
      }
    }
  }

  return newBoard;
}

function countAdjacentMines(board: Cell[][], row: number, col: number): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < board.length && c >= 0 && c < board[0].length) {
        if (board[r][c].isMine) count++;
      }
    }
  }
  return count;
}

export function revealCell(board: Cell[][], row: number, col: number): Cell[][] {
  const newBoard = board.map(r => r.map(cell => ({ ...cell })));
  const cell = newBoard[row][col];

  if (cell.state !== 'hidden') {
    return newBoard;
  }

  cell.state = 'revealed';

  // If empty cell (no adjacent mines), flood fill
  if (!cell.isMine && cell.adjacentMines === 0) {
    floodReveal(newBoard, row, col);
  }

  return newBoard;
}

function floodReveal(board: Cell[][], row: number, col: number): void {
  const stack: [number, number][] = [[row, col]];

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;

        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
          const neighbor = board[nr][nc];
          if (neighbor.state === 'hidden' && !neighbor.isMine) {
            neighbor.state = 'revealed';
            if (neighbor.adjacentMines === 0) {
              stack.push([nr, nc]);
            }
          }
        }
      }
    }
  }
}

export function toggleFlag(board: Cell[][], row: number, col: number): Cell[][] {
  const newBoard = board.map(r => r.map(cell => ({ ...cell })));
  const cell = newBoard[row][col];

  if (cell.state === 'hidden') {
    cell.state = 'flagged';
  } else if (cell.state === 'flagged') {
    cell.state = 'hidden';
  }

  return newBoard;
}

export function revealAllMines(board: Cell[][]): Cell[][] {
  return board.map(row =>
    row.map(cell => ({
      ...cell,
      state: cell.isMine ? 'revealed' : cell.state,
    }))
  );
}

export function checkWin(board: Cell[][]): boolean {
  for (const row of board) {
    for (const cell of row) {
      // If any non-mine cell is not revealed, game is not won
      if (!cell.isMine && cell.state !== 'revealed') {
        return false;
      }
    }
  }
  return true;
}

export function countFlags(board: Cell[][]): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.state === 'flagged') count++;
    }
  }
  return count;
}

export function initializeGame(difficulty: Difficulty): {
  board: Cell[][];
  config: DifficultyConfig;
} {
  const config = DIFFICULTIES[difficulty];
  const board = createEmptyBoard(config);
  return { board, config };
}
