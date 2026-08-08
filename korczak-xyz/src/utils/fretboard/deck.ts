/*
 * The deck: which cards exist, which of them a sitting should ask, and in what order.
 *
 * Scope is a setting rather than a fixed deck, because "the notes on a guitar" is not one thing
 * you learn — the first five frets are a different skill from the twelfth, and a deck that mixes
 * them from the first sitting never gets anywhere. Cards outside the current scope are kept, not
 * deleted: widen the range again and the schedule you had earnt is still there.
 */

import { MAX_FRET, STRING_COUNT, cardId, parseCardId } from './notes';
import type { CardKey, Direction } from './notes';
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

export function scopeIds(settings: Settings): string[] {
  const ids: string[] = [];
  const strings = [...settings.strings].sort((a, b) => a - b);
  const directions = settings.directions.length > 0 ? settings.directions : (['name'] as Direction[]);
  // Fret-major: the open strings come first, then the first fret across all six, and so on.
  // That is the order the neck is actually learnt in — every position is found by counting up
  // from a string you already know, so the strings have to be known before anything above them.
  for (let fret = 0; fret <= Math.min(settings.maxFret, MAX_FRET); fret++) {
    for (const string of strings) {
      if (string < 0 || string >= STRING_COUNT) continue;
      for (const direction of directions) ids.push(cardId(direction, string, fret));
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

export interface QueueOptions {
  /** Build a queue even though nothing is due, drawing the cards scheduled soonest. */
  ahead?: boolean;
}

/**
 * The order a sitting asks its cards in.
 *
 * Overdue learning cards lead: they are mid-acquisition, and the whole point of minute-scale
 * steps is that they come back promptly. Then due reviews, oldest first, with new cards spread
 * through them. Cards answered during the sitting are put back by the caller — see `requeue` —
 * so this is where the sitting starts, not how long it will be.
 */
export function buildQueue(
  deck: Deck,
  settings: Settings,
  now: number,
  options: QueueOptions = {}
): string[] {
  const cards = cardsInScope(deck, settings);
  const byDue = (a: Card, b: Card) => a.due - b.due;

  const learning = cards
    .filter((c) => (c.status === 'learning' || c.status === 'relearning') && c.due <= now)
    .sort(byDue)
    .map((c) => c.id);

  const review = cards
    .filter((c) => c.status === 'review' && c.due <= now)
    .sort(byDue)
    .map((c) => c.id);

  // Scope order is the introduction order, and `cardsInScope` preserves it.
  const fresh = cards
    .filter((c) => c.status === 'new')
    .slice(0, Math.max(0, settings.newPerSession))
    .map((c) => c.id);

  const queue = [...learning, ...interleave(review, fresh)].slice(0, settings.sessionLength);
  if (queue.length > 0 || !options.ahead) return queue;

  // Nothing is due and a sitting was asked for anyway. Answering early is not free — the
  // scheduler grades it like any other answer — so take the cards closest to falling due.
  return cards
    .filter((c) => c.status !== 'new')
    .sort(byDue)
    .slice(0, settings.sessionLength)
    .map((c) => c.id);
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

/** Every card the deck holds, with its position decoded — for the stats heatmap. */
export function deckPositions(deck: Deck): { card: Card; key: CardKey }[] {
  return Object.values(deck)
    .map((card) => ({ card, key: parseCardId(card.id) }))
    .filter((entry): entry is { card: Card; key: CardKey } => entry.key != null);
}
