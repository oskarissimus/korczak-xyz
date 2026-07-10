import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { loadCloudSessions } from '../../utils/typing/cloudStorage';
import { charEvents, computeAccuracy, computeWpm } from '../../utils/typing/metrics';
import { loadAllSessions } from '../../utils/typing/storage';
import type { TypingSession } from '../../utils/typing/types';
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
      weight: charEvents(s.events).length,
    }));
}

// Collapse sessions into one point per calendar day, averaging WPM and accuracy
// weighted by how much was typed that day, and anchoring the point at midnight.
function aggregateByDay(points: DataPoint[]): DataPoint[] {
  const byDay = new Map<number, DataPoint[]>();
  for (const p of points) {
    const d = new Date(p.t);
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(p);
    else byDay.set(dayKey, [p]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayKey, day]) => {
      const totalWeight = day.reduce((sum, p) => sum + p.weight, 0) || 1;
      const wAvg = (sel: (p: DataPoint) => number) =>
        day.reduce((sum, p) => sum + sel(p) * p.weight, 0) / totalWeight;
      return {
        t: dayKey,
        wpm: wAvg((p) => p.wpm),
        accuracy: wAvg((p) => p.accuracy),
        weight: totalWeight,
      };
    });
}

export default function TypingStats({ lang }: TypingStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());
  const [grouping, setGrouping] = useState<Grouping>('day');
  const [showWpm, setShowWpm] = useState(true);
  const [showAccuracy, setShowAccuracy] = useState(true);

  const uid = auth.user?.uid;
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    loadCloudSessions(uid)
      .then((cloud) => {
        if (cancelled || cloud.length === 0) return;
        setSessions((local) => {
          const seen = new Set(local.map((s) => s.id));
          return [...local, ...cloud.filter((s) => !seen.has(s.id))];
        });
      })
      .catch(() => {
        // Cloud fetch is best-effort; local sessions are already shown.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const sessionPoints = toSessionPoints(sessions);
  const points = grouping === 'day' ? aggregateByDay(sessionPoints) : sessionPoints;

  // Shared 0-100 axis; extend only if WPM ever exceeds 100.
  const maxWpm = Math.max(...points.map((p) => p.wpm), 0);
  const yDomain: [number, number] = [0, Math.max(100, Math.ceil((maxWpm * 1.1) / 10) * 10)];

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
    });
  }
  if (showAccuracy) {
    series.push({
      key: 'accuracy',
      points: points.map((p) => ({ t: p.t, value: p.accuracy })),
      lineClass: 'typing-chart-line--accuracy',
      formatValue: (v) => `${Math.round(v)}%`,
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
            </div>
          </div>
          <StatsChart series={series} yDomain={yDomain} formatDate={formatDate} />
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
