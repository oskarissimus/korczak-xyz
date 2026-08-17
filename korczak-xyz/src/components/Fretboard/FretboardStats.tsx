/*
 * The progress view: totals, the mastery chart, the neck, and the sittings behind them.
 *
 * Everything is recomputed from the deck and the log on render — the deck is 156 cards and the
 * log is capped, so there is nothing here worth caching and nothing that can fall out of step
 * with what the practice view is scheduling.
 */

import { useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFretboardData } from '../../hooks/useFretboardData';
import { cardsInScope, countDeck } from '../../utils/fretboard/deck';
import { displayNotation } from '../../utils/fretboard/notes';
import {
  dailyStats,
  formatDuration,
  formatSeconds,
  overallStats,
  positionStats,
} from '../../utils/fretboard/stats';
import type { PositionStat } from '../../utils/fretboard/stats';
import MasteryChart from '../srs/MasteryChart';
import { NeckHeatmap } from './NeckGrid';
// The merged app's badge and the merged app's strings for it: this page is one of three tabs now,
// and the sync it reports on is the whole account's rather than this deck's. See
// `src/utils/flashcards/sync.ts` for why one badge over two syncs needs a rule.
import SyncBadge from '../Flashcards/SyncBadge';
import { translations as chromeTranslations } from '../Flashcards/translations';
import TrendChart from '../srs/TrendChart';
import { defaultNotationFor, translations, type Lang } from './translations';

interface FretboardStatsProps {
  lang: Lang;
}

export default function FretboardStats({ lang }: FretboardStatsProps) {
  const t = translations[lang];
  const chrome = chromeTranslations[lang];
  const auth = useAuth();
  const data = useFretboardData(auth.user, defaultNotationFor(lang));

  const locale = lang === 'pl' ? 'pl-PL' : 'en-GB';
  const formatDate = (at: number) =>
    new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  // Read once per render. The page has no clock of its own: nothing here changes on its own,
  // and a streak that ticked over while being looked at would be a re-render for nobody.
  const now = Date.now();
  const overall = useMemo(
    () => overallStats(data.events, data.sessions, now),
    [data.events, data.sessions, now]
  );
  const days = useMemo(() => dailyStats(data.events), [data.events]);
  const squares = useMemo(() => positionStats(data.deck), [data.deck]);
  const counts = useMemo(
    () => countDeck(cardsInScope(data.deck, data.settings), now),
    [data.deck, data.settings, now]
  );

  const bucketLabels = {
    new: t.bucketNew,
    learning: t.bucketLearning,
    young: t.bucketYoung,
    mature: t.bucketMature,
  };

  const describeSquare = (square: PositionStat) => {
    const where = `${square.fret === 0 ? t.a11yFretOpen : `${t.frets} ${square.fret}`}`;
    const known = bucketLabels[square.bucket];
    if (square.seen === 0) return `${where} — ${known}`;
    return `${where} — ${known}, ${Math.round((square.accuracy ?? 0) * 100)}%, ${formatSeconds(
      square.avgMs ?? 0
    )}`;
  };

  if (!data.ready) {
    return <p className="fb-loading">{t.loading}</p>;
  }

  const recent = [...data.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);

  return (
    <div className="fb-stats">
      <div className="fb-tiles">
        <div className="fb-tile">
          <span className="fb-tile-value">
            {counts.buckets.mature}
            <span className="fb-tile-of">/{counts.total}</span>
          </span>
          <span className="fb-tile-label">{t.mastered}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{overall.answers}</span>
          <span className="fb-tile-label">{t.totalAnswers}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{Math.round(overall.accuracy * 100)}%</span>
          <span className="fb-tile-label">{t.accuracy}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{formatDuration(overall.totalMs)}</span>
          <span className="fb-tile-label">{t.timeSpent}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{overall.sessions}</span>
          <span className="fb-tile-label">{t.sessionsCount}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{overall.streak}</span>
          <span className="fb-tile-label">{t.streak}</span>
        </div>
      </div>

      <section className="fb-section">
        <h2 className="fb-subhead">{t.masteryTitle}</h2>
        <MasteryChart
          history={data.mastery}
          labels={bucketLabels}
          formatDate={formatDate}
          emptyLabel={t.noData}
        />
      </section>

      <section className="fb-section">
        <h2 className="fb-subhead">{t.trendTitle}</h2>
        <TrendChart
          days={days}
          formatDate={formatDate}
          labels={{ accuracy: t.accuracy, seconds: t.seconds }}
          emptyLabel={t.noData}
        />
      </section>

      <section className="fb-section">
        <h2 className="fb-subhead">{t.neckTitle}</h2>
        <NeckHeatmap
          maxFret={data.settings.maxFret}
          squares={squares}
          describe={describeSquare}
          label={t.neckTitle}
          notation={displayNotation(data.settings.notations)}
        />
        <ul className="srs-legend">
          {(['new', 'learning', 'young', 'mature'] as const).map((bucket) => (
            <li key={bucket}>
              <span className={`srs-swatch fb-heat-${bucket}`} aria-hidden="true" />
              {bucketLabels[bucket]}
            </li>
          ))}
        </ul>
        <p className="fb-hint">{t.neckHint}</p>
      </section>

      <section className="fb-section">
        <h2 className="fb-subhead">{t.historyTitle}</h2>
        {recent.length === 0 ? (
          <p className="fb-empty">{t.noData}</p>
        ) : (
          <table className="fb-table">
            <thead>
              <tr>
                <th scope="col">{t.colDate}</th>
                <th scope="col">{t.colAnswers}</th>
                <th scope="col">{t.colAccuracy}</th>
                <th scope="col">{t.colTime}</th>
                <th scope="col">{t.colMastered}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((session) => (
                <tr key={session.id}>
                  <td>{formatDate(session.startedAt)}</td>
                  <td>{session.answers}</td>
                  <td>
                    {session.answers === 0
                      ? '—'
                      : `${Math.round((session.correct / session.answers) * 100)}%`}
                  </td>
                  <td>{formatDuration(session.totalMs)}</td>
                  <td>{session.masteredAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={chrome} />
    </div>
  );
}
