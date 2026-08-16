/*
 * The practice view: a start screen, a sitting, and what the sitting came to.
 *
 * The island owns which of the three is showing and nothing else. Card state belongs to the
 * session, storage and the account belong to `useTransposeData`, and the scheduler belongs to
 * `src/utils/srs/scheduler.ts` — this file only decides what a click means.
 *
 * The songbook index arrives as a prop rather than being read here: it is derived from
 * `getCollection('songs')` at build time, in the page, so the island never ships the song texts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTransposeData } from '../../hooks/useTransposeData';
import { buildQueue, cardsInScope, countDeck, nextDueAt } from '../../utils/transpose/deck';
import type { LibraryIndex } from '../../utils/transpose/library';
import { formatDuration, summarizeSession } from '../../utils/transpose/stats';
import type { SessionSummary as Summary } from '../../utils/transpose/stats';
import type { ReviewEvent } from '../../utils/transpose/types';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import SyncBadge from './SyncBadge';
import TransposeSession from './TransposeSession';
import { defaultNotationsFor, translations, type Lang } from './translations';

interface TransposeProps {
  lang: Lang;
  library: LibraryIndex;
}

interface ActiveSession {
  id: string;
  startedAt: number;
  queue: string[];
}

interface FinishedSession {
  summary: Summary;
  masteredBefore: number;
  masteredAfter: number;
}

/** Random enough that two devices never mint the same id, which is what makes sittings mergeable. */
function newSessionId(now: number): string {
  return `tp${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function Transpose({ lang, library }: TransposeProps) {
  const t = translations[lang];
  const auth = useAuth();
  // A module-level constant per locale, so the hook's loader does not re-run on every render.
  const defaults = useMemo(() => defaultNotationsFor(lang), [lang]);
  const data = useTransposeData(auth.user, defaults, library);

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [finished, setFinished] = useState<FinishedSession | null>(null);
  // The start screen counts down to the next card, so it needs a clock of its own. Only while it is
  // showing: a ticking timer behind a sitting would re-render the card being answered.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (session) return;
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const scoped = useMemo(
    () => cardsInScope(data.deck, data.settings, library),
    [data.deck, data.settings, library]
  );
  const counts = useMemo(() => countDeck(scoped, tick), [scoped, tick]);
  const dueAt = useMemo(() => nextDueAt(scoped, tick), [scoped, tick]);

  const startSession = useCallback(
    (ahead: boolean) => {
      const now = Date.now();
      const queue = buildQueue(data.deck, data.settings, library, now, { ahead });
      if (queue.length === 0) return;
      setFinished(null);
      setSession({ id: newSessionId(now), startedAt: now, queue });
    },
    [data.deck, data.settings, library]
  );

  const handleAnswer = useCallback(
    (event: ReviewEvent) => {
      if (!session) return;
      data.recordAnswer(session.id, session.startedAt, event);
    },
    [data, session]
  );

  const handleFinish = useCallback(
    (events: ReviewEvent[], newIntroduced: number) => {
      if (!session) return;
      // Read before committing: `data.deck` still holds the sitting's starting state, which is what
      // "newly mastered" is measured against.
      const masteredBefore = countDeck(
        cardsInScope(data.deck, data.settings, library),
        Date.now()
      ).buckets.mature;
      const record = data.finishSession(session.id, session.startedAt, events, newIntroduced);
      setSession(null);
      setTick(Date.now());
      if (events.length === 0) return;
      setFinished({
        summary: summarizeSession(events),
        masteredBefore,
        masteredAfter: record?.masteredAfter ?? masteredBefore,
      });
    },
    [data, library, session]
  );

  const statsHref = lang === 'pl' ? '/pl/games/transpose/stats/' : '/games/transpose/stats/';

  if (!data.ready) {
    return <p className="tp-loading">{t.loading}</p>;
  }

  if (session) {
    return (
      <TransposeSession
        key={session.id}
        sessionId={session.id}
        startedAt={session.startedAt}
        initialQueue={session.queue}
        deck={data.deck}
        settings={data.settings}
        library={library}
        t={t}
        onAnswer={handleAnswer}
        onFinish={handleFinish}
      />
    );
  }

  if (finished) {
    return (
      <SessionSummary
        summary={finished.summary}
        masteredBefore={finished.masteredBefore}
        masteredAfter={finished.masteredAfter}
        statsHref={statsHref}
        t={t}
        onAgain={() => startSession(true)}
        onDone={() => setFinished(null)}
      />
    );
  }

  const hasWork = counts.due > 0 || counts.fresh > 0;
  const waiting = dueAt != null && dueAt > tick ? formatDuration(dueAt - tick) : null;

  return (
    <div className="tp-start">
      <div className="tp-tiles">
        <div className="tp-tile">
          <span className="tp-tile-value">{counts.due}</span>
          <span className="tp-tile-label">{t.due}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">{counts.fresh}</span>
          <span className="tp-tile-label">{t.fresh}</span>
        </div>
        <div className="tp-tile">
          <span className="tp-tile-value">
            {counts.buckets.mature}
            <span className="tp-tile-of">/{counts.total}</span>
          </span>
          <span className="tp-tile-label">{t.mastered}</span>
        </div>
      </div>

      <div className="tp-start-actions">
        {hasWork ? (
          <button
            type="button"
            className="tp-btn tp-btn--primary tp-btn--big"
            onClick={() => startSession(false)}
          >
            {t.start}
          </button>
        ) : (
          <>
            <p className="tp-caught-up">
              {counts.total === 0 ? t.nothingInScope : t.caughtUp}
              {waiting && (
                <span className="tp-next-due">
                  {' '}
                  {t.nextCard}: {waiting}
                </span>
              )}
            </p>
            {counts.total > 0 && (
              <button
                type="button"
                className="tp-btn tp-btn--big"
                onClick={() => startSession(true)}
              >
                {t.practiceAhead}
              </button>
            )}
          </>
        )}
      </div>

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={t} />

      <SettingsPanel settings={data.settings} onChange={data.updateSettings} t={t} />
    </div>
  );
}
