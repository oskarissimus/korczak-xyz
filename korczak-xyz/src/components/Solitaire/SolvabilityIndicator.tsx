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

function formatStats(statesExplored?: number, timeMs?: number): string {
  if (statesExplored === undefined || timeMs === undefined) return '';
  const statesK = Math.round(statesExplored / 1000);
  const seconds = Math.round(timeMs / 1000);
  return ` (${statesK}k / ${seconds}s)`;
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
