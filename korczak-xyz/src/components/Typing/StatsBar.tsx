import React from 'react';
import { formatClock } from '../../utils/typing/metrics';

interface StatsBarProps {
  wpm: number;
  accuracy: number;
  durationMs: number;
  progressPercent: number;
  // The sync indicator, rendered after the percentage. A node rather than the sync state
  // itself: whether progress reached the account is a statement about the number it sits
  // beside, but it is the session's business to know, and this component has no other reason
  // to learn about the sync engine.
  syncStatus?: React.ReactNode;
  labels: {
    wpm: string;
    accuracy: string;
    progress: string;
    timeSpent: string;
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
  syncStatus,
  labels,
}: StatsBarProps) {
  return (
    <div className="typing-stats">
      <Stat label={labels.wpm} value={String(Math.round(wpm))} />
      <Stat label={labels.accuracy} value={`${Math.round(accuracy)}%`} />
      <Stat label={labels.timeSpent} value={formatClock(durationMs)} />
      <div className="typing-progress">
        <div className="typing-progress-track">
          <div className="typing-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="typing-progress-footer">
          <span className="typing-stat-label">
            {labels.progress}: {Math.round(progressPercent)}%
          </span>
          {syncStatus}
        </div>
      </div>
    </div>
  );
}
