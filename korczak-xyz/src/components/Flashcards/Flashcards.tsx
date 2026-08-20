/*
 * The practice view: a start screen, a sitting, and what the sitting came to.
 *
 * The island owns which of the three is showing and nothing else. Card state belongs to the session,
 * storage and the account belong to `useFlashcardsData`, and the scheduler belongs to
 * `src/utils/srs/scheduler.ts` — this file only decides what a click means.
 *
 * The two things it does that neither trainer did alone:
 *
 *   1. **One queue over both decks** (`buildMixedQueue`), so selection stays due-date fair across
 *      them. A deck left alone for a fortnight fills the sitting; a deck that is caught up
 *      contributes nothing. That is the scheduler being obeyed rather than overruled.
 *   2. **Two commits under one session id.** Each trainer folds its own answers into its own deck and
 *      writes its own immutable sitting document, which is why the two stats pages stay separate and
 *      why this merge moved no data. A deck that contributed nothing gets no record —
 *      `finishSession` returns null and clears its orphan key on zero events.
 *
 * The songbook index arrives as a prop rather than being read here: it is derived from
 * `getCollection('songs')` at build time, in the page, so the island never ships the song texts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFlashcardsData } from '../../hooks/useFlashcardsData';
import { buildMixedQueue } from '../../utils/flashcards/mix';
import type { MixSource } from '../../utils/flashcards/mix';
import { qualify, type TrainerId } from '../../utils/flashcards/trainers';
import { countDeck, nextDueAt } from '../../utils/srs/queue';
import { formatDuration, summarizeSession } from '../../utils/srs/history';
import type { SessionSummary as Summary } from '../../utils/srs/history';
import type { Card, ReviewEvent } from '../../utils/srs/types';
import { cardsInScope as neckCardsInScope, positionSubject } from '../../utils/fretboard/deck';
import { displayNotation } from '../../utils/fretboard/notes';
import { parseCardId as parseNeckCardId } from '../../utils/fretboard/notes';
import { cardSubject, cardsInScope as chordCardsInScope } from '../../utils/transpose/deck';
import { parseCardId as parseChordCardId } from '../../utils/transpose/cards';
import type { LibraryIndex } from '../../utils/transpose/library';
import { unqualify } from '../../utils/flashcards/trainers';
import FlashcardsSession from './FlashcardsSession';
import type { SittingAnswer } from './FlashcardsSession';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import SyncBadge from './SyncBadge';
import {
  defaultNotationFor,
  translations as fretboardTranslations,
} from '../Fretboard/translations';
import {
  defaultNotationsFor,
  translations as transposeTranslations,
} from '../Transpose/translations';
import { fill, translations, type Lang } from './translations';

interface FlashcardsProps {
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
  return `fc${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Which question a card asked, for the summary's per-direction split.
 *
 * Reads a *qualified* id and prefixes the trainer, so a mixed sitting reports `neck · find` and
 * `chords · degrees` rather than folding two vocabularies into one column.
 */
function directionOf(qualified: string): string | null {
  const split = unqualify(qualified);
  if (!split) return null;
  if (split.trainer === 'fretboard') {
    const key = parseNeckCardId(split.cardId);
    return key ? `neck · ${key.direction}` : null;
  }
  const key = parseChordCardId(split.cardId);
  return key ? `chords · ${key.direction}` : null;
}

export default function Flashcards({ lang, library }: FlashcardsProps) {
  const t = translations[lang];
  const fretboardT = fretboardTranslations[lang];
  const transposeT = transposeTranslations[lang];
  const auth = useAuth();
  // Module-level constants per locale, so neither hook's loader re-runs on every render.
  const neckDefault = useMemo(() => defaultNotationFor(lang), [lang]);
  const chordDefaults = useMemo(() => defaultNotationsFor(lang), [lang]);
  const data = useFlashcardsData(auth.user, neckDefault, chordDefaults, library);

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

  const { fretboard, transpose, settings } = data;
  const enabled = settings.trainers;

  const neckScoped = useMemo(
    () => neckCardsInScope(fretboard.deck, fretboard.settings),
    [fretboard.deck, fretboard.settings]
  );
  const chordScoped = useMemo(
    () => chordCardsInScope(transpose.deck, transpose.settings, library),
    [library, transpose.deck, transpose.settings]
  );

  /** Only the decks the settings have switched on — what a sitting will actually draw from. */
  const scoped = useMemo(() => {
    const out: Card[] = [];
    if (enabled.includes('fretboard')) out.push(...neckScoped);
    if (enabled.includes('transpose')) out.push(...chordScoped);
    return out;
  }, [chordScoped, enabled, neckScoped]);

  const counts = useMemo(() => countDeck(scoped, tick), [scoped, tick]);
  const neckCounts = useMemo(() => countDeck(neckScoped, tick), [neckScoped, tick]);
  const chordCounts = useMemo(() => countDeck(chordScoped, tick), [chordScoped, tick]);
  const dueAt = useMemo(() => nextDueAt(scoped, tick), [scoped, tick]);

  const sources = useCallback((): MixSource[] => {
    const out: MixSource[] = [];
    if (enabled.includes('fretboard')) {
      out.push({ trainer: 'fretboard', cards: neckScoped, subjectOf: positionSubject });
    }
    if (enabled.includes('transpose')) {
      out.push({ trainer: 'transpose', cards: chordScoped, subjectOf: cardSubject });
    }
    return out;
  }, [chordScoped, enabled, neckScoped]);

  const startSession = useCallback(
    (ahead: boolean) => {
      const now = Date.now();
      const queue = buildMixedQueue(sources(), settings, now, { ahead });
      if (queue.length === 0) return;
      setFinished(null);
      setSession({ id: newSessionId(now), startedAt: now, queue });
    },
    [settings, sources]
  );

  const handleAnswer = useCallback(
    (trainer: TrainerId, event: ReviewEvent) => {
      if (!session) return;
      const owner = trainer === 'fretboard' ? fretboard : transpose;
      owner.recordAnswer(session.id, session.startedAt, event);
    },
    [fretboard, session, transpose]
  );

  const handleFinish = useCallback(
    (answers: SittingAnswer[], introduced: Record<TrainerId, number>) => {
      if (!session) return;
      // Read before committing: both decks still hold the sitting's starting state, which is what
      // "newly mastered" is measured against.
      const masteredBefore =
        countDeck(neckScoped, Date.now()).buckets.mature +
        countDeck(chordScoped, Date.now()).buckets.mature;

      const neckEvents = answers.filter((a) => a.trainer === 'fretboard').map((a) => a.event);
      const chordEvents = answers.filter((a) => a.trainer === 'transpose').map((a) => a.event);

      // The same session id on both sides: it was one sitting, and a shared id is what lets the two
      // records be recognised as its halves. A side with no answers writes nothing.
      const neckRecord = fretboard.finishSession(
        session.id,
        session.startedAt,
        neckEvents,
        introduced.fretboard
      );
      const chordRecord = transpose.finishSession(
        session.id,
        session.startedAt,
        chordEvents,
        introduced.transpose
      );

      setSession(null);
      setTick(Date.now());
      if (answers.length === 0) return;

      setFinished({
        // Over qualified ids, so each missed line can be named by the trainer that owns it and the
        // per-direction split does not fold two vocabularies into one column. This copy is for the
        // screen only — the events that reached storage carry the ids they always had.
        summary: summarizeSession(
          answers.map((a) => ({ ...a.event, cardId: qualify(a.trainer, a.event.cardId) })),
          directionOf
        ),
        masteredBefore,
        masteredAfter:
          (neckRecord?.masteredAfter ?? countDeck(neckScoped, Date.now()).buckets.mature) +
          (chordRecord?.masteredAfter ?? countDeck(chordScoped, Date.now()).buckets.mature),
      });
    },
    [chordScoped, fretboard, neckScoped, session, transpose]
  );

  const base = lang === 'pl' ? '/pl/games/flashcards' : '/games/flashcards';

  if (!data.ready) {
    return <p className="fb-loading">{t.loading}</p>;
  }

  if (session) {
    return (
      <FlashcardsSession
        key={session.id}
        sessionId={session.id}
        initialQueue={session.queue}
        decks={{ fretboard: fretboard.deck, transpose: transpose.deck }}
        shape={settings}
        fretboardSettings={fretboard.settings}
        transposeSettings={transpose.settings}
        library={library}
        t={t}
        fretboardT={fretboardT}
        transposeT={transposeT}
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
        neckStatsHref={`${base}/neck/`}
        chordStatsHref={`${base}/chords/`}
        t={t}
        fretboardT={fretboardT}
        transposeT={transposeT}
        notation={displayNotation(fretboard.settings.notations)}
        onAgain={() => startSession(true)}
        onDone={() => setFinished(null)}
      />
    );
  }

  const hasWork = counts.due > 0 || counts.fresh > 0;
  const waiting = dueAt != null && dueAt > tick ? formatDuration(dueAt - tick) : null;
  const bothOn = enabled.length > 1;

  return (
    <div className="fb-start">
      <div className="fb-tiles">
        <div className="fb-tile">
          <span className="fb-tile-value">{counts.due}</span>
          <span className="fb-tile-label">{t.due}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">{counts.fresh}</span>
          <span className="fb-tile-label">{t.fresh}</span>
        </div>
        <div className="fb-tile">
          <span className="fb-tile-value">
            {counts.buckets.mature}
            <span className="fb-tile-of">/{counts.total}</span>
          </span>
          <span className="fb-tile-label">{t.mastered}</span>
        </div>
      </div>

      {/* One figure over two decks is not readable as two, and which deck is behind is the thing
          worth knowing on this screen. Only when both are on — with one deck the tiles already say
          it. */}
      {bothOn && (
        <p className="fb-split">
          {fill(t.splitDue, {
            neck: neckCounts.due + neckCounts.fresh,
            chords: chordCounts.due + chordCounts.fresh,
            neckLabel: t.splitNeck,
            chordLabel: t.splitChords,
          })}
        </p>
      )}

      <div className="fb-start-actions">
        {hasWork ? (
          <button
            type="button"
            className="fb-btn fb-btn--primary fb-btn--big"
            onClick={() => startSession(false)}
          >
            {t.start}
          </button>
        ) : (
          <>
            <p className="fb-caught-up">
              {counts.total === 0 ? t.nothingInScope : t.caughtUp}
              {waiting && (
                <span className="fb-next-due">
                  {' '}
                  {t.nextCard}: {waiting}
                </span>
              )}
            </p>
            {counts.total > 0 && (
              <button
                type="button"
                className="fb-btn fb-btn--big"
                onClick={() => startSession(true)}
              >
                {t.practiceAhead}
              </button>
            )}
          </>
        )}
      </div>

      <SyncBadge sync={data.sync} onRetry={data.retrySync} t={t} />

      <SettingsPanel
        settings={settings}
        onChange={data.updateSettings}
        fretboardSettings={fretboard.settings}
        onFretboardChange={fretboard.updateSettings}
        transposeSettings={transpose.settings}
        onTransposeChange={transpose.updateSettings}
        library={library}
        t={t}
        fretboardT={fretboardT}
        transposeT={transposeT}
      />
    </div>
  );
}
