/*
 * One sitting, drawn from both decks.
 *
 * This is the loop both trainers used to keep a copy of: a queue, a working copy of the deck, an
 * answer log, and a card put back when the scheduler wants it again. **The seam is that nothing
 * here knows what a card is.** It reads a trainer off the queued id, hands the rest to that
 * trainer's card component, and takes back one submission — right or wrong, what was answered, and
 * how many places the card asked for. Parsing, the answer surface, the keyboard and the verdict
 * readout all belong to the card, because they are the only parts that differ.
 *
 * Ids in the queue are *qualified* (`fb|find:1-4`); ids in a `ReviewEvent` are not. See
 * `src/utils/flashcards/trainers.ts` — that boundary is what lets a mixed sitting write to two
 * unchanged logs.
 *
 * The answer ordinal is counted once across both decks, so `${sessionId}-${n}` stays unique in each
 * log and the two halves of one sitting can be lined up afterwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_ANSWERS_FACTOR, SESSION_HORIZON_MS, requeue } from '../../utils/srs/queue';
import type { QueueShape } from '../../utils/srs/queue';
import { createCard, isDueWithin, rate, ratingFromAnswer } from '../../utils/srs/scheduler';
import { answerMs } from '../../utils/srs/practice';
import { isAdvanceKey } from '../../utils/fretboard/keys';
import { qualify, unqualify, type TrainerId } from '../../utils/flashcards/trainers';
import type { Deck, ReviewEvent } from '../../utils/srs/types';
import type { Settings as FretboardSettings } from '../../utils/fretboard/types';
import type { Settings as TransposeSettings } from '../../utils/transpose/types';
import type { LibraryIndex } from '../../utils/transpose/library';
import type { Translation as FretboardTranslation } from '../Fretboard/translations';
import type { Translation as TransposeTranslation } from '../Transpose/translations';
import FretboardCard from './FretboardCard';
import TransposeCard from './TransposeCard';
import { type Translation } from './translations';

/** How long a correct answer stays on screen before the next card. */
const ADVANCE_DELAY_MS = 700;

/** What a card hands back when it has been answered. */
export interface Submission {
  correct: boolean;
  /** What the player chose, in whatever form the owning trainer records answers. */
  answered: string;
  /**
   * How many places the card asked for. The rating's speed thresholds are per place, so a card
   * wanting six of them is not graded against the budget for one tap — which is why this crosses
   * the seam rather than being decided here.
   */
  targets?: number;
}

/** What the runner hands back, so the card can draw its own verdict in the same tick. */
export interface Outcome {
  correct: boolean;
  ms: number;
}

/** Refused when the card has already been answered, or the queue has moved on. */
export type SubmitCard = (submission: Submission) => Outcome | null;

export interface SittingAnswer {
  trainer: TrainerId;
  event: ReviewEvent;
}

export interface CardProps<S> {
  cardId: string;
  settings: S;
  onSubmit: SubmitCard;
  onAdvance: () => void;
  /** Called when this build cannot read the id, so the sitting skips it rather than stalling. */
  onUnreadable: () => void;
}

interface SessionProps {
  sessionId: string;
  initialQueue: string[];
  decks: Record<TrainerId, Deck>;
  shape: QueueShape;
  fretboardSettings: FretboardSettings;
  transposeSettings: TransposeSettings;
  library: LibraryIndex;
  t: Translation;
  fretboardT: FretboardTranslation;
  transposeT: TransposeTranslation;
  onAnswer: (trainer: TrainerId, event: ReviewEvent) => void;
  onFinish: (answers: SittingAnswer[], introduced: Record<TrainerId, number>) => void;
}

export default function FlashcardsSession({
  sessionId,
  initialQueue,
  decks,
  shape,
  fretboardSettings,
  transposeSettings,
  library,
  t,
  fretboardT,
  transposeT,
  onAnswer,
  onFinish,
}: SessionProps) {
  const [queue, setQueue] = useState<string[]>(initialQueue);
  const [index, setIndex] = useState(0);
  // A working copy per deck. Not React-state-shared with the hook: the sitting rates cards as it
  // goes and the hook only folds them in at the end.
  const [working, setWorking] = useState<Record<TrainerId, Deck>>(decks);
  const [answers, setAnswers] = useState<SittingAnswer[]>([]);
  const [resolved, setResolved] = useState<Outcome | null>(null);

  const shownAt = useRef(Date.now());
  // Counted per trainer, because each trainer's own `SessionRecord` reports its own.
  const introduced = useRef<Record<TrainerId, Set<string>>>({
    fretboard: new Set(),
    transpose: new Set(),
  });
  const finished = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const qualified = queue[index];
  const split = useMemo(() => (qualified ? unqualify(qualified) : null), [qualified]);
  const done = index >= queue.length;

  const introducedCounts = useCallback(
    () => ({
      fretboard: introduced.current.fretboard.size,
      transpose: introduced.current.transpose.size,
    }),
    []
  );

  // The sitting ends when the queue runs out — including the repeats it grew along the way.
  useEffect(() => {
    if (!done || finished.current) return;
    finished.current = true;
    finishRef.current(answers, introducedCounts());
  }, [answers, done, introducedCounts]);

  // Reset the clock whenever a new card comes up. The measurement starts when the card is visible,
  // not when it was queued.
  useEffect(() => {
    if (!resolved) shownAt.current = Date.now();
  }, [index, resolved]);

  useEffect(() => {
    if (!split) return;
    const deck = working[split.trainer];
    if ((deck[split.cardId]?.status ?? 'new') === 'new') {
      introduced.current[split.trainer].add(split.cardId);
    }
  }, [split, working]);

  const advance = useCallback(() => {
    setResolved(null);
    setIndex((i) => i + 1);
  }, []);

  // A correct answer moves on by itself; a wrong one waits, because the point of showing the right
  // answer is that there is time to read it.
  useEffect(() => {
    if (!resolved?.correct) return;
    const timer = window.setTimeout(advance, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [resolved, advance]);

  // Carrying on past a wrong answer. The card owns the keyboard while it is unanswered; from here
  // on it is the runner's, because advancing is the runner's business.
  useEffect(() => {
    if (!resolved || resolved.correct) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isAdvanceKey(e.key)) return;
      e.preventDefault();
      advance();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advance, resolved]);

  const submit = useCallback<SubmitCard>(
    ({ correct, answered, targets = 1 }) => {
      if (!split || resolved) return null;
      const { trainer, cardId } = split;
      const now = Date.now();
      // Through `answerMs`, which caps a single answer: the clock starts when the card appears and
      // nothing but answering stops it, so a sitting walked away from would otherwise bank the whole
      // walk as practice. Capped here, where the event is minted, so one number reaches the deck, the
      // stored sitting, the day's bar and the lifetime total. It cannot move a rating — the slowest
      // budget `ratingFromAnswer` grades on is 5s a place, well inside the cap.
      const ms = answerMs(now - shownAt.current);
      const rating = ratingFromAnswer(correct, ms, targets);
      const deck = working[trainer];
      const card = deck[cardId] ?? createCard(cardId);
      const updated = rate(card, rating, now, ms);

      const event: ReviewEvent = {
        // One counter across both decks, so the id is unique in each log and the sitting's two
        // halves stay in step.
        id: `${sessionId}-${answers.length + 1}`,
        sessionId,
        cardId,
        at: now,
        ms,
        correct,
        rating,
        answered,
      };
      onAnswer(trainer, event);
      setAnswers((prev) => [...prev, { trainer, event }]);
      setWorking((prev) => ({ ...prev, [trainer]: { ...prev[trainer], [cardId]: updated } }));
      setResolved({ correct, ms });

      // Put it back if the scheduler wants it again this sitting — and stop growing the queue once
      // it has run to three times its intended length, so a bad run cannot make it endless.
      const room = queue.length < shape.sessionLength * MAX_ANSWERS_FACTOR;
      if (room && isDueWithin(updated, now, SESSION_HORIZON_MS)) {
        // Cards not yet attempted this sitting report 0 and so keep their place at the front. Read
        // through the qualified id, because that is what the queue holds.
        const dueOf = (id: string) => {
          if (id === qualified) return updated.due;
          const other = unqualify(id);
          return other ? (working[other.trainer][other.cardId]?.due ?? 0) : 0;
        };
        setQueue((q) => requeue(q, index, qualify(trainer, cardId), updated.due, dueOf));
      }

      return { correct, ms };
    },
    [answers.length, index, onAnswer, qualified, queue.length, resolved, sessionId, shape.sessionLength, split, working]
  );

  const endNow = useCallback(() => {
    finished.current = true;
    onFinish(answers, introducedCounts());
  }, [answers, introducedCounts, onFinish]);

  if (!qualified) return null;

  /*
   * An id neither prefix claims cannot be attributed to a deck, and guessing would file one
   * trainer's answer in the other's log. Skipping it is what the two trainers already do with an id
   * their own parser refuses — see `onUnreadable` below.
   */
  if (!split) {
    return <SkipCard onSkip={advance} />;
  }

  return (
    <div className="fb-session">
      <div className="fb-session-bar">
        <span className="fb-counter">
          {t.answered}: <strong>{answers.length}</strong>
        </span>
        <span className="fb-counter">
          {t.left}: <strong>{queue.length - index}</strong>
        </span>
        <button type="button" className="fb-btn fb-btn--quiet" onClick={endNow}>
          {t.endSession}
        </button>
      </div>

      {split.trainer === 'fretboard' ? (
        <FretboardCard
          key={index}
          cardId={split.cardId}
          settings={fretboardSettings}
          t={fretboardT}
          onSubmit={submit}
          onAdvance={advance}
          onUnreadable={advance}
        />
      ) : (
        <TransposeCard
          key={index}
          cardId={split.cardId}
          settings={transposeSettings}
          library={library}
          t={transposeT}
          onSubmit={submit}
          onAdvance={advance}
          onUnreadable={advance}
        />
      )}
    </div>
  );
}

/** Skip on mount. An effect rather than a call during render, which React would refuse. */
function SkipCard({ onSkip }: { onSkip: () => void }) {
  useEffect(onSkip, [onSkip]);
  return null;
}
