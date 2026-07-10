import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { loadCloudSessions } from '../../utils/typing/cloudStorage';
import { charEvents, computeAccuracy, computeWpm } from '../../utils/typing/metrics';
import { loadAllSessions } from '../../utils/typing/storage';
import type { TypingSession } from '../../utils/typing/types';
import StatsChart from './StatsChart';
import { translations, type Lang } from './translations';

interface TypingStatsProps {
  lang: Lang;
}

// Sessions shorter than this many typed characters (~4 words) produce
// meaningless WPM/accuracy figures and are excluded from the charts.
const MIN_CHAR_EVENTS = 20;

interface SessionPoint {
  t: number;
  wpm: number;
  accuracy: number;
}

function toPoints(sessions: TypingSession[]): SessionPoint[] {
  return sessions
    .filter((s) => charEvents(s.events).length >= MIN_CHAR_EVENTS)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      t: s.startedAt,
      wpm: computeWpm(s.events),
      accuracy: computeAccuracy(s.events),
    }));
}

export default function TypingStats({ lang }: TypingStatsProps) {
  const t = translations[lang];
  const auth = useAuth();

  const [sessions, setSessions] = useState<TypingSession[]>(() => loadAllSessions());

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

  const points = toPoints(sessions);

  const maxWpm = Math.max(...points.map((p) => p.wpm), 0);
  const wpmDomain: [number, number] = [0, Math.max(Math.ceil((maxWpm * 1.1) / 10) * 10, 10)];
  const minAccuracy = Math.min(...points.map((p) => p.accuracy), 100);
  const accuracyDomain: [number, number] = [
    Math.min(80, Math.floor(minAccuracy / 10) * 10),
    100,
  ];

  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const backHref = lang === 'pl' ? '/pl/games/typing/' : '/games/typing/';

  return (
    <div className="typing-stats-page">
      {points.length === 0 ? (
        <p className="typing-message">{t.noStats}</p>
      ) : (
        <>
          <p className="typing-message">
            {t.sessions}: {points.length}
          </p>
          <StatsChart
            title={t.wpmOverTime}
            points={points.map((p) => ({ t: p.t, value: p.wpm }))}
            yDomain={wpmDomain}
            formatValue={(v) => String(Math.round(v))}
            formatDate={formatDate}
            lineClass="typing-chart-line--wpm"
          />
          <StatsChart
            title={t.accuracyOverTime}
            points={points.map((p) => ({ t: p.t, value: p.accuracy }))}
            yDomain={accuracyDomain}
            formatValue={(v) => `${Math.round(v)}%`}
            formatDate={formatDate}
            lineClass="typing-chart-line--accuracy"
          />
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
