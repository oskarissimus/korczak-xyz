import React from 'react';

interface GameControlsProps {
  onNewGame: () => void;
  onUndo: () => void;
  canUndo: boolean;
  moveCount: number;
  elapsedTime: number;
  translations: {
    newGame: string;
    undo: string;
    moves: string;
    time: string;
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function GameControls({
  onNewGame,
  onUndo,
  canUndo,
  moveCount,
  elapsedTime,
  translations,
}: GameControlsProps) {
  return (
    <div className="game-controls">
      <div className="controls-left">
        <button className="retro-btn" onClick={onNewGame}>
          {translations.newGame}
        </button>
        <button
          className="retro-btn"
          onClick={onUndo}
          disabled={!canUndo}
        >
          {translations.undo}
        </button>
      </div>
      <div className="controls-right">
        <div className="stat-box">
          <span className="stat-label">{translations.moves}:</span>
          <span className="stat-value">{moveCount}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">{translations.time}:</span>
          <span className="stat-value">{formatTime(elapsedTime)}</span>
        </div>
      </div>
    </div>
  );
}
