/*
 * What a sitting asks, and in what order.
 *
 * **What to ask is decided by due date; what order to ask it in is decided by the shuffle.**
 * Keeping those apart is the whole design here, and it is not specific to any one deck. A capped
 * sitting must still draw the cards that have waited longest — dropping those in favour of a
 * random handful would quietly abandon the schedule — but once drawn, the order they arrive in
 * carries no information, and a fixed one is something you learn instead of the material.
 *
 * Nothing in this file knows what a card *is*. Each app hands over the cards in its own scope and
 * a `spread` function that pulls apart the ones that would give each other away; both of those
 * are the app's business and neither is this module's.
 */

import type { Bucket, Card, Deck } from './types';
import { bucketOf, isDue } from './scheduler';

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

/** Add a card for every id in scope the deck does not have yet. Never removes any. */
export function ensureCards(deck: Deck, ids: string[], create: (id: string) => Card): Deck {
  const missing = ids.filter((id) => !deck[id]);
  if (missing.length === 0) return deck;
  const next = { ...deck };
  for (const id of missing) next[id] = create(id);
  return next;
}

export interface QueueOptions {
  /** Build a queue even though nothing is due, drawing the cards scheduled soonest. */
  ahead?: boolean;
  /** Source of randomness for the running order. Injected so tests can pin it. */
  rng?: () => number;
  /**
   * Pull apart cards that would answer each other. Applied last, to the queue as built — see
   * `spreadPositions` in the fretboard trainer and `spreadSubjects` in the transposition one.
   * Identity by default, which is the right behaviour for a deck whose cards do not overlap.
   */
  spread?: (queue: string[]) => string[];
}

export interface QueueShape {
  /** How many cards a sitting aims for, before in-session repeats. */
  sessionLength: number;
  /** Ceiling on unseen cards introduced in one sitting. */
  newPerSession: number;
}

/**
 * The order a sitting asks its cards in.
 *
 * Overdue learning cards lead the queue: they are mid-acquisition, and the whole point of
 * minute-scale steps is that they come back promptly. They are shuffled among themselves.
 *
 * Cards answered during the sitting are put back by `requeue`, which is deliberately *not*
 * random — its due-time ordering is what guarantees a sitting keeps moving through its material.
 * So this is where the sitting starts, not how long it will be or what it ends up containing.
 */
export function buildQueue(
  cards: Card[],
  shape: QueueShape,
  now: number,
  options: QueueOptions = {}
): string[] {
  const rng = options.rng ?? Math.random;
  const spread = options.spread ?? ((queue: string[]) => queue);
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
      .slice(0, shape.sessionLength)
      .map((c) => c.id),
    rng
  );

  // Every unseen card in scope is a candidate, so the scope setting is the whole curriculum: an
  // app's enumeration of it is a stable list and nothing more, not an introduction order.
  const fresh = shuffle(
    cards.filter((c) => c.status === 'new').map((c) => c.id),
    rng
  ).slice(0, Math.max(0, shape.newPerSession));

  const queue = [...learning, ...interleave(review, fresh)].slice(0, shape.sessionLength);
  if (queue.length > 0) return spread(queue);
  if (!options.ahead) return queue;

  // Nothing is due and a sitting was asked for anyway. Answering early is not free — the
  // scheduler grades it like any other answer — so take the cards closest to falling due.
  return spread(
    shuffle(
      cards
        .filter((c) => c.status !== 'new')
        .sort(byDue)
        .slice(0, shape.sessionLength)
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
 * sitting never got past the first two cards in the deck.
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
 * Greedily pull apart queued cards that share a subject.
 *
 * Two cards about the same thing are different questions, but back to back the second is
 * answered off the first — and it lands in the log as a fast, correct answer, so the scheduler
 * pushes the card out and the stats report a fluency that was never demonstrated. A shuffle
 * alone does not fix that; it only makes the clumping unpredictable.
 *
 * Take the first remaining card whose subject has not come up in the last `gap`, and fall back
 * to the first remaining card when none qualifies. The fallback is what makes this total — a
 * queue of nothing but one subject has no valid arrangement — and it always returns a
 * permutation of its input.
 */
export function spreadBy(
  queue: string[],
  subjectOf: (cardId: string) => string,
  gap: number
): string[] {
  const remaining = [...queue];
  const out: string[] = [];
  while (remaining.length > 0) {
    const recent = out.slice(-gap).map(subjectOf);
    let pick = remaining.findIndex((id) => !recent.includes(subjectOf(id)));
    if (pick < 0) pick = 0;
    out.push(remaining[pick]);
    remaining.splice(pick, 1);
  }
  return out;
}
