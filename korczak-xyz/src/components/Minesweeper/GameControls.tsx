import type { Difficulty, GameStatus } from '../../utils/minesweeper/types';
import type { TranslateFunction } from '../../i18n';

interface GameControlsProps {
  difficulty: Difficulty;
  status: GameStatus;
  minesRemaining: number;
  elapsedTime: number;
  onNewGame: () => void;
  onChangeDifficulty: (difficulty: Difficulty) => void;
  flagMode: boolean;
  onToggleFlagMode: () => void;
  t: TranslateFunction;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function GameControls({
  difficulty,
  status,
  minesRemaining,
  elapsedTime,
  onNewGame,
  onChangeDifficulty,
  flagMode,
  onToggleFlagMode,
  t,
}: GameControlsProps) {
  const getSmiley = () => {
    switch (status) {
      case 'won':
        return '\u{1F60E}'; // sunglasses
      case 'lost':
        return '\u{1F635}'; // dizzy face
      default:
        return '\u{1F642}'; // slight smile
    }
  };

  return (
    <div className="minesweeper-controls">
      <div className="minesweeper-stats">
        <div className="stat-box mines-counter">
          <span className="stat-icon">{'\u{1F4A3}'}</span>
          <span className="stat-value">{minesRemaining.toString().padStart(3, '0')}</span>
        </div>

        <button className="smiley-btn" onClick={onNewGame} title={t('minesweeper.newGame')}>
          {getSmiley()}
        </button>

        <button
          className={`flag-mode-btn ${flagMode ? 'active' : ''}`}
          onClick={onToggleFlagMode}
          title={flagMode ? t('minesweeper.digMode') : t('minesweeper.flagMode')}
        >
          {flagMode ? '\u{1F6A9}' : '\u{26CF}'}
        </button>

        <div className="stat-box timer">
          <span className="stat-icon">{'\u{23F1}'}</span>
          <span className="stat-value">{formatTime(elapsedTime)}</span>
        </div>
      </div>

      <div className="difficulty-selector">
        <button
          className={`retro-btn difficulty-btn ${difficulty === 'beginner' ? 'active' : ''}`}
          onClick={() => onChangeDifficulty('beginner')}
        >
          {t('minesweeper.beginner')}
        </button>
        <button
          className={`retro-btn difficulty-btn ${difficulty === 'intermediate' ? 'active' : ''}`}
          onClick={() => onChangeDifficulty('intermediate')}
        >
          {t('minesweeper.intermediate')}
        </button>
        <button
          className={`retro-btn difficulty-btn ${difficulty === 'expert' ? 'active' : ''}`}
          onClick={() => onChangeDifficulty('expert')}
        >
          {t('minesweeper.expert')}
        </button>
      </div>
    </div>
  );
}
