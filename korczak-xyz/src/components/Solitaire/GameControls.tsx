import React from 'react';
import { SolvabilityIndicator } from './SolvabilityIndicator';
import type { SolvabilityResult } from '../../hooks/useSolvabilityAnalysis';

interface GameControlsProps {
  onNewGame: () => void;
  onUndo: () => void;
  onHint: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canUndo: boolean;
  hintAvailable: boolean;
  moveCount: number;
  elapsedTime: number;
  solvabilityResult?: SolvabilityResult;
  translations: {
    newGame: string;
    undo: string;
    hint: string;
    copy: string;
    paste: string;
    moves: string;
    time: string;
    analyzing?: string;
    winnable?: string;
    stuck?: string;
    unknown?: string;
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
  onHint,
  onCopy,
  onPaste,
  canUndo,
  hintAvailable,
  moveCount,
  elapsedTime,
  solvabilityResult,
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
        <button
          className="retro-btn"
          onClick={onHint}
          disabled={!hintAvailable}
        >
          {translations.hint}
        </button>
        <button className="retro-btn" onClick={onCopy}>
          {translations.copy}
        </button>
        <button className="retro-btn" onClick={onPaste}>
          {translations.paste}
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
        {solvabilityResult && (
          <SolvabilityIndicator
            status={solvabilityResult.status}
            statesExplored={solvabilityResult.statesExplored}
            timeMs={solvabilityResult.timeMs}
            translations={{
              analyzing: translations.analyzing || 'Analyzing...',
              winnable: translations.winnable || 'Winnable',
              stuck: translations.stuck || 'Stuck',
              unknown: translations.unknown || 'Unknown',
            }}
          />
        )}
      </div>
    </div>
  );
}
