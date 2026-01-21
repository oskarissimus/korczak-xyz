import React from 'react';
import type { SolvabilityStatus } from '../../utils/solitaire/solver';

interface SolvabilityIndicatorProps {
  status: SolvabilityStatus;
  statesExplored?: number;
  timeMs?: number;
  translations: {
    analyzing: string;
    winnable: string;
    stuck: string;
    unknown: string;
  };
}

function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const m = n / 1_000_000;
  return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1).replace(/\.0$/, '')}M`;
}

function formatStats(statesExplored?: number, timeMs?: number): string {
  if (statesExplored === undefined || timeMs === undefined) return '';
  const seconds = Math.round(timeMs / 1000);
  return ` (${formatNumber(statesExplored)} / ${seconds}s)`;
}

export function SolvabilityIndicator({ status, statesExplored, timeMs, translations }: SolvabilityIndicatorProps) {
  if (status === 'idle') return null;

  const config: Record<SolvabilityStatus, { text: string; className: string }> = {
    idle: { text: '', className: '' },
    analyzing: { text: translations.analyzing, className: 'solvability-analyzing' },
    winnable: { text: translations.winnable, className: 'solvability-winnable' },
    'not-winnable': { text: translations.stuck, className: 'solvability-stuck' },
    unknown: { text: translations.unknown, className: 'solvability-unknown' },
  };

  const { text, className } = config[status];
  const stats = formatStats(statesExplored, timeMs);

  return (
    <div className={`stat-box solvability-indicator ${className}`}>
      <span className="solvability-text">{text}{stats}</span>
    </div>
  );
}
