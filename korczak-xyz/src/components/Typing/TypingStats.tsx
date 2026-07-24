import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { loadCloudSessions } from '../../utils/typing/cloudStorage';
import {
  activeTypingMs,
  charEvents,
  computeAccuracy,
  computeWpm,
  formatDuration,
} from '../../utils/typing/metrics';
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

type Grouping = 'session' | 'day' | 'week';

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

// Collapse sessions into one point per time bucket. Every char event is filed
// under the bucket of its wall-clock time (session.startedAt + event offset),
// then each bucket's metrics are computed directly over its events — a true
// aggregate (total correct chars over total active typing time), not an average
// of per-session numbers. This attributes typing to the bucket it actually
// happened in and splits a session that spans a bucket boundary across both.
// Points anchor at the bucket start returned by keyOf.
function aggregateFromEvents(
  sessions: TypingSession[],
  keyOf: (wall: number) => number,
): DataPoint[] {
  const byBucket = new Map<number, TypingEvent[]>();
  for (const s of sessions) {
    for (const e of charEvents(s.events)) {
      const wall = s.startedAt + e.t;
      const key = keyOf(wall);
      const ev = { ...e, t: wall }; // wall-clock t so metric gaps are real elapsed time
      const bucket = byBucket.get(key);
      if (bucket) bucket.push(ev);
      else byBucket.set(key, [ev]);
    }
  }
  return [...byBucket.entries()]
    .filter(([, events]) => events.length >= MIN_CHAR_EVENTS)
    .sort((a, b) => a[0] - b[0])
    .map(([key, events]) => {
      events.sort((a, b) => a.t - b.t);
      return {
        t: key,
        wpm: computeWpm(events),
        accuracy: computeAccuracy(events),
        timeMs: activeTypingMs(events),
        weight: events.length,
      };
    });
}

function aggregateByDayFromEvents(sessions: TypingSession[]): DataPoint[] {
  return aggregateFromEvents(sessions, (wall) => {
    const d = new Date(wall);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  });
}

// Weeks start on local Monday midnight.
function aggregateByWeekFromEvents(sessions: TypingSession[]): DataPoint[] {
  return aggregateFromEvents(sessions, (wall) => {
    const d = new Date(wall);
    const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset).getTime();
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

export default function TypingStats({ lang }: TypingStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());
  const [grouping, setGrouping] = useState<Grouping>('day');
  const [showWpm, setShowWpm] = useState(true);
  const [showAccuracy, setShowAccuracy] = useState(true);
  const [showTime, setShowTime] = useState(true);

  // While a signed-in user's cloud sessions are still loading we show an empty
  // grid rather than the local-only data, so the chart draws once with the
  // authoritative merged dataset instead of visibly jumping when cloud lands.
  const [cloudSettled, setCloudSettled] = useState(false);
  const uid = auth.user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setCloudSettled(false);
    loadCloudSessions(uid)
      .then((cloud) => {
        if (cancelled) return;
        if (cloud.length > 0) {
          setSessions((local) => dedupeSessionsById([...local, ...cloud]));
        }
      })
      .catch(() => {
        // Cloud fetch is best-effort; local sessions are already shown.
      })
      .finally(() => {
        if (!cancelled) setCloudSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loading = auth.loading || (!!uid && !cloudSettled);

  // Play the line-draw animation once, on the first reveal after loading ends.
  // Subsequent re-renders (series toggles, grouping switches) render instantly.
  const [animate, setAnimate] = useState(false);
  const hasAnimated = useRef(false);
  useEffect(() => {
    if (loading || hasAnimated.current) return;
    hasAnimated.current = true;
    setAnimate(true);
    const id = window.setTimeout(() => setAnimate(false), 1000);
    return () => window.clearTimeout(id);
  }, [loading]);

  const sessionPoints = toSessionPoints(sessions);
  const points =
    grouping === 'day'
      ? aggregateByDayFromEvents(sessions)
      : grouping === 'week'
        ? aggregateByWeekFromEvents(sessions)
        : sessionPoints;

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

  // Placeholder domains for the empty loading grid so it stays stable and blank.
  const LOADING_Y_DOMAIN: [number, number] = [0, 100];
  const LOADING_YR_DOMAIN: [number, number] = [0, 1];

  return (
    <div className="typing-stats-page">
      {!loading && points.length === 0 ? (
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
              <button
                type="button"
                className="typing-toggle"
                aria-pressed={grouping === 'week'}
                onClick={() => setGrouping('week')}
              >
                {t.perWeek}
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
            series={loading ? [] : series}
            yDomain={loading ? LOADING_Y_DOMAIN : yDomain}
            yDomainRight={loading ? LOADING_YR_DOMAIN : yDomainRight}
            formatRightTick={formatDuration}
            formatDate={formatDate}
            showLabels={grouping !== 'session'}
            animate={animate}
            loading={loading}
          />
          <p className="typing-message">
            {t.sessions}: {loading ? '…' : sessionPoints.length}
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
