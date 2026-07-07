import React from 'react';

interface StatsBarProps {
  wpm: number;
  accuracy: number;
  progressPercent: number;
  passageIndex: number;
  passageCount: number;
  bestWpm: number;
  labels: {
    wpm: string;
    accuracy: string;
    progress: string;
    passage: string;
    best: string;
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
  progressPercent,
  passageIndex,
  passageCount,
  bestWpm,
  labels,
}: StatsBarProps) {
  return (
    <div className="typing-stats">
      <Stat label={labels.wpm} value={String(Math.round(wpm))} />
      <Stat label={labels.accuracy} value={`${Math.round(accuracy)}%`} />
      <Stat label={labels.best} value={String(Math.round(bestWpm))} />
      <Stat
        label={labels.passage}
        value={`${Math.min(passageIndex + 1, passageCount)}/${passageCount}`}
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
