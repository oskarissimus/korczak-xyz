/*
 * The deck: which cards exist, which of them a sitting should ask, and in what order.
 *
 * Scope is a setting rather than a fixed deck, because "the notes on a guitar" is not one thing
 * you learn — the first five frets are a different skill from the twelfth, and a deck that mixes
 * them from the first sitting never gets anywhere. Cards outside the current scope are kept, not
 * deleted: widen the range again and the schedule you had earnt is still there.
 */

import {
  MAX_FRET,
  STRING_COUNT,
  cardId,
  hasTwoSpellings,
  isPositionKey,
  midisInScope,
  noteNameAt,
  parseCardId,
  pitchCardId,
  pitchClassOfMidi,
  positionsSounding,
} from './notes';
import type { CardKey, Direction, NoteName, PositionCardKey, Spelling } from './notes';
import { isInScale, keySpelling } from './scales';
import type { Bucket, Card } from './srs';
import { bucketOf, createCard, isDue } from './srs';
import type { Deck, Settings } from './types';

/**
 * The fewest cards between an answer and its repeat.
 *
 * Only ever binds at the tail of a sitting. Its job is to stop a card being asked twice in a
 * row, which is not a memory test — the answer is still on the screen you just read.
 */
export const MIN_REQUEUE_GAP = 2;

/**
 * A repeat is only worth queuing if the card wants to be seen again soon. Anything past this
 * belongs to another day, and asking it now would be overruling a decision the scheduler has
 * already made.
 */
export const SESSION_HORIZON_MS = 20 * 60_000;

/** Hard ceiling on one sitting, so a run of bad answers cannot make the queue immortal. */
export const MAX_ANSWERS_FACTOR = 3;

/**
 * Every card the current scope contains.
 *
 * A stable enumeration, not a running order — `ensureCards`, the deck counts and the heatmap all
 * read it and none of them care what order it comes in. What a sitting asks, and in what order,
 * is `buildQueue`'s business, and it shuffles.
 *
 * A black key is two `find` cards, not one. "Where is C♯ on the A string" and "where is D♭ on the
 * A string" have the same answer and are not the same question: music written in flats never says
 * C♯, and a card asking under both names at once lets you pass it while only ever reading one of
 * them. The `name` direction is not split — it asks what a pitch class is called, and both names
 * are right — so a natural is one card in each direction and a black key is one and two.
 *
 * A key narrows this and changes nothing else. Positions sounding a note outside the scale are
 * left out, and a black key inside it is **one** card rather than two: the key decides which of
 * its names to ask under, because G major contains F♯ and does not contain G♭. That is the same
 * argument the spelling split was made on, applied one level up. With no key set, every line
 * below is what it always was.
 */
export function scopeIds(settings: Settings): string[] {
  const ids: string[] = [];
  const strings = [...settings.strings].sort((a, b) => a - b);
  const directions = settings.directions.length > 0 ? settings.directions : (['name'] as Direction[]);
  const scale = settings.scale;

  // Which names a note in scope is asked under: both when there is no key, and the key's own
  // otherwise. A natural spells the same either way and is always the unsuffixed card.
  const spellings = (name: NoteName): Spelling[] => {
    if (!hasTwoSpellings(name)) return ['sharp'];
    return scale ? [keySpelling(scale)] : ['sharp', 'flat'];
  };

  for (let fret = 0; fret <= Math.min(settings.maxFret, MAX_FRET); fret++) {
    for (const string of strings) {
      if (string < 0 || string >= STRING_COUNT) continue;
      const note = noteNameAt(string, fret);
      if (!isInScale(scale, note)) continue;
      for (const direction of directions) {
        if (direction === 'pitch') continue; // enumerated by pitch below, not per position
        // Only `find` asks under one name at a time; a `name` card asks for the pitch class and
        // takes either, so it is one card whatever the key.
        if (direction !== 'find') {
          ids.push(cardId(direction, string, fret));
          continue;
        }
        for (const spelling of spellings(note)) ids.push(cardId(direction, string, fret, spelling));
      }
    }
  }
  // A `pitch` card is one pitch, not one position, so it is enumerated over the distinct pitches
  // the scope can sound rather than over the grid — several places on the neck answer each one.
  if (directions.includes('pitch')) {
    for (const midi of midisInScope(strings, Math.min(settings.maxFret, MAX_FRET))) {
      const note = pitchClassOfMidi(midi);
      if (!isInScale(scale, note)) continue;
      for (const spelling of spellings(note)) ids.push(pitchCardId(midi, spelling));
    }
  }
  return ids;
}

/** Add a card for every id in scope the deck does not have yet. Never removes any. */
export function ensureCards(deck: Deck, ids: string[]): Deck {
  const missing = ids.filter((id) => !deck[id]);
  if (missing.length === 0) return deck;
  const next = { ...deck };
  for (const id of missing) next[id] = createCard(id);
  return next;
}

export function cardsInScope(deck: Deck, settings: Settings): Card[] {
  return scopeIds(settings)
    .map((id) => deck[id])
    .filter((card): card is Card => card != null);
}

export interface DeckCounts {
  total: number;
  due: number; // scheduled cards the scheduler wants now
  fresh: number; // never-seen cards still available
  buckets: Record<Bucket, number>;
}

export function countDeck(cards: Card[], now: number): DeckCounts {
  const buckets: Record<Bucket, number> = { new: 0, learning: 0, young: 0, mature: 0 };
  let due = 0;
  let fresh = 0;
  for (const card of cards) {
    buckets[bucketOf(card)]++;
    if (card.status === 'new') fresh++;
    else if (isDue(card, now)) due++;
  }
  return { total: cards.length, due, fresh, buckets };
}

/** When the next scheduled card falls due, or null if the scope holds none. */
export function nextDueAt(cards: Card[], now: number): number | null {
  let soonest: number | null = null;
  for (const card of cards) {
    if (card.status === 'new') continue;
    if (card.due <= now) return now;
    if (soonest == null || card.due < soonest) soonest = card.due;
  }
  return soonest;
}

/**
 * Spread `extra` through `base` so the two arrive interleaved.
 *
 * New cards are the expensive ones; six in a row is where a sitting stops being a game. The
 * reviews between them are the rest.
 */
export function interleave(base: string[], extra: string[]): string[] {
  if (extra.length === 0) return base;
  if (base.length === 0) return extra;
  const out: string[] = [];
  const stride = base.length / extra.length;
  let taken = 0;
  for (let i = 0; i < base.length; i++) {
    while (taken < extra.length && taken * stride <= i) {
      out.push(extra[taken]);
      taken++;
    }
    out.push(base[i]);
  }
  out.push(...extra.slice(taken));
  return out;
}

/** Fisher–Yates. `rng` is injected so a sitting's order is reproducible in a test. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How many cards apart the cards asking about one position should be kept. */
export const MIN_POSITION_GAP = 3;

/**
 * Push apart cards that ask about the same place on the neck.
 *
 * `name:2-7` and `find:2-7` are different questions, but back to back the second one is answered
 * from having just read the first — and it lands in the log as a fast, correct answer, so the
 * scheduler pushes the card out and the stats page reports a fluency that was never demonstrated.
 * A shuffle alone does not fix this; it only makes the clumping unpredictable.
 *
 * The two spellings of a black key (`find:1-4` and `find:1-4:b`) are the sharpest case of it:
 * they share a position *and* an answer, so back to back the second is not even read. They land
 * on the same key here without being mentioned, because the key is the position.
 *
 * A `pitch` card has no single position — that is the point of it — so it is keyed on the lowest
 * one that sounds it. One key per card is all this function has, and that is the most useful one
 * available: the two spellings of a pitch share it, which is the same-answer case again, and the
 * card is also held apart from the `name`/`find` cards on that square. The pitch's other squares
 * are not covered, and a leak there is the mild one — a different place, read differently.
 *
 * Greedy: take the first remaining card whose position has not come up in the last `gap`, and
 * fall back to the first remaining card when none qualifies. The fallback is what makes this
 * total — a queue of nothing but one position has no valid arrangement — and it always returns a
 * permutation of its input.
 */
const ALL_STRINGS = Array.from({ length: STRING_COUNT }, (_, i) => i);

export function spreadPositions(queue: string[], gap = MIN_POSITION_GAP): string[] {
  const positionOf = (id: string) => {
    const key = parseCardId(id);
    if (!key) return id;
    if (isPositionKey(key)) return `${key.stringIndex}-${key.fret}`;
    // Keyed on the whole neck rather than the current scope, so the grouping is a property of the
    // card and does not shift when the settings do.
    const canonical = positionsSounding(key.midi, ALL_STRINGS, MAX_FRET)[0];
    return canonical ? `${canonical.stringIndex}-${canonical.fret}` : id;
  };

  const remaining = [...queue];
  const out: string[] = [];
  while (remaining.length > 0) {
    const recent = out.slice(-gap).map(positionOf);
    let pick = remaining.findIndex((id) => !recent.includes(positionOf(id)));
    if (pick < 0) pick = 0;
    out.push(remaining[pick]);
    remaining.splice(pick, 1);
  }
  return out;
}

export interface QueueOptions {
  /** Build a queue even though nothing is due, drawing the cards scheduled soonest. */
  ahead?: boolean;
  /** Source of randomness for the running order. Injected so tests can pin it. */
  rng?: () => number;
}

/**
 * The order a sitting asks its cards in.
 *
 * **What to ask is decided by due date; what order to ask it in is decided by the shuffle.**
 * Keeping those apart is the whole design here. A capped sitting must still draw the cards that
 * have waited longest — dropping those in favour of a random handful would quietly abandon the
 * schedule — but once drawn, the order they arrive in carries no information, and a fixed one is
 * something you learn instead of the neck. Deterministic order meant every sitting walked the
 * strings E, A, D, G, B, e in turn, which is a sequence you can answer without reading the card.
 *
 * Overdue learning cards still lead the queue: they are mid-acquisition, and the whole point of
 * minute-scale steps is that they come back promptly. They are shuffled among themselves.
 *
 * Cards answered during the sitting are put back by `requeue`, which is deliberately *not*
 * random — its due-time ordering is what guarantees a sitting keeps moving through its material.
 * So this is where the sitting starts, not how long it will be or what it ends up containing.
 */
export function buildQueue(
  deck: Deck,
  settings: Settings,
  now: number,
  options: QueueOptions = {}
): string[] {
  const rng = options.rng ?? Math.random;
  const cards = cardsInScope(deck, settings);
  const byDue = (a: Card, b: Card) => a.due - b.due;

  const learning = shuffle(
    cards
      .filter((c) => (c.status === 'learning' || c.status === 'relearning') && c.due <= now)
      .map((c) => c.id),
    rng
  );

  // Selected oldest-first, then shuffled: the sitting takes the most overdue cards it has room
  // for, and asks them in no particular order.
  const review = shuffle(
    cards
      .filter((c) => c.status === 'review' && c.due <= now)
      .sort(byDue)
      .slice(0, settings.sessionLength)
      .map((c) => c.id),
    rng
  );

  // Every unseen card in scope is a candidate, so the fret range is the whole curriculum: set it
  // to 0-5 and you meet those positions in any order, widen it and the rest join immediately.
  const fresh = shuffle(
    cards.filter((c) => c.status === 'new').map((c) => c.id),
    rng
  ).slice(0, Math.max(0, settings.newPerSession));

  const queue = [...learning, ...interleave(review, fresh)].slice(0, settings.sessionLength);
  if (queue.length > 0) return spreadPositions(queue);
  if (!options.ahead) return queue;

  // Nothing is due and a sitting was asked for anyway. Answering early is not free — the
  // scheduler grades it like any other answer — so take the cards closest to falling due.
  return spreadPositions(
    shuffle(
      cards
        .filter((c) => c.status !== 'new')
        .sort(byDue)
        .slice(0, settings.sessionLength)
        .map((c) => c.id),
      rng
    )
  );
}

/**
 * Put a card back into the queue, in front of everything that wants to be seen later than it.
 *
 * By due time, not by a fixed number of places. A fixed gap of `g` deadlocks on `g` cards that
 * keep being missed: each one re-inserts itself exactly `g` ahead, the same few cards cycle
 * forever, and nothing behind them is ever reached. Twenty-five answers, two cards seen — the
 * sitting never got past the first two positions in the deck.
 *
 * Due order has no such state. A card that has just been missed comes back in a minute; one
 * that made it up a step comes back in ten; a card not yet attempted this sitting has nothing
 * scheduled and sorts to the front of the queue, which is what guarantees the sitting keeps
 * moving through its material.
 *
 * `dueOf` reports when each queued card next wants asking — 0 for one that has not been
 * attempted yet.
 */
export function requeue(
  queue: string[],
  currentIndex: number,
  id: string,
  due: number,
  dueOf: (cardId: string) => number
): string[] {
  let at = queue.length;
  for (let i = currentIndex + 1; i < queue.length; i++) {
    if (dueOf(queue[i]) > due) {
      at = i;
      break;
    }
  }
  at = Math.min(Math.max(at, currentIndex + MIN_REQUEUE_GAP), queue.length);
  return [...queue.slice(0, at), id, ...queue.slice(at)];
}

/**
 * Every card the deck holds that is *about a position*, with that position decoded — for the
 * stats heatmap. `pitch` cards are left out because they are not about one square, and the
 * heatmap is a picture of squares.
 */
export function deckPositions(deck: Deck): { card: Card; key: PositionCardKey }[] {
  return Object.values(deck)
    .map((card) => ({ card, key: parseCardId(card.id) }))
    .filter((entry): entry is { card: Card; key: PositionCardKey } =>
      entry.key != null && isPositionKey(entry.key)
    );
}
