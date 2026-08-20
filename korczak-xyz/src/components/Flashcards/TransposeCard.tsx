/*
 * One chord card: the progression or the key it asks about, the slots it is built in, and which slot
 * went wrong.
 *
 * Lifted whole out of the old `TransposeSession`, minus the queue, the log and the scheduler — those
 * are `FlashcardsSession`'s now, and shared with the neck cards.
 *
 * The order the chords come in is the card's, not this component's: `promptChords` and
 * `answerChords` both apply `key.order`, and they apply the *same* one — so on a `transpose` card
 * slot `i` answers prompt chord `i`, and on a `degrees` card the numeral printed under a slot is
 * the numeral that slot is graded against. Nothing here shuffles anything.
 *
 * **Every answer here is all-or-nothing.** A progression with one chord wrong is a wrong
 * progression: it is the set of chords that is the answer, and partial credit would report a fluency
 * that was never demonstrated. So the verdict's job is telling you *which* slot went wrong, which is
 * most of what there is to learn from a missed card — hence the per-slot right/wrong marks rather
 * than a single "not quite".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { asksMode } from '../../utils/transpose/deck';
import { isCommitKey, isUndoKey, rootFromKey } from '../../utils/transpose/keys';
import {
  answerChords,
  answerLength,
  displayNotation,
  parseCardId,
  promptChords,
} from '../../utils/transpose/cards';
import type { LibraryIndex } from '../../utils/transpose/library';
import { songsFor } from '../../utils/transpose/library';
import { formatSeconds } from '../../utils/transpose/stats';
import { chordLabel, keyLabel, keyOf, keySpelling, patternMode } from '../../utils/transpose/theory';
import type { Mode, PitchClass } from '../../utils/transpose/theory';
import type { Settings } from '../../utils/transpose/types';
import Verdict from '../srs/Verdict';
import AnswerSlots from '../Transpose/AnswerSlots';
import type { Slot } from '../Transpose/AnswerSlots';
import ChordPad from '../Transpose/ChordPad';
import { fill, type Translation } from '../Transpose/translations';
import type { CardProps } from './FlashcardsSession';

interface Result {
  correct: boolean;
  ms: number;
  /** What was picked, slot by slot. */
  picked: (PitchClass | null)[];
  pickedMode: Mode | null;
  /** What should have been picked. */
  expected: PitchClass[];
  expectedMode: Mode;
}

export default function TransposeCard({
  cardId,
  settings,
  library,
  t,
  onSubmit,
  onAdvance,
  onUnreadable,
}: CardProps<Settings> & { library: LibraryIndex; t: Translation }) {
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<PitchClass[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);

  const key = useMemo(() => parseCardId(cardId), [cardId]);
  const wantsMode = asksMode(settings);

  /*
   * The notation the whole card is drawn in — the card's, expressed as one of the systems the player
   * actually selected. See `displayNotation`: the two agree on every word the card prints, and only
   * this one is safe to label the pad with. Computed here rather than beside the markup because the
   * keyboard handler needs it too, and `B` on the keyboard has to mean what the button labelled `B`
   * means.
   */
  const notation = key ? displayNotation(key, settings.notations) : 'polish';

  // An id this build cannot read is not a card to ask. Settings sync between devices, so a newer
  // build can name a pattern this one has never heard of; skipping the card keeps the sitting going
  // where returning null used to end it on a blank screen.
  useEffect(() => {
    if (!key) onUnreadable();
  }, [key, onUnreadable]);

  const expected = useMemo(() => (key ? answerChords(key) : []), [key]);
  const expectedMode: Mode = key ? patternMode(key.pattern) : 'major';
  const answerKeyOf = key
    ? keyOf(key.direction === 'transpose' ? key.to : key.tonic, key.pattern)
    : { tonic: 0 as PitchClass, mode: 'major' as Mode };

  /** How many taps the card wants. A `key` card wants a tonic, and a mode when minor is in scope. */
  const wanted = key ? (key.direction === 'key' ? (wantsMode ? 2 : 1) : expected.length) : 0;
  const filled =
    key?.direction === 'key' ? picked.length + (mode || !wantsMode ? 1 : 0) : picked.length;
  const ready =
    key != null &&
    picked.length >= (key.direction === 'key' ? 1 : expected.length) &&
    (key.direction !== 'key' || !wantsMode || mode != null);

  const submit = useCallback(() => {
    if (!key || result || !ready) return;

    const chosenMode: Mode = key.direction === 'key' ? (mode ?? 'major') : expectedMode;
    const expectedPcs = key.direction === 'key' ? [key.tonic] : expected.map((c) => c.pc);
    const correct =
      picked.length === expectedPcs.length &&
      picked.every((pc, i) => pc === expectedPcs[i]) &&
      chosenMode === expectedMode;

    const outcome = onSubmit({
      correct,
      // Pitch classes, not names: `answered` goes to the log and the cloud, and a name in it would
      // split one card's history the day the notation setting was touched.
      answered: key.direction === 'key' ? `${picked[0]}:${chosenMode}` : picked.join(' '),
      targets: answerLength(key, wantsMode),
    });
    if (!outcome) return;

    setResult({
      ...outcome,
      picked,
      pickedMode: key.direction === 'key' ? chosenMode : null,
      expected: expectedPcs,
      expectedMode,
    });
  }, [expected, expectedMode, key, mode, onSubmit, picked, ready, result, wantsMode]);

  const pick = useCallback(
    (pc: PitchClass) => {
      if (!key || result) return;
      const limit = key.direction === 'key' ? 1 : expected.length;
      setPicked((prev) => (prev.length >= limit ? prev : [...prev, pc]));
    },
    [expected.length, key, result]
  );

  const clearSlot = useCallback(
    (at: number) => {
      if (result) return;
      setPicked((prev) => prev.filter((_, i) => i !== at));
    },
    [result]
  );

  // The keyboard is the card's only while the card is unanswered. Carrying on past a wrong answer
  // belongs to the runner, which owns the queue.
  useEffect(() => {
    if (!key || result) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isCommitKey(e.key)) {
        e.preventDefault();
        submit();
        return;
      }
      if (isUndoKey(e.key)) {
        e.preventDefault();
        setPicked((prev) => prev.slice(0, -1));
        return;
      }
      const pc = rootFromKey(e.key, e.shiftKey, notation);
      if (pc != null) {
        e.preventDefault();
        pick(pc);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, notation, pick, result, submit]);

  if (!key) return null;

  const prompt = promptChords(key);
  const promptKey = keyOf(key.direction === 'transpose' ? key.from : key.tonic, key.pattern);

  const questionSlots: Slot[] = prompt.map((c) => ({ pc: c.pc, quality: c.quality }));

  const answerSlots: Slot[] =
    key.direction === 'key'
      ? [{ pc: picked[0] ?? null, quality: 'major' }]
      : expected.map((c, i) => ({
          pc: picked[i] ?? null,
          quality: c.quality,
          // Only a `degrees` card names its degrees: on a `transpose` card the numerals would hand
          // over one of the two routes to the answer.
          numeral: key.direction === 'degrees' ? c.numeral : undefined,
          state: result ? (picked[i] === result.expected[i] ? 'right' : 'wrong') : undefined,
        }));

  if (key.direction === 'key' && result) {
    answerSlots[0].state = picked[0] === result.expected[0] ? 'right' : 'wrong';
  }

  const spellAnswerIn = key.direction === 'key' ? promptKey : answerKeyOf;

  const songs =
    key.direction === 'transpose'
      ? songsFor(library, key.to, key.pattern)
      : songsFor(library, key.tonic, key.pattern);

  const rightAnswer =
    key.direction === 'key'
      ? `${keyLabel(answerKeyOf, notation)} ${t[expectedMode]}`
      : expected
          .map((c) => chordLabel(c.pc, c.quality, notation, keySpelling(answerKeyOf)))
          .join(' ');

  const instruction = key.direction === 'key' ? t.tapKey : t.tapChords;

  return (
    <>
      {/* The question. A `degrees` card has no chords to show, so it asks in words. */}
      <div className="tp-prompt">
        {key.direction === 'degrees' ? (
          <>
            <span className="tp-prompt-degrees">
              {expected.map((c) => c.numeral).join(' ')}
            </span>{' '}
            <span className="tp-prompt-lead">{t.askDegrees}</span>{' '}
            <span className="tp-prompt-key">{keyLabel(answerKeyOf, notation)}</span>
          </>
        ) : (
          <>
            <AnswerSlots
              slots={questionSlots}
              spellIn={promptKey}
              notation={notation}
              variant="question"
            />
            {key.direction === 'transpose' ? (
              <span className="tp-prompt-target">
                <span className="tp-arrow" aria-hidden="true">
                  →
                </span>
                <span className="tp-prompt-lead">{t.intoKey}</span>{' '}
                <span className="tp-prompt-key">{keyLabel(answerKeyOf, notation)}</span>
              </span>
            ) : (
              <span className="tp-prompt-target">{t.askKey}</span>
            )}
          </>
        )}
      </div>

      {/* The verdict is drawn beside the row the answer is built in rather than over it: three or
          four short fields are all answer, so a mark centred on them would land on one. */}
      <div className="tp-stage">
        <AnswerSlots
          slots={answerSlots}
          spellIn={spellAnswerIn}
          notation={notation}
          activeIndex={result ? undefined : picked.length}
          onClear={result ? undefined : clearSlot}
          variant="answer"
        />
        {key.direction === 'key' && wantsMode && (
          <div className="tp-mode-row" role="group" aria-label={t.tapMode}>
            {(['major', 'minor'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`tp-mode-key${mode === m ? ' tp-mode-key--on' : ''}${
                  result && result.expectedMode === m ? ' tp-mode-key--right' : ''
                }${result && result.pickedMode === m && result.expectedMode !== m ? ' tp-mode-key--wrong' : ''}`}
                aria-pressed={mode === m}
                onClick={() => !result && setMode(m)}
                disabled={result != null}
              >
                {t[m]}
              </button>
            ))}
          </div>
        )}
        {result && <Verdict correct={result.correct} />}
      </div>

      <ChordPad
        onPick={pick}
        disabled={result != null || (key.direction !== 'key' && picked.length >= expected.length)}
        notation={notation}
        answers={result ? result.expected : []}
        mistakes={result ? result.picked.filter((pc): pc is PitchClass => pc != null) : []}
      />

      {/* Outside the stage, because the verdict is drawn over the stage and this button has to stay
          pressable while the marks it produced are still on the slots. Greyed rather than hidden
          with nothing picked: it is what the card is waiting for, and a control that appears on the
          first tap is one nobody knew was coming. */}
      <div className="tp-check-row">
        <button
          type="button"
          className="tp-btn tp-btn--primary"
          onClick={submit}
          disabled={result != null || !ready}
        >
          {t.check}
          {filled > 0 && wanted > 0 && (
            <span className="tp-check-count">
              {filled}/{wanted}
            </span>
          )}
        </button>
      </div>

      <div className="tp-feedback" role="status" aria-live="polite">
        {result ? (
          <>
            <span
              className={result.correct ? 'tp-verdict tp-verdict--ok' : 'tp-verdict tp-verdict--bad'}
            >
              {result.correct ? t.correct : t.wrong}
            </span>
            {!result.correct && (
              <span className="tp-answer">{fill(t.answerWas, { answer: rightAnswer })}</span>
            )}
            <span className="tp-time">{formatSeconds(result.ms)}</span>
            {!result.correct && (
              <button type="button" className="tp-btn" onClick={onAdvance}>
                {t.next}
              </button>
            )}
          </>
        ) : (
          <span className="tp-hint">{instruction}</span>
        )}
      </div>

      {/* The songbook line, shown only *after* the answer — on a `key` card the title would give the
          answer away, and on the others it would narrow the guess. */}
      {result && songs.length > 0 && (
        <p className="tp-songs">
          {t.asIn}{' '}
          {songs.slice(0, 3).map((song, i) => (
            <span key={song.slug}>
              {i > 0 && ', '}
              <em>{song.title}</em>
            </span>
          ))}
        </p>
      )}
    </>
  );
}
