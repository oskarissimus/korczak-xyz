import React from 'react';

interface WinDialogProps {
  moveCount: number;
  elapsedTime: number;
  onPlayAgain: () => void;
  translations: {
    youWin: string;
    playAgain: string;
    moves: string;
    time: string;
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function WinDialog({
  moveCount,
  elapsedTime,
  onPlayAgain,
  translations,
}: WinDialogProps) {
  return (
    <div className="win-overlay">
      <div className="win-dialog window">
        <div className="title-bar">
          <span>{translations.youWin}</span>
        </div>
        <div className="win-content">
          <div className="win-celebration">🎉</div>
          <div className="win-stats">
            <p>
              <span className="stat-label">{translations.moves}:</span>{' '}
              <span className="stat-value">{moveCount}</span>
            </p>
            <p>
              <span className="stat-label">{translations.time}:</span>{' '}
              <span className="stat-value">{formatTime(elapsedTime)}</span>
            </p>
          </div>
          <button className="retro-btn play-again-btn" onClick={onPlayAgain}>
            {translations.playAgain}
          </button>
        </div>
      </div>
    </div>
  );
}
