import React from 'react';
import { formatClock, formatDuration } from '../../utils/typing/metrics';

interface StatsBarProps {
  wpm: number;
  accuracy: number;
  durationMs: number;
  // Lifetime time on this book, and what is left of it at the pace that time was typed at.
  // `remainingMs` is null until there is enough typing to measure a pace, and once the book
  // is finished; the item is then left off the line entirely rather than shown as a dash.
  timeSpentMs: number;
  remainingMs: number | null;
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
    // Kept short on purpose. These sit on a column with no min-width floor (see
    // .typing-progress in typing.css), so their length is part of what decides how early the
    // whole progress column wraps to its own line on a narrow screen.
    timeInBook: string;
    timeLeft: string;
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
  timeSpentMs,
  remainingMs,
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
          {/* Each its own flex item, so on a narrow screen they fall under one another at the
              row's gap rather than breaking mid-phrase. The tile above shows this sitting's
              stopwatch; these two are the book's whole history and its remainder. */}
          <span className="typing-stat-label">
            {labels.progress}: {Math.round(progressPercent)}%
          </span>
          <span className="typing-stat-label">
            {labels.timeInBook}: {formatDuration(timeSpentMs / 60000)}
          </span>
          {remainingMs != null && (
            <span className="typing-stat-label">
              {labels.timeLeft}: ~{formatDuration(remainingMs / 60000)}
            </span>
          )}
          {syncStatus}
        </div>
      </div>
    </div>
  );
}
