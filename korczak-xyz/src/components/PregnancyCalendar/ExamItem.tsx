import React from 'react';
import type { Lang } from '../../i18n';
import type { Examination } from '../../utils/pregnancyCalendar/types';

interface ExamItemProps {
  exam: Examination;
  lang: Lang;
  dateLabel: string | null; // concrete date window, or null when no LMP set
  statusLabel: string;
  categoryLabel: string;
  isNow: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function ExamItem({
  exam,
  lang,
  dateLabel,
  statusLabel,
  categoryLabel,
  isNow,
  isExpanded,
  onToggle,
}: ExamItemProps) {
  const weekLabel =
    exam.weekStart === exam.weekEnd
      ? `${exam.weekStart} tc.`
      : `${exam.weekStart}–${exam.weekEnd} tc.`;

  return (
    <div className={`exam-item ${isNow ? 'exam-item--now' : ''}`}>
      <button
        type="button"
        className="exam-header"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className={`exam-toggle ${isExpanded ? 'open' : ''}`}>{isExpanded ? '▼' : '▶'}</span>
        <span className="exam-main">
          <span className="exam-name">{exam.name[lang]}</span>
          <span className="exam-meta">
            <span className="exam-week">{weekLabel}</span>
            {dateLabel && <span className="exam-date">{dateLabel}</span>}
          </span>
        </span>
        <span className="exam-badges">
          <span className={`exam-badge status-${exam.status}`}>{statusLabel}</span>
          <span className={`exam-badge cat-${exam.category}`}>{categoryLabel}</span>
        </span>
      </button>
      {isExpanded && (
        <div className="exam-details">
          <p>{exam.description[lang]}</p>
        </div>
      )}
    </div>
  );
}
