/*
 * What a card is, and how it is named.
 *
 * Three directions, and they are three different skills rather than three ways of asking one
 * thing — the same argument the fretboard trainer makes for splitting `name` from `find`:
 *
 *   - `transpose` — "A D E, into the key of C". Move a progression you are looking at. This is the
 *     thing you actually do when somebody calls a key, and it can be answered two ways: count
 *     three semitones onto each chord, or read the degrees and re-issue them. Both are the skill.
 *   - `degrees` — "I, IV, V in A". Issue a key's chords from nothing. Nobody handed you a
 *     progression to move, so the interval arithmetic is not available and only the key is.
 *   - `key` — "A D E — what key?". The other way round: recognise a set of chords as a key. It is
 *     what makes the first two anything more than arithmetic, and it is the one you use reading a
 *     chart you have never seen.
 *
 * A card id is `${direction}:${numbers}:${pattern}` with the notation suffixes below. The numbers
 * are pitch classes (0 = C), never note names, for the reason `ReviewEvent.answered` stays
 * international on the fretboard: a name in an id would split one card's history the day the
 * notation setting was touched.
 */

import type { Notation, PatternId, PitchClass } from './theory';
import {
  NOTATIONS,
  PATTERNS,
  chordLabels,
  chordsOf,
  isPatternId,
  keyLabel,
  keyOf,
  mod12,
  patternMode,
} from './theory';

export type Direction = 'transpose' | 'degrees' | 'key';

export const DIRECTIONS: Direction[] = ['transpose', 'degrees', 'key'];

export function isDirection(value: unknown): value is Direction {
  return DIRECTIONS.includes(value as Direction);
}

interface CardKeyBase {
  pattern: PatternId;
  notation: Notation;
}

export interface TransposeCardKey extends CardKeyBase {
  direction: 'transpose';
  /** The key the chords on the card are written in. */
  from: PitchClass;
  /** The key they are to be moved into. */
  to: PitchClass;
}

export interface DegreesCardKey extends CardKeyBase {
  direction: 'degrees';
  tonic: PitchClass;
}

export interface KeyCardKey extends CardKeyBase {
  direction: 'key';
  tonic: PitchClass;
}

export type CardKey = TransposeCardKey | DegreesCardKey | KeyCardKey;

/** The tonic the card's *answer* is in — the target of a transpose, the subject of the other two. */
export function answerTonic(key: CardKey): PitchClass {
  return key.direction === 'transpose' ? key.to : key.tonic;
}

// --- what a card prints -------------------------------------------------------------------------

/**
 * Every word the card puts on screen that a notation could change.
 *
 * This is what decides whether a card splits along a notation axis, so it has to be everything —
 * the prompt, the slots once filled, and the answer read out under a wrong one. Miss a label here
 * and two cards that look different share one schedule.
 */
export function cardLabels(key: CardKey, notation: Notation): string[] {
  switch (key.direction) {
    case 'transpose':
      return [
        ...chordLabels(key.from, key.pattern, notation),
        keyLabel(keyOf(key.to, key.pattern), notation),
        ...chordLabels(key.to, key.pattern, notation),
      ];
    case 'degrees':
    case 'key':
      return [
        keyLabel(keyOf(key.tonic, key.pattern), notation),
        ...chordLabels(key.tonic, key.pattern, notation),
      ];
  }
}

/**
 * The notation a card is actually *about*, with a system it cannot tell apart normalised away.
 *
 * `C F G` reads the same in all three, so there is one card and not three; `F B C` differs only in
 * what B flat is called, so `polish` and `german` collapse and there are two. This is the
 * fretboard's `hasTwoNotations` rule, decided by comparing what the card would print rather than
 * against a list of pitch classes — so the axis cannot drift from the names.
 *
 * The first system in `NOTATIONS` printing the same words wins, which is what makes this a
 * function of the words alone and therefore stable: any two systems that agree on a card always
 * agree on the same representative, whichever of them was asked for.
 */
export function canonicalNotation(key: CardKey): Notation {
  const words = cardLabels(key, key.notation).join(' ');
  for (const notation of NOTATIONS) {
    if (cardLabels(key, notation).join(' ') === words) return notation;
  }
  return key.notation;
}

/**
 * Which notation to *draw the screen* in, given the ones the player has selected.
 *
 * Not the same question as `canonicalNotation`, and conflating the two is a trap. The canonical
 * notation is what the card is filed under, and it collapses systems the card cannot tell apart:
 * `D G A → A♭ D♭ E♭` reads the same in Polish and international, so the card is the Polish one
 * whichever was asked for. But the **pad** shows all twelve pitch classes, including ones the card
 * never prints — so drawing it in the card's canonical notation put a button labelled `B` in front
 * of a player who had selected international names only, where `B` is B natural and here it meant
 * B flat. That is the one confusion this whole notation axis exists to drill, handed to them by the
 * app.
 *
 * So: the first selected system that would have minted this card. Its labels are identical to the
 * card's by construction — that is what "would have minted it" means — so the card reads the same
 * and the pad reads as the player asked.
 *
 * When none of them would have, the fallback is the card's **own** notation rather than the first
 * selected one, and that direction matters: falling back to the selection would print `As Des Es`
 * on a card filed as `Ab Db Eb`, which is the first bug again with the two halves swapped. A card
 * is what it is. The cost is a pad in a system the player has since turned off, and that can only
 * happen to a card already out of scope — `scopeIds` would mint the other one now — so it is not a
 * card a sitting should be drawing anyway.
 */
export function displayNotation(key: CardKey, available: readonly Notation[]): Notation {
  // Against the canonical rather than `key.notation`, so this answers the same for a key straight
  // out of `parseCardId` (already canonical) and one built by hand from a notation that collapses.
  const canonical = canonicalNotation(key);
  for (const notation of available) {
    if (canonicalNotation({ ...key, notation }) === canonical) return notation;
  }
  return canonical;
}

/** `:de` for the German syllables, `:in` for international names. Polish is the unsuffixed one. */
function notationSuffix(notation: Notation): string {
  if (notation === 'german') return ':de';
  if (notation === 'international') return ':in';
  return '';
}

// --- ids ----------------------------------------------------------------------------------------

export function cardId(key: CardKey): string {
  const suffix = notationSuffix(canonicalNotation(key));
  const subject =
    key.direction === 'transpose' ? `${mod12(key.from)}-${mod12(key.to)}` : `${mod12(key.tonic)}`;
  return `${key.direction}:${subject}:${key.pattern}${suffix}`;
}

const PITCH_CLASS = /^(?:[0-9]|1[01])$/;

/**
 * Read a card id back.
 *
 * Refuses anything this build could not have written, which includes a notation suffix on a card
 * whose labels do not vary along that axis: `degrees:0:145:in` names no card — C F G is C F G
 * under every notation — and folding an answer to it into the deck would give a second schedule to
 * a question that only exists once. That is a corrupt record rather than a card, and the fretboard
 * trainer refuses the same shape of thing for the same reason.
 *
 * A `transpose` card from a key to itself is refused on the same grounds: `cardId` cannot mint one
 * (`scopeIds` skips it), and "transpose C F G into C" is not a question.
 */
export function parseCardId(id: string): CardKey | null {
  const parts = id.split(':');
  if (parts.length < 3 || parts.length > 4) return null;

  const [direction, subject, pattern, suffix] = parts;
  if (!isDirection(direction) || !isPatternId(pattern)) return null;

  const notation: Notation =
    suffix === undefined
      ? 'polish'
      : suffix === 'de'
        ? 'german'
        : suffix === 'in'
          ? 'international'
          : ('' as Notation);
  if (!notation) return null;

  let key: CardKey;
  if (direction === 'transpose') {
    const [from, to] = subject.split('-');
    if (!PITCH_CLASS.test(from ?? '') || !PITCH_CLASS.test(to ?? '')) return null;
    if (from === to) return null;
    key = { direction, from: Number(from), to: Number(to), pattern, notation };
  } else {
    if (!PITCH_CLASS.test(subject)) return null;
    key = { direction, tonic: Number(subject), pattern, notation };
  }

  // Round-trip, which is what rejects a suffix that could never have been minted.
  return cardId(key) === id ? key : null;
}

// --- what a card asks for -------------------------------------------------------------------------

/**
 * The chords the card is answered with, in degree order.
 *
 * Empty for a `key` card, which is answered with a key rather than a set of chords — see
 * `answerKey`.
 */
export function answerChords(key: CardKey): { pc: PitchClass; quality: 'major' | 'minor' }[] {
  if (key.direction === 'key') return [];
  return chordsOf(answerTonic(key), key.pattern).map(({ pc, quality }) => ({ pc, quality }));
}

/** The key a `key` card is answered with. */
export function answerKey(key: KeyCardKey) {
  return keyOf(key.tonic, key.pattern);
}

/** The chords printed on the front of the card, in degree order. Empty on a `degrees` card. */
export function promptChords(key: CardKey) {
  if (key.direction === 'degrees') return [];
  const tonic = key.direction === 'transpose' ? key.from : key.tonic;
  return chordsOf(tonic, key.pattern);
}

/**
 * How many taps the card is asking for — what the rating's speed thresholds are budgeted per.
 *
 * A four-chord answer cannot be given in the two seconds one tap gets, so measuring it against the
 * one-tap budget would grade every answer to it `hard` and hold the whole direction at day one
 * forever. Exactly the argument `ratingFromAnswer`'s `targets` was added for.
 */
export function answerLength(key: CardKey, asksMode: boolean): number {
  if (key.direction === 'key') return asksMode ? 2 : 1;
  return PATTERNS[key.pattern].degrees.length;
}

/**
 * What holds two cards apart in a sitting.
 *
 * The **answer**, because that is what leaks: `degrees:9:145` and `key:9:145` are the two ways
 * round of one fact, and back to back the second is not thought about at all. A `transpose` card
 * is keyed on its target for the same reason — it produces that key's chords. Its *source* key is
 * the secondary leak and cannot be keyed away as well; one key per card is what `spreadBy` has,
 * and this is the one that matters. Same trade, and same reasoning, as `spreadPositions`.
 */
export function subjectOf(key: CardKey): string {
  return `${answerTonic(key)}:${patternMode(key.pattern)}`;
}
