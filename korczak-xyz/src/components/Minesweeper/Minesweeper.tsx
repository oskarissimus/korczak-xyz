import { useState, useEffect, useCallback } from 'react';
import type { Difficulty, GameState } from '../../utils/minesweeper/types';
import { DIFFICULTIES } from '../../utils/minesweeper/types';
import {
  initializeGame,
  placeMines,
  revealCell,
  toggleFlag,
  revealAllMines,
  checkWin,
  countFlags,
} from '../../utils/minesweeper/board';
import Board from './Board';
import GameControls from './GameControls';
import { useTranslations } from '../../i18n';
import type { Lang } from '../../i18n';

interface MinesweeperProps {
  lang: Lang;
}

export default function Minesweeper({ lang }: MinesweeperProps) {
  const t = useTranslations(lang);

  const [flagMode, setFlagMode] = useState(false);
  const [gameState, setGameState] = useState<GameState>(() => {
    const { board } = initializeGame('beginner');
    return {
      board,
      difficulty: 'beginner',
      status: 'idle',
      minesRemaining: DIFFICULTIES.beginner.mines,
      startTime: null,
      elapsedTime: 0,
      firstClickDone: false,
    };
  });

  // Timer effect
  useEffect(() => {
    if (gameState.status !== 'playing' || !gameState.startTime) {
      return;
    }

    const interval = setInterval(() => {
      setGameState(prev => ({
        ...prev,
        elapsedTime: Math.floor((Date.now() - prev.startTime!) / 1000),
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState.status, gameState.startTime]);

  const startNewGame = useCallback((difficulty: Difficulty = gameState.difficulty) => {
    const { board } = initializeGame(difficulty);
    setGameState({
      board,
      difficulty,
      status: 'idle',
      minesRemaining: DIFFICULTIES[difficulty].mines,
      startTime: null,
      elapsedTime: 0,
      firstClickDone: false,
    });
  }, [gameState.difficulty]);

  const handleReveal = useCallback((row: number, col: number) => {
    setGameState(prev => {
      if (prev.status === 'won' || prev.status === 'lost') {
        return prev;
      }

      let newBoard = prev.board;
      let newStatus = prev.status;
      let startTime = prev.startTime;
      let firstClickDone = prev.firstClickDone;

      // First click - place mines avoiding this cell
      if (!firstClickDone) {
        const config = DIFFICULTIES[prev.difficulty];
        newBoard = placeMines(prev.board, config, row, col);
        firstClickDone = true;
        startTime = Date.now();
        newStatus = 'playing';
      }

      const cell = newBoard[row][col];
      if (cell.state !== 'hidden') {
        return prev;
      }

      // Reveal the cell
      newBoard = revealCell(newBoard, row, col);

      // Check if hit a mine
      if (cell.isMine) {
        newBoard = revealAllMines(newBoard);
        newStatus = 'lost';
      } else if (checkWin(newBoard)) {
        newStatus = 'won';
      }

      const flagCount = countFlags(newBoard);
      const minesRemaining = DIFFICULTIES[prev.difficulty].mines - flagCount;

      return {
        ...prev,
        board: newBoard,
        status: newStatus,
        startTime,
        firstClickDone,
        minesRemaining,
      };
    });
  }, []);

  const handleFlag = useCallback((row: number, col: number) => {
    setGameState(prev => {
      if (prev.status === 'won' || prev.status === 'lost') {
        return prev;
      }

      const newBoard = toggleFlag(prev.board, row, col);
      const flagCount = countFlags(newBoard);
      const minesRemaining = DIFFICULTIES[prev.difficulty].mines - flagCount;

      return {
        ...prev,
        board: newBoard,
        minesRemaining,
      };
    });
  }, []);

  const handleChangeDifficulty = useCallback((difficulty: Difficulty) => {
    startNewGame(difficulty);
  }, [startNewGame]);

  const gameOver = gameState.status === 'won' || gameState.status === 'lost';

  return (
    <div className="minesweeper-game">
      <GameControls
        difficulty={gameState.difficulty}
        status={gameState.status}
        minesRemaining={gameState.minesRemaining}
        elapsedTime={gameState.elapsedTime}
        onNewGame={() => startNewGame()}
        onChangeDifficulty={handleChangeDifficulty}
        flagMode={flagMode}
        onToggleFlagMode={() => setFlagMode(f => !f)}
        t={t}
      />

      <div className="minesweeper-board-container">
        <Board
          board={gameState.board}
          gameOver={gameOver}
          onReveal={handleReveal}
          onFlag={handleFlag}
          flagMode={flagMode}
        />
      </div>

      {gameState.status === 'won' && (
        <div className="game-message win-message">
          {t('minesweeper.youWin')}
        </div>
      )}

      {gameState.status === 'lost' && (
        <div className="game-message lose-message">
          {t('minesweeper.gameOver')}
        </div>
      )}
    </div>
  );
}
