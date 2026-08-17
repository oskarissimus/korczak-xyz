/*
 * The progress view: totals, the mastery chart, and the two tables that say where the work is.
 *
 * Everything is recomputed from the deck and the log on render — the log is capped and the deck is
 * a few hundred cards — so there is nothing here worth caching and nothing that can fall out of
 * step with what the practice view is scheduling.
 *
 * The **by key** table is this deck's answer to the fretboard's neck heatmap: it is the picture of
 * where the material lives. A key is only as good as the weakest card on it, which is what makes
 * the bucket column worth reading — being able to produce A's I IV V but not recognise them is not
 * knowing the key.
 */

import { useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTransposeData } from '../../hooks/useTransposeData';
import { DIRECTIONS } from '../../utils/transpose/cards';
import type { Direction } from '../../utils/transpose/cards';
import { cardsInScope, countDeck } from '../../utils/transpose/deck';
import type { LibraryIndex } from '../../utils/transpose/library';
import {
  dailyStats,
  directionStats,
  formatDuration,
  formatSeconds,
  keyStats,
  overallStats,
} from '../../utils/transpose/stats';
import { keyLabel } from '../../utils/transpose/theory';
import type { Notation } from '../../utils/transpose/theory';
import MasteryChart from '../srs/MasteryChart';
import TrendChart from '../srs/TrendChart';
// The merged app's badge and the merged app's strings for it — see `FretboardStats` for why.
import SyncBadge from '../Flashcards/SyncBadge';
import { translations as chromeTranslations } from '../Flashcards/translations';
import { defaultNotationsFor, translations, type Lang } from './translations';

interface TransposeStatsProps {
  lang: Lang;
  library: LibraryIndex;
}

const DIRECTION_LABELS: Record<Direction, 'dirTranspose' | 'dirDegrees' | 'dirKey'> = {
  transpose: 'dirTranspose',
  degrees: 'dirDegrees',
  key: 'dirKey',
};

export default function TransposeStats({ lang, library }: TransposeStatsProps) {
  const t = translations[lang];
  const chrome = chromeTranslations[lang];
  const auth = useAuth();
  const defaults = useMemo(() => defaultNotationsFor(lang), [lang]);
  const data = useTransposeData(auth.user, defaults, library);

  const locale = lang === 'pl' ? 'pl-PL' : 'en-GB';
  const formatDate = (at: number) =>
    new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  // Read once per render. The page has no clock of its own: nothing here changes on its own, and a
  // streak that ticked over while being looked at would be a re-render for nobody.
  const now = Date.now();
  const overall = useMemo(
    () => overallStats(data.events, data.sessions, now),
    [data.events, data.sessions, now]
  );
  const days = useMemo(() => dailyStats(data.events), [data.events]);
  const keys = useMemo(() => keyStats(data.deck), [data.deck]);
  const byDirection = useMemo(() => directionStats(data.deck), [data.deck]);
  const counts = useMemo(
    () => countDeck(cardsInScope(data.deck, data.settings, library), now),
    [data.deck, data.settings, library, now]
  );

  const bucketLabels = {
    new: t.bucketNew,
    learning: t.bucketLearning,
    young: t.bucketYoung,
    mature: t.bucketMature,
  };

  /**
   * Which names the tables are drawn in — not a card's notation, since a table row covers several.
   * The first one in the deck, so a player drilling only the songbook's names never meets `Bb`.
   */
  const display: Notation = data.settings.notations[0] ?? 'polish';

  if (!data.ready) {
    return <p className="tp-loading">{t.loading}</p>;
  }

  const recent = [...data.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
  const practised = keys.filter((k) => k.seen > 0);

  return (
    <div className="tp-stats">
      <div className="tp-tiles">
        <div className="tp-tile">
          <span className="tp-tile-value">
            {counts.buckets.mature}
            <span className="tp-tile-of">/{counts.total}</span>
          </span>
          <span className="tp-tile-label">{t.mastered}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{overall.answers}</span>
          <span className="tp-tile-label">{t.totalAnswers}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{Math.round(overall.accuracy * 100)}%</span>
          <span className="tp-tile-label">{t.accuracy}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{formatDuration(overall.totalMs)}</span>
          <span className="tp-tile-label">{t.totalTime}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{overall.sessions}</span>
          <span className="tp-tile-label">{t.sessionsCount}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{overall.streak}</span>
          <span className="tp-tile-label">{t.streak}</span>
        </div>
      </div>

      <section className="tp-section">
        <h2 className="tp-subhead">{t.masteryOverTime}</h2>
        <MasteryChart
          history={data.mastery}
          labels={bucketLabels}
          formatDate={formatDate}
          emptyLabel={t.noData}
        />
      </section>

      <section className="tp-section">
        <h2 className="tp-subhead">{t.trend}</h2>
        <TrendChart
          days={days}
          formatDate={formatDate}
          labels={{ accuracy: t.legendAccuracy, seconds: t.legendSpeed }}
          emptyLabel={t.noData}
        />
      </section>

      <section className="tp-section">
        <h2 className="tp-subhead">{t.perDirection}</h2>
        <table className="tp-table">
          <thead>
            <tr>
              <th scope="col">{t.directions}</th>
              <th scope="col">{t.cardsColumn}</th>
              <th scope="col">{t.masteredColumn}</th>
              <th scope="col">{t.accuracyColumn}</th>
              <th scope="col">{t.speedColumn}</th>
            </tr>
          </thead>
          <tbody>
            {DIRECTIONS.map((direction) => {
              const stat = byDirection.find((s) => s.direction === direction);
              return (
                <tr key={direction}>
                  <th scope="row">{t[DIRECTION_LABELS[direction]]}</th>
                  <td>{stat?.cards ?? 0}</td>
                  <td>{stat?.mastered ?? 0}</td>
                  <td>
                    {stat?.accuracy == null ? '—' : `${Math.round(stat.accuracy * 100)}%`}
                  </td>
                  <td>{stat?.avgMs == null ? '—' : formatSeconds(stat.avgMs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="tp-section">
        <h2 className="tp-subhead">{t.perKey}</h2>
        {practised.length === 0 ? (
          <p className="tp-empty">{t.noData}</p>
        ) : (
          <table className="tp-table">
            <thead>
              <tr>
                <th scope="col">{t.keyColumn}</th>
                <th scope="col">{t.seenColumn}</th>
                <th scope="col">{t.accuracyColumn}</th>
                <th scope="col">{t.speedColumn}</th>
                <th scope="col">{t.masteredColumn}</th>
              </tr>
            </thead>
            <tbody>
              {practised.map((stat) => (
                <tr key={`${stat.tonic}:${stat.mode}`}>
                  <th scope="row">
                    {keyLabel(stat, display)} {t[stat.mode]}
                  </th>
                  <td>{stat.seen}</td>
                  <td>
                    {stat.accuracy == null ? '—' : `${Math.round(stat.accuracy * 100)}%`}
                  </td>
                  <td>{stat.avgMs == null ? '—' : formatSeconds(stat.avgMs)}</td>
                  <td>
                    <span className={`tp-bucket tp-bucket--${stat.bucket}`}>
                      {bucketLabels[stat.bucket]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tp-section">
        <h2 className="tp-subhead">{t.history}</h2>
        {recent.length === 0 ? (
          <p className="tp-empty">{t.noData}</p>
        ) : (
          <table className="tp-table">
            <thead>
              <tr>
                <th scope="col">{t.dateColumn}</th>
                <th scope="col">{t.seenColumn}</th>
                <th scope="col">{t.accuracyColumn}</th>
                <th scope="col">{t.totalTime}</th>
                <th scope="col">{t.masteredColumn}</th>
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
