import React from 'react';
import { formatClock } from '../../utils/typing/metrics';
import { LiveWpmPulse } from './LiveWpmPulse';
import type { RecentChar } from '../../utils/typing/types';

interface StatsBarProps {
  wpm: number;
  accuracy: number;
  durationMs: number;
  progressPercent: number;
  isTiming: boolean;
  isPaused: boolean;
  getRecentChars: (windowMs: number) => RecentChar[];
  labels: {
    wpm: string;
    accuracy: string;
    progress: string;
    timeSpent: string;
    pulse: string;
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="typing-stat">
      <span className="typing-stat-value">{value}</span>
      <span className="typing-stat-label">{label}</span>
    </div>
  );
}

export function StatsBar({
  wpm,
  accuracy,
  durationMs,
  progressPercent,
  isTiming,
  isPaused,
  getRecentChars,
  labels,
}: StatsBarProps) {
  return (
    <div className="typing-stats">
      <Stat label={labels.wpm} value={String(Math.round(wpm))} />
      <Stat label={labels.accuracy} value={`${Math.round(accuracy)}%`} />
      <Stat label={labels.timeSpent} value={formatClock(durationMs)} />
      {/* Passing the session WPM as the baseline puts the dashed line at exactly
          the number in the WPM tile, so the two read against each other. */}
      <LiveWpmPulse
        getRecentChars={getRecentChars}
        isTiming={isTiming}
        isPaused={isPaused}
        averageWpm={wpm}
        label={labels.pulse}
      />
      <div className="typing-progress">
        <div className="typing-progress-track">
          <div className="typing-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <span className="typing-stat-label">
          {labels.progress}: {Math.round(progressPercent)}%
        </span>
      </div>
    </div>
  );
}
