import React, { useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../i18n';
import type { ExamCategory, ExamStatus, InputMode } from '../../utils/pregnancyCalendar/types';
import { SCHEDULE } from '../../utils/pregnancyCalendar/schedule';
import {
  currentWeek,
  dateForWeek,
  dueDateFromLmp,
  formatDate,
  lmpFromCurrentWeek,
  lmpFromDueDate,
  parseDateInput,
  toDateInputValue,
} from '../../utils/pregnancyCalendar/dates';
import { clearLmp, loadLmp, saveLmp } from '../../utils/pregnancyCalendar/storage';
import ExamItem from './ExamItem';

interface PregnancyCalendarProps {
  lang: Lang;
}

const translations = {
  en: {
    intro: 'Enter the first day of your last menstrual period (LMP) to turn the schedule of prenatal examinations into concrete dates.',
    modeLmp: 'Last period (LMP)',
    modeDueDate: 'Due date',
    modeWeek: 'Current week',
    lmpLabel: 'First day of last period',
    dueDateLabel: 'Estimated due date',
    weekLabel: 'Current gestational week',
    weekPlaceholder: 'e.g. 20',
    clear: 'Clear',
    dueDateSummary: 'Estimated due date',
    currentWeekSummary: 'Current week',
    weekUnit: 'week',
    noData: 'Enter a date above to see concrete dates for each examination.',
    disclaimer:
      'For information only. This is not medical advice and does not replace consultation with your doctor or midwife. The exact scope and timing of examinations is decided by the physician leading the pregnancy.',
    trimester1: '1st trimester (weeks 1–13)',
    trimester2: '2nd trimester (weeks 14–27)',
    trimester3: '3rd trimester (week 28+)',
    status: {
      required: 'required',
      recommended: 'recommended',
      optional: 'optional',
    } as Record<ExamStatus, string>,
    category: {
      usg: 'ultrasound',
      blood: 'blood',
      serology: 'serology',
      screening: 'screening',
      visit: 'visit',
      procedure: 'procedure',
      other: 'other',
    } as Record<ExamCategory, string>,
    now: 'now',
  },
  pl: {
    intro: 'Podaj pierwszy dzien ostatniej miesiaczki, aby zamienic harmonogram badan prenatalnych na konkretne daty.',
    modeLmp: 'Ostatnia miesiaczka',
    modeDueDate: 'Termin porodu',
    modeWeek: 'Aktualny tydzien',
    lmpLabel: 'Pierwszy dzien ostatniej miesiaczki',
    dueDateLabel: 'Przewidywany termin porodu',
    weekLabel: 'Aktualny tydzien ciazy',
    weekPlaceholder: 'np. 20',
    clear: 'Wyczysc',
    dueDateSummary: 'Przewidywany termin porodu',
    currentWeekSummary: 'Aktualny tydzien',
    weekUnit: 'tydzien',
    noData: 'Podaj date powyzej, aby zobaczyc konkretne daty badan.',
    disclaimer:
      'Material informacyjny. To nie jest porada medyczna i nie zastepuje konsultacji z lekarzem lub polozna. O dokladnym zakresie i terminie badan decyduje lekarz prowadzacy ciaze.',
    trimester1: 'I trymestr (1.–13. tydzien)',
    trimester2: 'II trymestr (14.–27. tydzien)',
    trimester3: 'III trymestr (od 28. tygodnia)',
    status: {
      required: 'obowiazkowe',
      recommended: 'zalecane',
      optional: 'opcjonalne',
    } as Record<ExamStatus, string>,
    category: {
      usg: 'USG',
      blood: 'krew',
      serology: 'serologia',
      screening: 'przesiewowe',
      visit: 'wizyta',
      procedure: 'zabieg',
      other: 'inne',
    } as Record<ExamCategory, string>,
    now: 'teraz',
  },
};

// Group by trimester using the exam's starting week.
function trimesterOf(week: number): 1 | 2 | 3 {
  if (week <= 13) return 1;
  if (week <= 27) return 2;
  return 3;
}

export default function PregnancyCalendar({ lang }: PregnancyCalendarProps) {
  const tr = translations[lang];
  const [lmp, setLmp] = useState<Date | null>(null);
  const [mode, setMode] = useState<InputMode>('lmp');
  const [weekInput, setWeekInput] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load persisted LMP on mount (client only).
  useEffect(() => {
    setLmp(loadLmp());
  }, []);

  const applyLmp = (next: Date | null) => {
    setLmp(next);
    if (next) saveLmp(next);
    else clearLmp();
  };

  const dueDate = lmp ? dueDateFromLmp(lmp) : null;
  const week = lmp ? currentWeek(lmp) : null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const grouped = useMemo(() => {
    const groups: Record<1 | 2 | 3, typeof SCHEDULE> = { 1: [], 2: [], 3: [] };
    for (const exam of SCHEDULE) {
      groups[trimesterOf(exam.weekStart)].push(exam);
    }
    return groups;
  }, []);

  const trimesterTitles: Record<1 | 2 | 3, string> = {
    1: tr.trimester1,
    2: tr.trimester2,
    3: tr.trimester3,
  };

  const handleClear = () => {
    applyLmp(null);
    setWeekInput('');
  };

  return (
    <div className="pregnancy-calendar">
      <p className="pc-intro">{tr.intro}</p>

      <div className="pc-input-panel">
        <div className="pc-mode-tabs" role="tablist">
          <button
            type="button"
            className={`pc-tab ${mode === 'lmp' ? 'active' : ''}`}
            onClick={() => setMode('lmp')}
          >
            {tr.modeLmp}
          </button>
          <button
            type="button"
            className={`pc-tab ${mode === 'dueDate' ? 'active' : ''}`}
            onClick={() => setMode('dueDate')}
          >
            {tr.modeDueDate}
          </button>
          <button
            type="button"
            className={`pc-tab ${mode === 'week' ? 'active' : ''}`}
            onClick={() => setMode('week')}
          >
            {tr.modeWeek}
          </button>
        </div>

        <div className="pc-input-row">
          {mode === 'lmp' && (
            <label className="pc-field">
              <span>{tr.lmpLabel}</span>
              <input
                type="date"
                value={lmp ? toDateInputValue(lmp) : ''}
                onChange={(e) => applyLmp(parseDateInput(e.target.value))}
              />
            </label>
          )}
          {mode === 'dueDate' && (
            <label className="pc-field">
              <span>{tr.dueDateLabel}</span>
              <input
                type="date"
                value={dueDate ? toDateInputValue(dueDate) : ''}
                onChange={(e) => {
                  const d = parseDateInput(e.target.value);
                  applyLmp(d ? lmpFromDueDate(d) : null);
                }}
              />
            </label>
          )}
          {mode === 'week' && (
            <label className="pc-field">
              <span>{tr.weekLabel}</span>
              <input
                type="number"
                min={1}
                max={42}
                placeholder={tr.weekPlaceholder}
                value={weekInput}
                onChange={(e) => {
                  setWeekInput(e.target.value);
                  const w = Number(e.target.value);
                  if (w >= 1 && w <= 42) applyLmp(lmpFromCurrentWeek(w));
                }}
              />
            </label>
          )}
          {lmp && (
            <button type="button" className="pc-clear" onClick={handleClear}>
              {tr.clear}
            </button>
          )}
        </div>

        {lmp && dueDate && week !== null && (
          <div className="pc-summary">
            <span>
              {tr.dueDateSummary}: <strong>{formatDate(dueDate, lang)}</strong>
            </span>
            <span>
              {tr.currentWeekSummary}: <strong>{week} {tr.weekUnit}</strong>
            </span>
          </div>
        )}
      </div>

      {!lmp && <p className="pc-no-data">{tr.noData}</p>}

      <div className="pc-schedule">
        {([1, 2, 3] as const).map((tri) => (
          <section key={tri} className="pc-trimester">
            <h3 className="pc-trimester-title">{trimesterTitles[tri]}</h3>
            <div className="pc-exam-list">
              {grouped[tri].map((exam) => {
                const dateLabel =
                  lmp
                    ? `${formatDate(dateForWeek(lmp, exam.weekStart), lang)}${
                        exam.weekEnd !== exam.weekStart
                          ? ` – ${formatDate(dateForWeek(lmp, exam.weekEnd), lang)}`
                          : ''
                      }`
                    : null;
                const isNow =
                  week !== null && week >= exam.weekStart && week <= exam.weekEnd;
                return (
                  <ExamItem
                    key={exam.id}
                    exam={exam}
                    lang={lang}
                    dateLabel={dateLabel}
                    statusLabel={tr.status[exam.status]}
                    categoryLabel={tr.category[exam.category]}
                    isNow={isNow}
                    isExpanded={expanded.has(exam.id)}
                    onToggle={() => toggle(exam.id)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="pc-disclaimer">⚠ {tr.disclaimer}</p>
    </div>
  );
}
