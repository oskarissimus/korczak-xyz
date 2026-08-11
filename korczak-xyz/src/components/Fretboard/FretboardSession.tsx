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
  cardNoteLabel,
  cardNotation,
  displayNotation,
  fretsSounding,
  isPositionKey,
  noteNameAt,
  parseCardId,
  pitchClassOfMidi,
  pitchLabel,
  positionsSounding,
  stringLabel,
} from '../../utils/fretboard/notes';
import type { Notation, NoteName, Position } from '../../utils/fretboard/notes';
import { createCard, isDueWithin, rate, ratingFromAnswer } from '../../utils/fretboard/srs';
import { formatSeconds } from '../../utils/fretboard/stats';
import type { Deck, ReviewEvent, Settings } from '../../utils/fretboard/types';
import { NeckPicker } from './NeckGrid';
import NoteCard from './NoteCard';
import NotePad from './NotePad';
import Verdict from './Verdict';
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
  chosen: Position | null;
  /** Every place that answered the card. A `pitch` card has several, on several strings. */
  answers: Position[];
}

/** `D 10 / G 5 / B 1` — where the pitch was, for the readout under a wrong answer. */
function describePositions(positions: Position[], notation: Notation): string {
  return positions.map((p) => `${stringLabel(p.stringIndex, notation)} ${p.fret}`).join(' / ');
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

  // Everything on the card is drawn in the notation the card asks in — the pad it is answered on,
  // the string letters beside the neck, and what the keyboard letters mean. A card that reads the
  // same under both borrows the display notation rather than flipping the sitting to
  // international for the naturals; see `cardNotation`.
  const notation = key ? cardNotation(key, displayNotation(settings.notations)) : 'international';

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
      if (!key || !isPositionKey(key)) return;
      const expected = noteNameAt(key.stringIndex, key.fret);
      submit(note === expected, note, {
        note: expected,
        chosenNote: note,
        chosen: null,
        answers: [{ stringIndex: key.stringIndex, fret: key.fret }],
      });
    },
    [key, submit]
  );

  const answerPosition = useCallback(
    (stringIndex: number, fret: number) => {
      if (!key) return;
      const chosen = { stringIndex, fret };
      const hit = (valid: Position[]) =>
        valid.some((p) => p.stringIndex === stringIndex && p.fret === fret);

      if (key.direction === 'pitch') {
        // Every place in the scope sounding that exact pitch is right — the card asked for the
        // note, and which finger you reach it with is not the question. Compared as whole MIDI
        // numbers, so the octave the card names is the octave that counts.
        const valid = positionsSounding(key.midi, settings.strings, settings.maxFret);
        submit(hit(valid), `${stringIndex}-${fret}`, {
          note: pitchClassOfMidi(key.midi),
          chosenNote: null,
          chosen,
          answers: valid,
        });
        return;
      }

      const expected = noteNameAt(key.stringIndex, key.fret);
      // Any fret on that string sounding the note is right: on a twelve-fret neck the open
      // string and the twelfth fret are the same note, and marking one of them wrong would be
      // teaching something false.
      const valid = fretsSounding(key.stringIndex, expected, settings.maxFret).map((f) => ({
        stringIndex: key.stringIndex,
        fret: f,
      }));
      submit(hit(valid), String(fret), {
        note: expected,
        chosenNote: null,
        chosen,
        answers: valid,
      });
    },
    [key, settings.maxFret, settings.strings, submit]
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
        const note = noteFromKey(e.key, e.shiftKey, notation);
        if (note) {
          e.preventDefault();
          answerNote(note);
        }
        return;
      }
      // A digit names a fret and a `pitch` card needs a string as well, so there is nothing one
      // keystroke can say there. It is answered by tapping the neck; the advance key still works.
      if (key.direction !== 'find') return;
      const fret = fretFromKey(e.key, settings.maxFret);
      if (fret != null) {
        e.preventDefault();
        answerPosition(key.stringIndex, fret);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advance, answerPosition, answerNote, key, notation, result, settings.maxFret]);

  // An id this build cannot read is not a card to ask. Settings sync between devices, so a newer
  // build can name a direction this one has never heard of; skipping the card keeps the sitting
  // going where returning null used to end it on a blank screen.
  useEffect(() => {
    if (cardId && !key) advance();
  }, [advance, cardId, key]);

  if (!key || !cardId) return null;

  // One spelling on a `find` or `pitch` card — asked as "C♯", "D♭", "Cis" or "Des", never as more
  // than one of them.
  const askedLabel = cardNoteLabel(key);
  const askedNote = isPositionKey(key)
    ? noteNameAt(key.stringIndex, key.fret)
    : pitchClassOfMidi(key.midi);
  const stringName = isPositionKey(key) ? stringLabel(key.stringIndex, notation) : '';
  const positionLabel = !isPositionKey(key)
    ? ''
    : key.fret === 0
      ? fill(t.a11yPositionOpen, { string: stringName })
      : fill(t.a11yPosition, { string: stringName, fret: key.fret });
  const liveStrings = isPositionKey(key) ? [key.stringIndex] : settings.strings;
  const cellLabel = (stringIndex: number, fret: number) => {
    // A `find` card fixes the string and the prompt names it, so the fret is the whole answer;
    // on a `pitch` card the string is half of it and has to be spoken.
    if (isPositionKey(key)) return fret === 0 ? t.a11yFretOpen : fill(t.a11yFret, { fret });
    const string = stringLabel(stringIndex, notation);
    return fret === 0
      ? fill(t.a11yPositionOpen, { string })
      : fill(t.a11yPosition, { string, fret });
  };

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
            {key.direction === 'pitch' ? t.anywhere : fill(t.onString, { string: stringName })}
          </>
        )}
      </p>

      {/* The verdict is drawn over the box the card lives in — the diagram you read, or the
          neck you tap — so it lands where the eye already is rather than in the row below. */}
      {isPositionKey(key) && key.direction === 'name' ? (
        <>
          <div className="fb-stage fb-stage--card">
            <NoteCard
              stringIndex={key.stringIndex}
              fret={key.fret}
              stringLabels={settings.stringLabels}
              notation={notation}
              label={positionLabel}
            />
            {result && <Verdict correct={result.correct} />}
          </div>
          <NotePad
            onPick={answerNote}
            disabled={result != null}
            chosen={result?.chosenNote ?? null}
            answer={result ? askedNote : null}
            notation={notation}
          />
        </>
      ) : (
        <div className="fb-stage">
          <NeckPicker
            maxFret={settings.maxFret}
            liveStrings={liveStrings}
            stringLabels={settings.stringLabels}
            notation={notation}
            disabled={result != null}
            chosen={result?.chosen ?? null}
            answers={result?.answers ?? null}
            onPick={answerPosition}
            label={key.direction === 'pitch' ? t.tapAnywhere : t.tapFret}
            cellLabel={cellLabel}
          />
          {result && <Verdict correct={result.correct} />}
        </div>
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
                  ? fill(t.answerWas, { note: pitchLabel(result.note, notation) })
                  : key.direction === 'pitch'
                    ? fill(t.positionsWere, {
                        positions: describePositions(result.answers, notation),
                      })
                    : fill(t.fretWas, { fret: result.answers.map((p) => p.fret).join(' / ') })}
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
          <span className="fb-hint">
            {key.direction === 'name'
              ? t.tapNote
              : key.direction === 'pitch'
                ? t.tapAnywhere
                : t.tapFret}
          </span>
        )}
      </div>
    </div>
  );
}
