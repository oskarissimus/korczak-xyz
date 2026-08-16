/*
 * One sitting.
 *
 * The session owns a working copy of the deck and hands finished answers upward; nothing here
 * writes to storage except through `onAnswer`, which persists each answer as it is given so a
 * closed tab cannot lose the practice.
 *
 * A card answered wrong — or answered slowly enough to still count as learning — is put back into
 * the queue by `requeue` rather than at the end. That is the whole difference between a quiz and a
 * trainer: the key that just caught you out comes round again while you are still thinking about
 * it.
 *
 * **Every answer here is all-or-nothing.** A progression with one chord wrong is a wrong
 * progression: it is the set of chords that is the answer, and partial credit would report a
 * fluency that was never demonstrated. So the verdict's job is telling you *which* slot went wrong,
 * which is most of what there is to learn from a missed card — hence the per-slot right/wrong marks
 * rather than a single "not quite".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCard, isDueWithin, rate, ratingFromAnswer } from '../../utils/srs/scheduler';
import { MAX_ANSWERS_FACTOR, SESSION_HORIZON_MS, asksMode, requeue } from '../../utils/transpose/deck';
import { isCommitKey, isUndoKey, rootFromKey } from '../../utils/transpose/keys';
import {
  answerChords,
  answerLength,
  displayNotation,
  parseCardId,
  promptChords,
} from '../../utils/transpose/cards';
import type { CardKey } from '../../utils/transpose/cards';
import type { LibraryIndex } from '../../utils/transpose/library';
import { songsFor } from '../../utils/transpose/library';
import { formatSeconds } from '../../utils/transpose/stats';
import {
  chordLabel,
  chordsOf,
  keyLabel,
  keyOf,
  keySpelling,
  patternMode,
} from '../../utils/transpose/theory';
import type { Mode, PitchClass } from '../../utils/transpose/theory';
import type { Deck, ReviewEvent, Settings } from '../../utils/transpose/types';
import Verdict from '../srs/Verdict';
import AnswerSlots from './AnswerSlots';
import type { Slot } from './AnswerSlots';
import ChordPad from './ChordPad';
import { fill, type Translation } from './translations';

/** How long a correct answer stays on screen before the next card. */
const ADVANCE_DELAY_MS = 700;

interface SessionProps {
  sessionId: string;
  startedAt: number;
  initialQueue: string[];
  deck: Deck;
  settings: Settings;
  library: LibraryIndex;
  t: Translation;
  onAnswer: (event: ReviewEvent) => void;
  onFinish: (events: ReviewEvent[], newIntroduced: number) => void;
}

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

export default function TransposeSession({
  sessionId,
  startedAt,
  initialQueue,
  deck,
  settings,
  library,
  t,
  onAnswer,
  onFinish,
}: SessionProps) {
  const [queue, setQueue] = useState<string[]>(initialQueue);
  const [index, setIndex] = useState(0);
  const [working, setWorking] = useState<Deck>(deck);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<PitchClass[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);

  const shownAt = useRef(Date.now());
  const introduced = useRef(new Set<string>());
  const finished = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const cardId = queue[index];
  const key: CardKey | null = cardId ? parseCardId(cardId) : null;
  const done = index >= queue.length;

  const wantsMode = asksMode(settings);

  /*
   * The notation the whole screen is drawn in — the card's, expressed as one of the systems the
   * player actually selected. See `displayNotation`: the two agree on every word the card prints,
   * and only this one is safe to label the pad with. Computed here rather than beside the markup
   * because the keyboard handler needs it too, and `B` on the keyboard has to mean what the button
   * labelled `B` means.
   */
  const notation = key ? displayNotation(key, settings.notations) : 'polish';

  // The sitting ends when the queue runs out — including the repeats it grew along the way.
  useEffect(() => {
    if (!done || finished.current) return;
    finished.current = true;
    finishRef.current(events, introduced.current.size);
  }, [done, events]);

  // Reset the clock whenever a new card comes up. The measurement starts when the card is visible,
  // not when it was queued.
  useEffect(() => {
    if (!result) shownAt.current = Date.now();
  }, [index, result]);

  useEffect(() => {
    if (key && (working[cardId]?.status ?? 'new') === 'new') introduced.current.add(cardId);
  }, [cardId, key, working]);

  const advance = useCallback(() => {
    setResult(null);
    setPicked([]);
    setMode(null);
    setIndex((i) => i + 1);
  }, []);

  // A correct answer moves on by itself; a wrong one waits, because the point of showing which slot
  // was wrong is that there is time to read it.
  useEffect(() => {
    if (!result?.correct) return;
    const timer = window.setTimeout(advance, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [result, advance]);

  // --- what the current card is about --------------------------------------------------------

  const expected = useMemo(() => (key ? answerChords(key) : []), [key]);
  const expectedMode: Mode = key ? patternMode(key.pattern) : 'major';
  const answerKeyOf = key
    ? keyOf(key.direction === 'transpose' ? key.to : key.tonic, key.pattern)
    : { tonic: 0 as PitchClass, mode: 'major' as Mode };

  /** How many taps the card wants. A `key` card wants a tonic, and a mode when minor is in scope. */
  const wanted = key ? (key.direction === 'key' ? (wantsMode ? 2 : 1) : expected.length) : 0;

  const filled = key?.direction === 'key' ? picked.length + (mode || !wantsMode ? 1 : 0) : picked.length;
  const ready = key != null && picked.length >= (key.direction === 'key' ? 1 : expected.length) &&
    (key.direction !== 'key' || !wantsMode || mode != null);

  const submit = useCallback(() => {
    if (!cardId || !key || result || !ready) return;
    const now = Date.now();
    const ms = Math.max(0, now - shownAt.current);

    const chosenMode: Mode = key.direction === 'key' ? (mode ?? 'major') : expectedMode;
    const expectedPcs =
      key.direction === 'key' ? [key.tonic] : expected.map((c) => c.pc);
    const correct =
      picked.length === expectedPcs.length &&
      picked.every((pc, i) => pc === expectedPcs[i]) &&
      chosenMode === expectedMode;

    const rating = ratingFromAnswer(correct, ms, answerLength(key, wantsMode));
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
      // Pitch classes, not names: `answered` goes to the log and the cloud, and a name in it would
      // split one card's history the day the notation setting was touched.
      answered:
        key.direction === 'key' ? `${picked[0]}:${chosenMode}` : picked.join(' '),
    };
    onAnswer(event);
    setEvents((prev) => [...prev, event]);
    setWorking((prev) => ({ ...prev, [cardId]: updated }));
    setResult({
      correct,
      ms,
      picked,
      pickedMode: key.direction === 'key' ? chosenMode : null,
      expected: expectedPcs,
      expectedMode,
    });

    // Put it back if the scheduler wants it again this sitting — and stop growing the queue once it
    // has run to three times its intended length, so a bad run cannot make it endless.
    const room = queue.length < settings.sessionLength * MAX_ANSWERS_FACTOR;
    if (room && isDueWithin(updated, now, SESSION_HORIZON_MS)) {
      // Cards not yet attempted this sitting report 0 and so keep their place at the front.
      const dueOf = (id: string) => (id === cardId ? updated.due : working[id]?.due ?? 0);
      setQueue((q) => requeue(q, index, cardId, updated.due, dueOf));
    }
  }, [
    cardId,
    events.length,
    expected,
    expectedMode,
    index,
    key,
    mode,
    onAnswer,
    picked,
    queue.length,
    ready,
    result,
    sessionId,
    settings.sessionLength,
    wantsMode,
    working,
  ]);

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

  // --- keyboard -------------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (result) {
        if (isCommitKey(e.key) && !result.correct) {
          e.preventDefault();
          advance();
        }
        return;
      }
      if (!key) return;
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
  }, [advance, key, notation, pick, result, submit]);

  // An id this build cannot read is not a card to ask. Settings sync between devices, so a newer
  // build can name a pattern this one has never heard of; skipping the card keeps the sitting going
  // where returning null used to end it on a blank screen.
  useEffect(() => {
    if (cardId && !key) advance();
  }, [advance, cardId, key]);

  if (!key || !cardId) return null;

  // --- what to draw ---------------------------------------------------------------------------

  const prompt = promptChords(key);
  const promptKey = keyOf(key.direction === 'transpose' ? key.from : key.tonic, key.pattern);

  const questionSlots: Slot[] = prompt.map((c) => ({
    pc: c.pc,
    quality: c.quality,
  }));

  const answerSlots: Slot[] =
    key.direction === 'key'
      ? [{ pc: picked[0] ?? null, quality: 'major' }]
      : expected.map((c, i) => ({
          pc: picked[i] ?? null,
          quality: c.quality,
          // Only a `degrees` card names its degrees: on a `transpose` card the numerals would
          // hand over one of the two routes to the answer.
          numeral: key.direction === 'degrees' ? expectedNumeral(key, i) : undefined,
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
    <div className="tp-session">
      <div className="tp-session-bar">
        <span className="tp-counter">
          {t.answered}: <strong>{events.length}</strong>
        </span>
        <span className="tp-counter">
          {t.left}: <strong>{queue.length - index}</strong>
        </span>
        <button
          type="button"
          className="tp-btn tp-btn--quiet"
          onClick={() => {
            finished.current = true;
            onFinish(events, introduced.current.size);
          }}
        >
          {t.endSession}
        </button>
      </div>

      {/* The question. A `degrees` card has no chords to show, so it asks in words. */}
      <div className="tp-prompt">
        {key.direction === 'degrees' ? (
          <>
            <span className="tp-prompt-degrees">
              {answerChords(key)
                .map((_, i) => expectedNumeral(key, i))
                .join(' ')}
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

      {/* The verdict is drawn over the row the answer is built in, so it lands where the eye
          already is rather than in the row below. */}
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
              <button type="button" className="tp-btn" onClick={advance}>
                {t.next}
              </button>
            )}
          </>
        ) : (
          <span className="tp-hint">{instruction}</span>
        )}
      </div>

      {/* The songbook line, shown only *after* the answer — on a `key` card the title would give
          the answer away, and on the others it would narrow the guess. */}
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
    </div>
  );
}

/**
 * The Roman numeral of the card's `i`th degree — the question on a `degrees` card.
 *
 * Through `chordsOf` rather than a second table, so the numerals printed under the slots and the
 * chords they are graded against cannot come apart.
 */
function expectedNumeral(key: CardKey, i: number): string {
  const tonic = key.direction === 'transpose' ? key.to : key.tonic;
  return chordsOf(tonic, key.pattern)[i]?.numeral ?? '';
}
