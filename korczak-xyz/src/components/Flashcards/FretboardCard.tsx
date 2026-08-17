/*
 * One neck card: the question, the surface it is answered on, and what the answer came to.
 *
 * Lifted whole out of the old `FretboardSession`, minus the queue, the log and the scheduler — those
 * are `FlashcardsSession`'s now, and shared with the chord cards. What is left is everything that
 * knows what a fretboard card *is*: the id grammar, which places answer it, the pad or the neck, the
 * keyboard, and the readout under a wrong answer.
 *
 * The component is keyed on the queue position, so every card mounts fresh and there is nothing to
 * reset. It holds its own verdict rather than reading one down through props, because the verdict is
 * made of what was pressed and what should have been — facts only this file has.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fretFromKey, isAdvanceKey, noteFromKey } from '../../utils/fretboard/keys';
import {
  asksEveryPlace,
  cardNote,
  cardNoteLabel,
  cardNotation,
  displayNotation,
  isPositionKey,
  noteNameAt,
  parseCardId,
  pitchLabel,
  positionsAnswering,
  stringLabel,
} from '../../utils/fretboard/notes';
import type { Notation, NoteName, Position } from '../../utils/fretboard/notes';
import { formatSeconds } from '../../utils/fretboard/stats';
import type { Settings } from '../../utils/fretboard/types';
import { NeckPicker } from '../Fretboard/NeckGrid';
import NoteCard from '../Fretboard/NoteCard';
import NotePad from '../Fretboard/NotePad';
import Verdict from '../srs/Verdict';
import { fill, type Translation } from '../Fretboard/translations';
import type { CardProps } from './FlashcardsSession';

interface Result {
  correct: boolean;
  ms: number;
  note: NoteName;
  chosenNote: NoteName | null;
  /** Every place the player pressed: none on a `name` card, one or many on the neck. */
  chosen: Position[];
  /** Every place that answered the card. A `pitch` card has several, on several strings. */
  answers: Position[];
}

/** `D 10 / G 5 / B 1` — where the pitch was, for the readout under a wrong answer. */
function describePositions(positions: readonly Position[], notation: Notation): string {
  return positions.map((p) => `${stringLabel(p.stringIndex, notation)} ${p.fret}`).join(' / ');
}

const samePlace = (a: Position, b: Position) =>
  a.stringIndex === b.stringIndex && a.fret === b.fret;

/** What one press does to a selection: adds the place, or takes it back off. */
function togglePlace(picked: readonly Position[], place: Position): Position[] {
  return picked.some((p) => samePlace(p, place))
    ? picked.filter((p) => !samePlace(p, place))
    : [...picked, place];
}

/** Whether the selection is exactly the answer — no place missing, none over. */
function sameSet(picked: readonly Position[], answers: readonly Position[]): boolean {
  return (
    picked.length === answers.length && answers.every((a) => picked.some((p) => samePlace(p, a)))
  );
}

export default function FretboardCard({
  cardId,
  settings,
  t,
  onSubmit,
  onAdvance,
  onUnreadable,
}: CardProps<Settings> & { t: Translation }) {
  const [result, setResult] = useState<Result | null>(null);
  // What has been marked on the neck. Only a select-all card accumulates here — every other card is
  // answered by the press itself, and the selection is what replaces that press with a gesture that
  // has to be finished before it means anything.
  const [picked, setPicked] = useState<Position[]>([]);

  const key = useMemo(() => parseCardId(cardId), [cardId]);

  // Everything on the card is drawn in the notation the card asks in — the pad it is answered on,
  // the string letters beside the neck, and what the keyboard letters mean. A card that reads the
  // same under both borrows the display notation rather than flipping the sitting to international
  // for the naturals; see `cardNotation`.
  const notation = key ? cardNotation(key, displayNotation(settings.notations)) : 'international';

  // An id this build cannot read is not a card to ask. Settings sync between devices, so a newer
  // build can name a direction this one has never heard of; skipping the card keeps the sitting
  // going where returning null used to end it on a blank screen.
  useEffect(() => {
    if (!key) onUnreadable();
  }, [key, onUnreadable]);

  // Every place in the scope that answers the card: the frets on the asked string for a `find` card,
  // the places that sound the pitch for a `pitch` one, and the whole set a select-all card is graded
  // on. One source, so the grader, the marks and the readout cannot disagree.
  const valid = useMemo(
    () => (key ? positionsAnswering(key, settings.strings, settings.maxFret) : []),
    [key, settings.maxFret, settings.strings]
  );

  const answerNote = useCallback(
    (note: NoteName) => {
      if (!key || !isPositionKey(key) || result) return;
      const expected = noteNameAt(key.stringIndex, key.fret);
      const outcome = onSubmit({ correct: note === expected, answered: note });
      if (!outcome) return;
      setResult({
        ...outcome,
        note: expected,
        chosenNote: note,
        chosen: [],
        answers: [{ stringIndex: key.stringIndex, fret: key.fret }],
      });
    },
    [key, onSubmit, result]
  );

  const answerPosition = useCallback(
    (stringIndex: number, fret: number) => {
      if (!key || result) return;
      const place = { stringIndex, fret };

      // On a select-all card a press is a selection, not an answer: it is `check` that commits,
      // because the card is about the whole set and any prefix of it would grade as wrong.
      if (asksEveryPlace(key)) {
        setPicked((prev) => togglePlace(prev, place));
        return;
      }

      // Any of them is right on a single-answer card — the card asked for a note, and which finger
      // you reach it with is not the question. `answered` stays what it has always been for each
      // direction, since it is written to the log and to the cloud: a bare fret where the card named
      // the string, the whole place where it did not.
      const answered = key.direction === 'find' ? String(fret) : `${stringIndex}-${fret}`;
      const outcome = onSubmit({
        correct: valid.some((p) => samePlace(p, place)),
        answered,
      });
      if (!outcome) return;
      setResult({
        ...outcome,
        note: cardNote(key),
        chosenNote: null,
        chosen: [place],
        answers: valid,
      });
    },
    [key, onSubmit, result, valid]
  );

  /** Commit a select-all selection. All or nothing: a set that is missing one place is wrong. */
  const submitSelection = useCallback(() => {
    if (!key || result || picked.length === 0) return;
    const outcome = onSubmit({
      correct: sameSet(picked, valid),
      answered: picked.map((p) => `${p.stringIndex}-${p.fret}`).join(' '),
      targets: valid.length,
    });
    if (!outcome) return;
    setResult({ ...outcome, note: cardNote(key), chosenNote: null, chosen: picked, answers: valid });
  }, [key, onSubmit, picked, result, valid]);

  // The keyboard is the card's only while the card is unanswered. Carrying on past a wrong answer
  // belongs to the runner, which owns the queue.
  useEffect(() => {
    if (!key || result) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key.direction === 'name') {
        const note = noteFromKey(e.key, e.shiftKey, notation);
        if (note) {
          e.preventDefault();
          answerNote(note);
        }
        return;
      }
      // The selection is made by tapping, but committing it is one action and therefore has a key:
      // the same one that carries on past a wrong answer, which is the only other thing this screen
      // asks you to confirm.
      if (asksEveryPlace(key)) {
        if (isAdvanceKey(e.key)) {
          e.preventDefault();
          submitSelection();
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
  }, [answerNote, answerPosition, key, notation, result, settings.maxFret, submitSelection]);

  if (!key) return null;

  // One spelling on every direction but `name` — asked as "C♯", "D♭", "Cis" or "Des", never as more
  // than one of them.
  const askedLabel = cardNoteLabel(key);
  const askedNote = cardNote(key);
  const everyPlace = asksEveryPlace(key);
  const stringName = isPositionKey(key) ? stringLabel(key.stringIndex, notation) : '';
  const positionLabel = !isPositionKey(key)
    ? ''
    : key.fret === 0
      ? fill(t.a11yPositionOpen, { string: stringName })
      : fill(t.a11yPosition, { string: stringName, fret: key.fret });
  // Only a `find` card names a string, and only it therefore keeps the other five out of reach.
  const liveStrings = key.direction === 'find' ? [key.stringIndex] : settings.strings;
  const cellLabel = (stringIndex: number, fret: number) => {
    // A `find` card fixes the string and the prompt names it, so the fret is the whole answer;
    // everywhere else the string is part of it and has to be spoken.
    if (key.direction === 'find') return fret === 0 ? t.a11yFretOpen : fill(t.a11yFret, { fret });
    const string = stringLabel(stringIndex, notation);
    return fret === 0
      ? fill(t.a11yPositionOpen, { string })
      : fill(t.a11yPosition, { string, fret });
  };
  const instruction = everyPlace
    ? t.tapEvery
    : key.direction === 'pitch'
      ? t.tapAnywhere
      : t.tapFret;

  return (
    <>
      <p className="fb-prompt">
        {key.direction === 'name' ? (
          t.askName
        ) : (
          <>
            <span className="fb-prompt-note">{askedLabel}</span>{' '}
            {everyPlace
              ? t.everywhere
              : key.direction === 'pitch'
                ? t.anywhere
                : fill(t.onString, { string: stringName })}
          </>
        )}
      </p>

      {/* The verdict is drawn over the box the card lives in — the diagram you read, or the neck
          you tap — so it lands where the eye already is rather than in the row below. */}
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
        <>
          <div className="fb-stage">
            <NeckPicker
              maxFret={settings.maxFret}
              liveStrings={liveStrings}
              stringLabels={settings.stringLabels}
              notation={notation}
              disabled={result != null}
              chosen={result?.chosen ?? picked}
              answers={result?.answers ?? null}
              onPick={answerPosition}
              label={instruction}
              cellLabel={cellLabel}
              multi={everyPlace}
            />
            {result && <Verdict correct={result.correct} />}
          </div>
          {/* Outside the stage, because the verdict is drawn over the stage and this button has to
              stay pressable while the marks it produced are still on the neck. Disabled with
              nothing selected rather than hidden: it is what the card is waiting for, and a control
              that appears on the first tap is one nobody knew was coming. */}
          {everyPlace && (
            <div className="fb-check-row">
              <button
                type="button"
                className="fb-btn fb-btn--primary"
                onClick={submitSelection}
                disabled={result != null || picked.length === 0}
              >
                {picked.length === 0 ? t.check : fill(t.checkCount, { count: picked.length })}
              </button>
            </div>
          )}
        </>
      )}

      <div className="fb-feedback" role="status" aria-live="polite">
        {result ? (
          <>
            <span
              className={result.correct ? 'fb-verdict fb-verdict--ok' : 'fb-verdict fb-verdict--bad'}
            >
              {result.correct ? t.correct : t.wrong}
            </span>
            {!result.correct && (
              <span className="fb-answer">
                {key.direction === 'name'
                  ? fill(t.answerWas, { note: pitchLabel(result.note, notation) })
                  : key.direction === 'find'
                    ? fill(t.fretWas, { fret: result.answers.map((p) => p.fret).join(' / ') })
                    : fill(t.positionsWere, {
                        positions: describePositions(result.answers, notation),
                      })}
              </span>
            )}
            <span className="fb-time">{formatSeconds(result.ms)}</span>
            {!result.correct && (
              <button type="button" className="fb-btn" onClick={onAdvance}>
                {t.next}
              </button>
            )}
          </>
        ) : (
          <span className="fb-hint">{key.direction === 'name' ? t.tapNote : instruction}</span>
        )}
      </div>
    </>
  );
}
