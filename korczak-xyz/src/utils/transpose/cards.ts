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
 * A card id is `${direction}:${numbers}:${pattern}` with the notation and ordering suffixes below.
 * The numbers are pitch classes (0 = C), never note names, for the reason `ReviewEvent.answered`
 * stays international on the fretboard: a name in an id would split one card's history the day the
 * notation setting was touched.
 */

import type { Chord, Notation, PatternId, PitchClass } from './theory';
import {
  NOTATIONS,
  PATTERNS,
  chordLabels,
  chordsOf,
  isPatternId,
  keyLabel,
  keyOf,
  mod12,
  patternLength,
  patternMode,
} from './theory';

export type Direction = 'transpose' | 'degrees' | 'key';

export const DIRECTIONS: Direction[] = ['transpose', 'degrees', 'key'];

export function isDirection(value: unknown): value is Direction {
  return DIRECTIONS.includes(value as Direction);
}

// --- the ordering axis ----------------------------------------------------------------------------

/**
 * Which order a card puts a pattern's degrees in — a permutation of `0 … n-1`, position by
 * position: `[2, 0, 1]` shows the third degree first, then the first, then the second.
 *
 * A **deck axis**, like the notation, and for a blunter reason than any of the others: without it
 * every card in this trainer printed its tonic first, and all three directions leaked their answer
 * because of it.
 *
 *   - `key` — "H E F# — which key?" is answered by reading the first chord. The other two are
 *     never looked at.
 *   - `transpose` — "A D E → into C" can be answered without reading the source progression at
 *     all: take the target key off the prompt and spell its I IV V. The chords you were asked to
 *     move are decoration.
 *   - `degrees` — always "I, IV, V in A", in that order, so the row is answered by counting 0, 5,
 *     7 up from the tonic once rather than by knowing each degree on its own.
 *
 * Shuffling the order per appearance would have fixed all three too, and more cheaply. It is a
 * deck axis instead because reading `F# H E` as B major is a thing to have learnt, and a thing
 * learnt gets a schedule here — the same argument that splits a black key's `find` card by
 * spelling and every card by notation. The cost is real and is `n!`: six cards for a three-chord
 * pattern and **twenty-four** for `I IV V vi`. `Settings.keys` is what pays for it — see
 * `tonicsFor` in `deck.ts`.
 */
export type Order = readonly number[];

/** `[0, 1, … n-1]` — degree order, the way this deck asked everything before the axis existed. */
function identityOrder(n: number): Order {
  return Array.from({ length: n }, (_, i) => i);
}

function isIdentity(order: Order): boolean {
  return order.every((position, i) => position === i);
}

/** Rearrange a pattern's degrees into the order a card asks them in. */
export function applyOrder<T>(items: readonly T[], order: Order): T[] {
  return order.map((position) => items[position]);
}

/**
 * Every permutation of `0 … n-1`, lexicographic — which is what puts the identity first.
 *
 * Order matters here beyond tidiness: `scopeIds` is a stable enumeration that the deck counts and
 * `ensureCards` both read, and the identity leading it is the migration below made visible.
 */
function permutations(n: number): Order[] {
  const out: Order[] = [];
  const build = (prefix: number[], left: number[]) => {
    if (left.length === 0) {
      out.push(prefix);
      return;
    }
    for (let i = 0; i < left.length; i++) {
      build([...prefix, left[i]], [...left.slice(0, i), ...left.slice(i + 1)]);
    }
  };
  build([], identityOrder(n) as number[]);
  return out;
}

const ORDERINGS = new Map<PatternId, Order[]>();

/**
 * Every ordering of a pattern's degrees. Cached because `scopeIds` asks for it once per tonic, per
 * direction, per notation, and the answer is four arrays of at most twenty-four.
 */
export function orderingsOf(pattern: PatternId): Order[] {
  let cached = ORDERINGS.get(pattern);
  if (!cached) {
    cached = permutations(patternLength(pattern));
    ORDERINGS.set(pattern, cached);
  }
  return cached;
}

/** The one every stored deck and every logged answer already names. */
export function degreeOrder(pattern: PatternId): Order {
  return orderingsOf(pattern)[0];
}

interface CardKeyBase {
  pattern: PatternId;
  notation: Notation;
  /**
   * Required rather than defaulted, for the reason `pitchLabel` takes its notation as a required
   * argument: a defaulted order is how one call site goes on quietly printing degree order after
   * every other has stopped.
   */
  order: Order;
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
 *
 * In **degree order**, whatever order the card asks in. Permuting cannot add or remove a word, so
 * the notation axis cannot depend on the ordering axis — which is what lets `canonicalNotation` be
 * memoised on a key with the order stripped out of it.
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

/** The pitch classes an id carries: `9-0` for a transpose, `9` for the other two. */
function subjectPart(key: CardKey): string {
  return key.direction === 'transpose'
    ? `${mod12(key.from)}-${mod12(key.to)}`
    : `${mod12(key.tonic)}`;
}

/*
 * The order is deliberately absent from this cache key. `cardLabels` reads everything else about a
 * card and ignores the ordering, so two orderings of one card always canonicalise the same — see
 * the note there. Without the memo, `scopeIds` on a full scope builds tens of thousands of label
 * arrays, and it runs on every `buildQueue` and every stats render.
 */
const CANONICAL = new Map<string, Notation>();

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
  const cacheKey = `${key.direction}:${subjectPart(key)}:${key.pattern}:${key.notation}`;
  const hit = CANONICAL.get(cacheKey);
  if (hit) return hit;

  const words = cardLabels(key, key.notation).join(' ');
  let found = key.notation;
  for (const notation of NOTATIONS) {
    if (cardLabels(key, notation).join(' ') === words) {
      found = notation;
      break;
    }
  }
  CANONICAL.set(cacheKey, found);
  return found;
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

/**
 * `:o201` for the ordering — and **nothing at all for degree order**.
 *
 * That is a migration rather than a preference, and the same one `:b` and `:de` made before it:
 * `key:11:145` is what every stored deck and every logged answer already names, so leaving it
 * unsuffixed keeps the schedule it earnt and lets the other orderings arrive as the new material
 * they are. Suffixing the identity instead would have retired every card in every deck.
 */
function orderSuffix(order: Order): string {
  return isIdentity(order) ? '' : `:o${order.join('')}`;
}

// --- ids ----------------------------------------------------------------------------------------

export function cardId(key: CardKey): string {
  const suffix = notationSuffix(canonicalNotation(key));
  return `${key.direction}:${subjectPart(key)}:${key.pattern}${suffix}${orderSuffix(key.order)}`;
}

const PITCH_CLASS = /^(?:[0-9]|1[01])$/;
const ORDER_TOKEN = /^o[0-9]+$/;

/** Read `o201` back, against the length the pattern actually has. Null unless it is a permutation. */
function readOrder(token: string, n: number): Order | null {
  const digits = token.slice(1);
  if (digits.length !== n) return null;
  const order = [...digits].map(Number);
  const seen = new Set(order);
  if (seen.size !== n) return null;
  if (order.some((position) => position < 0 || position >= n)) return null;
  return order;
}

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
 *
 * The two suffixes are read as a bag rather than by position, so the reader has one rule where the
 * writer has an order to keep. The round-trip at the end is what makes that safe — it rejects a
 * pair written the wrong way round, a repeated suffix and an explicitly-written degree order
 * (`key:11:145:o012`) without any of those needing a case here.
 */
export function parseCardId(id: string): CardKey | null {
  const parts = id.split(':');
  if (parts.length < 3 || parts.length > 5) return null;

  const [direction, subject, pattern] = parts;
  if (!isDirection(direction) || !isPatternId(pattern)) return null;

  let notation: Notation | null = null;
  let order: Order | null = null;
  for (const token of parts.slice(3)) {
    if (token === 'de' || token === 'in') {
      if (notation) return null;
      notation = token === 'de' ? 'german' : 'international';
    } else if (ORDER_TOKEN.test(token)) {
      if (order) return null;
      order = readOrder(token, patternLength(pattern));
      if (!order) return null;
    } else {
      return null;
    }
  }
  notation ??= 'polish';
  order ??= degreeOrder(pattern);

  let key: CardKey;
  if (direction === 'transpose') {
    const [from, to] = subject.split('-');
    if (!PITCH_CLASS.test(from ?? '') || !PITCH_CLASS.test(to ?? '')) return null;
    if (from === to) return null;
    key = { direction, from: Number(from), to: Number(to), pattern, notation, order };
  } else {
    if (!PITCH_CLASS.test(subject)) return null;
    key = { direction, tonic: Number(subject), pattern, notation, order };
  }

  // Round-trip, which is what rejects a suffix that could never have been minted.
  return cardId(key) === id ? key : null;
}

// --- what a card asks for -------------------------------------------------------------------------

/**
 * The chords the card is answered with, **in the order the card asks them**.
 *
 * The numeral travels with each one, so the degree printed under a slot and the chord that slot is
 * graded against come out of a single permuted list. They used to be two independent `chordsOf`
 * calls, which is two places for one ordering to be applied and one place for it to be forgotten.
 *
 * Empty for a `key` card, which is answered with a key rather than a set of chords — see
 * `answerKey`.
 */
export function answerChords(key: CardKey): Chord[] {
  if (key.direction === 'key') return [];
  return applyOrder(chordsOf(answerTonic(key), key.pattern), key.order);
}

/** The key a `key` card is answered with. */
export function answerKey(key: KeyCardKey) {
  return keyOf(key.tonic, key.pattern);
}

/**
 * The chords printed on the front of the card, in the order the card asks them. Empty on a
 * `degrees` card, which has no progression to show.
 *
 * On a `transpose` card this is the *same* permutation the answer slots take, so slot `i` answers
 * chord `i` and a wrong answer can still name which one went wrong.
 */
export function promptChords(key: CardKey): Chord[] {
  if (key.direction === 'degrees') return [];
  const tonic = key.direction === 'transpose' ? key.from : key.tonic;
  return applyOrder(chordsOf(tonic, key.pattern), key.order);
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
 *
 * The ordering axis needs nothing here and leans on it harder than anything else does: every
 * ordering of one card shares its answer, so they share this key and `spreadSubjects` holds them
 * apart. Back to back, `H E F#` and `E F# H` are one question asked twice — which is the giveaway
 * the axis exists to remove, wearing a different hat.
 */
export function subjectOf(key: CardKey): string {
  return `${answerTonic(key)}:${patternMode(key.pattern)}`;
}
