import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { loadCloudSessions } from '../../utils/typing/cloudStorage';
import { activeTypingMs, charEvents, computeAccuracy, computeWpm } from '../../utils/typing/metrics';
import { dedupeSessionsById, loadAllSessions } from '../../utils/typing/storage';
import type { TypingEvent, TypingSession } from '../../utils/typing/types';
import StatsChart, { type StatsSeries } from './StatsChart';
import { translations, type Lang } from './translations';

interface TypingStatsProps {
  lang: Lang;
}

// Sessions shorter than this many typed characters (~4 words) produce
// meaningless WPM/accuracy figures and are excluded from the charts.
const MIN_CHAR_EVENTS = 20;

type Grouping = 'session' | 'day';

interface DataPoint {
  t: number;
  wpm: number;
  accuracy: number;
  timeMs: number; // active typing time (idle gaps capped)
  weight: number; // typed-char count, used for day averaging
}

function toSessionPoints(sessions: TypingSession[]): DataPoint[] {
  return sessions
    .filter((s) => charEvents(s.events).length >= MIN_CHAR_EVENTS)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      t: s.startedAt,
      wpm: computeWpm(s.events),
      accuracy: computeAccuracy(s.events),
      timeMs: activeTypingMs(s.events),
      weight: charEvents(s.events).length,
    }));
}

// Collapse sessions into one point per calendar day. Every char event is filed
// under the local day of its wall-clock time (session.startedAt + event offset),
// then that day's metrics are computed directly over its events — a true
// aggregate (total correct chars over total active typing time), not an average
// of per-session numbers. This attributes typing to the day it actually happened
// and splits a session that spans midnight across both days. Points anchor at
// midnight.
function aggregateByDayFromEvents(sessions: TypingSession[]): DataPoint[] {
  const byDay = new Map<number, TypingEvent[]>();
  for (const s of sessions) {
    for (const e of charEvents(s.events)) {
      const wall = s.startedAt + e.t;
      const d = new Date(wall);
      const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const ev = { ...e, t: wall }; // wall-clock t so metric gaps are real elapsed time
      const bucket = byDay.get(dayKey);
      if (bucket) bucket.push(ev);
      else byDay.set(dayKey, [ev]);
    }
  }
  return [...byDay.entries()]
    .filter(([, events]) => events.length >= MIN_CHAR_EVENTS)
    .sort((a, b) => a[0] - b[0])
    .map(([dayKey, events]) => {
      events.sort((a, b) => a.t - b.t);
      return {
        t: dayKey,
        wpm: computeWpm(events),
        accuracy: computeAccuracy(events),
        timeMs: activeTypingMs(events),
        weight: events.length,
      };
    });
}

// Ladder of right-axis maxima (minutes) whose quarter-ticks are clean values;
// beyond the ladder, fall back to whole hours. The 1-minute floor keeps the
// axis readable for sub-minute sessions and guards an all-zero domain.
const NICE_TIME_MAXES = [1, 2, 4, 8, 12, 16, 20, 32, 40, 60, 80, 120, 160, 240];
function niceTimeMax(maxMinutes: number): number {
  const target = Math.max(maxMinutes * 1.1, 1);
  return NICE_TIME_MAXES.find((m) => m >= target) ?? Math.ceil(target / 60) * 60;
}

function formatDuration(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60); // rounding here avoids "1h 60m"
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`;
}

export default function TypingStats({ lang }: TypingStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());
  const [grouping, setGrouping] = useState<Grouping>('day');
  const [showWpm, setShowWpm] = useState(true);
  const [showAccuracy, setShowAccuracy] = useState(true);
  const [showTime, setShowTime] = useState(true);

  const uid = auth.user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadCloudSessions(uid)
      .then((cloud) => {
        if (cancelled || cloud.length === 0) return;
        setSessions((local) => dedupeSessionsById([...local, ...cloud]));
      })
      .catch(() => {
        // Cloud fetch is best-effort; local sessions are already shown.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const sessionPoints = toSessionPoints(sessions);
  const points = grouping === 'day' ? aggregateByDayFromEvents(sessions) : sessionPoints;

  // Shared 0-100 left axis; extend only if WPM ever exceeds 100.
  const maxWpm = Math.max(...points.map((p) => p.wpm), 0);
  const yDomain: [number, number] = [0, Math.max(100, Math.ceil((maxWpm * 1.1) / 10) * 10)];

  // Right axis for time spent, in minutes.
  const maxTimeMin = Math.max(...points.map((p) => p.timeMs), 0) / 60000;
  const yDomainRight: [number, number] = [0, niceTimeMax(maxTimeMin)];

  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const series: StatsSeries[] = [];
  if (showWpm) {
    series.push({
      key: 'wpm',
      points: points.map((p) => ({ t: p.t, value: p.wpm })),
      lineClass: 'typing-chart-line--wpm',
      formatValue: (v) => `${Math.round(v)} ${t.wpm}`,
      formatLabel: (v) => String(Math.round(v)),
    });
  }
  if (showAccuracy) {
    series.push({
      key: 'accuracy',
      points: points.map((p) => ({ t: p.t, value: p.accuracy })),
      lineClass: 'typing-chart-line--accuracy',
      formatValue: (v) => `${Math.round(v)}%`,
      formatLabel: (v) => `${Math.round(v)}%`,
    });
  }
  if (showTime) {
    series.push({
      key: 'time',
      points: points.map((p) => ({ t: p.t, value: p.timeMs / 60000 })),
      lineClass: 'typing-chart-line--time',
      axis: 'right',
      formatValue: formatDuration,
      formatLabel: formatDuration,
    });
  }

  const backHref = lang === 'pl' ? '/pl/games/typing/' : '/games/typing/';

  return (
    <div className="typing-stats-page">
      {points.length === 0 ? (
        <p className="typing-message">{t.noStats}</p>
      ) : (
        <>
          <div className="typing-chart-controls">
            <div className="typing-toggle-group" role="group" aria-label={t.groupBy}>
              <button
                type="button"
                className="typing-toggle"
                aria-pressed={grouping === 'session'}
                onClick={() => setGrouping('session')}
              >
                {t.perSession}
              </button>
              <button
                type="button"
                className="typing-toggle"
                aria-pressed={grouping === 'day'}
                onClick={() => setGrouping('day')}
              >
                {t.perDay}
              </button>
            </div>
            <div className="typing-legend">
              <button
                type="button"
                className="typing-legend-item typing-legend-item--wpm"
                aria-pressed={showWpm}
                onClick={() => setShowWpm((v) => !v)}
              >
                <span className="typing-legend-swatch" />
                {t.wpm}
              </button>
              <button
                type="button"
                className="typing-legend-item typing-legend-item--accuracy"
                aria-pressed={showAccuracy}
                onClick={() => setShowAccuracy((v) => !v)}
              >
                <span className="typing-legend-swatch" />
                {t.accuracy}
              </button>
              <button
                type="button"
                className="typing-legend-item typing-legend-item--time"
                aria-pressed={showTime}
                onClick={() => setShowTime((v) => !v)}
              >
                <span className="typing-legend-swatch" />
                {t.timeSpent}
              </button>
            </div>
          </div>
          <StatsChart
            series={series}
            yDomain={yDomain}
            yDomainRight={yDomainRight}
            formatRightTick={formatDuration}
            formatDate={formatDate}
            showLabels={grouping === 'day'}
          />
          <p className="typing-message">
            {t.sessions}: {sessionPoints.length}
          </p>
        </>
      )}
      <div className="typing-controls">
        <a className="retro-btn" href={backHref}>
          {t.backToTyping}
        </a>
      </div>
    </div>
  );
}
