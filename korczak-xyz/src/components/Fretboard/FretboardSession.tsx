/*
 * One sitting.
 *
 * The session owns a working copy of the deck and hands finished answers upward; nothing here
 * writes to storage except through `onAnswer`, which persists each answer as it is given so a
 * closed tab cannot lose the practice.
 *
 * A card answered wrong — or answered slowly enough to still count as learning — is put back
 * into the queue a few places on rather than at the end. That is the whole difference between
 * a quiz and a trainer: the position that just caught you out comes round again while you are
 * still thinking about it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_ANSWERS_FACTOR, SESSION_HORIZON_MS, requeue } from '../../utils/fretboard/deck';
import { fretFromKey, isAdvanceKey, noteFromKey } from '../../utils/fretboard/keys';
import {
  PITCH_CLASSES,
  STRING_LABELS,
  fretsSounding,
  noteLabelAt,
  noteNameAt,
  parseCardId,
} from '../../utils/fretboard/notes';
import type { NoteName } from '../../utils/fretboard/notes';
import { createCard, isDueWithin, rate, ratingFromAnswer } from '../../utils/fretboard/srs';
import { formatSeconds } from '../../utils/fretboard/stats';
import type { Deck, ReviewEvent, Settings } from '../../utils/fretboard/types';
import { NeckPicker } from './NeckGrid';
import NoteCard from './NoteCard';
import NotePad from './NotePad';
import { fill, type Translation } from './translations';

/** How long a correct answer stays on screen before the next card. */
const ADVANCE_DELAY_MS = 700;

interface SessionProps {
  sessionId: string;
  startedAt: number;
  initialQueue: string[];
  deck: Deck;
  settings: Settings;
  t: Translation;
  onAnswer: (event: ReviewEvent) => void;
  onFinish: (events: ReviewEvent[], newIntroduced: number) => void;
}

interface Result {
  correct: boolean;
  ms: number;
  note: NoteName;
  chosenNote: NoteName | null;
  chosenFret: number | null;
  answerFrets: number[];
}

export default function FretboardSession({
  sessionId,
  startedAt,
  initialQueue,
  deck,
  settings,
  t,
  onAnswer,
  onFinish,
}: SessionProps) {
  const [queue, setQueue] = useState<string[]>(initialQueue);
  const [index, setIndex] = useState(0);
  const [working, setWorking] = useState<Deck>(deck);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  const shownAt = useRef(Date.now());
  const introduced = useRef(new Set<string>());
  const finished = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const cardId = queue[index];
  const key = cardId ? parseCardId(cardId) : null;
  const done = index >= queue.length;

  // The sitting ends when the queue runs out — including the repeats it grew along the way.
  useEffect(() => {
    if (!done || finished.current) return;
    finished.current = true;
    finishRef.current(events, introduced.current.size);
  }, [done, events]);

  // Reset the clock whenever a new card comes up. The measurement starts when the card is
  // visible, not when it was queued.
  useEffect(() => {
    if (!result) shownAt.current = Date.now();
  }, [index, result]);

  useEffect(() => {
    if (key && (working[cardId]?.status ?? 'new') === 'new') introduced.current.add(cardId);
  }, [cardId, key, working]);

  const advance = useCallback(() => {
    setResult(null);
    setIndex((i) => i + 1);
  }, []);

  // A correct answer moves on by itself; a wrong one waits, because the point of showing the
  // right answer is that there is time to read it.
  useEffect(() => {
    if (!result?.correct) return;
    const timer = window.setTimeout(advance, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [result, advance]);

  const submit = useCallback(
    (correct: boolean, answered: string, partial: Omit<Result, 'correct' | 'ms'>) => {
      if (!cardId || result) return;
      const now = Date.now();
      const ms = Math.max(0, now - shownAt.current);
      const rating = ratingFromAnswer(correct, ms);
      const card = working[cardId] ?? createCard(cardId);
      const updated = rate(card, rating, now, ms);

      const event: ReviewEvent = {
        id: `${sessionId}-${events.length + 1}`,
        sessionId,
        cardId,
        at: now,
        ms,
        correct,
        rating,
        answered,
      };
      onAnswer(event);
      setEvents((prev) => [...prev, event]);
      setWorking((prev) => ({ ...prev, [cardId]: updated }));
      setResult({ ...partial, correct, ms });

      // Put it back if the scheduler wants it again this sitting — and stop growing the queue
      // once it has run to three times its intended length, so a bad run cannot make it endless.
      const room = queue.length < settings.sessionLength * MAX_ANSWERS_FACTOR;
      if (room && isDueWithin(updated, now, SESSION_HORIZON_MS)) {
        // Cards not yet attempted this sitting report 0 and so keep their place at the front.
        const dueOf = (id: string) => (id === cardId ? updated.due : working[id]?.due ?? 0);
        setQueue((q) => requeue(q, index, cardId, updated.due, dueOf));
      }
    },
    [cardId, events.length, index, onAnswer, queue.length, result, sessionId, settings.sessionLength, working]
  );

  const answerNote = useCallback(
    (note: NoteName) => {
      if (!key) return;
      const expected = noteNameAt(key.stringIndex, key.fret);
      submit(note === expected, note, {
        note: expected,
        chosenNote: note,
        chosenFret: null,
        answerFrets: [key.fret],
      });
    },
    [key, submit]
  );

  const answerFret = useCallback(
    (fret: number) => {
      if (!key) return;
      const expected = noteNameAt(key.stringIndex, key.fret);
      // Any fret on that string sounding the note is right: on a twelve-fret neck the open
      // string and the twelfth fret are the same note, and marking one of them wrong would be
      // teaching something false.
      const valid = fretsSounding(key.stringIndex, expected, settings.maxFret);
      submit(valid.includes(fret), String(fret), {
        note: expected,
        chosenNote: null,
        chosenFret: fret,
        answerFrets: valid,
      });
    },
    [key, settings.maxFret, submit]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (result) {
        if (isAdvanceKey(e.key) && !result.correct) {
          e.preventDefault();
          advance();
        }
        return;
      }
      if (!key) return;
      if (key.direction === 'name') {
        const note = noteFromKey(e.key, e.shiftKey);
        if (note) {
          e.preventDefault();
          answerNote(note);
        }
        return;
      }
      const fret = fretFromKey(e.key, settings.maxFret);
      if (fret != null) {
        e.preventDefault();
        answerFret(fret);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advance, answerFret, answerNote, key, result, settings.maxFret]);

  if (!key || !cardId) return null;

  const stringName = STRING_LABELS[key.stringIndex];
  const askedNote = noteNameAt(key.stringIndex, key.fret);
  const askedLabel = noteLabelAt(key.stringIndex, key.fret);
  const positionLabel =
    key.fret === 0
      ? fill(t.a11yPositionOpen, { string: stringName })
      : fill(t.a11yPosition, { string: stringName, fret: key.fret });

  return (
    <div className="fb-session">
      <div className="fb-session-bar">
        <span className="fb-counter">
          {t.answered}: <strong>{events.length}</strong>
        </span>
        <span className="fb-counter">
          {t.left}: <strong>{queue.length - index}</strong>
        </span>
        <button
          type="button"
          className="fb-btn fb-btn--quiet"
          onClick={() => {
            finished.current = true;
            onFinish(events, introduced.current.size);
          }}
        >
          {t.endSession}
        </button>
      </div>

      <p className="fb-prompt">
        {key.direction === 'name' ? (
          t.askName
        ) : (
          <>
            <span className="fb-prompt-note">{askedLabel}</span>{' '}
            {fill(t.onString, { string: stringName })}
          </>
        )}
      </p>

      {key.direction === 'name' ? (
        <>
          <NoteCard
            stringIndex={key.stringIndex}
            fret={key.fret}
            stringLabels={settings.stringLabels}
            label={positionLabel}
          />
          <NotePad
            onPick={answerNote}
            disabled={result != null}
            chosen={result?.chosenNote ?? null}
            answer={result ? askedNote : null}
          />
        </>
      ) : (
        <NeckPicker
          maxFret={settings.maxFret}
          activeString={key.stringIndex}
          stringLabels={settings.stringLabels}
          disabled={result != null}
          chosenFret={result?.chosenFret ?? null}
          answerFrets={result?.answerFrets ?? null}
          onPick={answerFret}
          label={t.tapFret}
          fretLabel={(fret) => (fret === 0 ? t.a11yFretOpen : fill(t.a11yFret, { fret }))}
        />
      )}

      <div className="fb-feedback" role="status" aria-live="polite">
        {result ? (
          <>
            <span className={result.correct ? 'fb-verdict fb-verdict--ok' : 'fb-verdict fb-verdict--bad'}>
              {result.correct ? t.correct : t.wrong}
            </span>
            {!result.correct && (
              <span className="fb-answer">
                {key.direction === 'name'
                  ? fill(t.answerWas, { note: PITCH_CLASSES.find((p) => p.name === result.note)?.label ?? result.note })
                  : fill(t.fretWas, { fret: result.answerFrets.join(' / ') })}
              </span>
            )}
            <span className="fb-time">{formatSeconds(result.ms)}</span>
            {!result.correct && (
              <button type="button" className="fb-btn" onClick={advance}>
                {t.next}
              </button>
            )}
          </>
        ) : (
          <span className="fb-hint">{key.direction === 'name' ? t.tapNote : t.tapFret}</span>
        )}
      </div>
    </div>
  );
}
