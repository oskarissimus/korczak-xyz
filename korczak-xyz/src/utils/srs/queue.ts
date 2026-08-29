/*
 * What a sitting asks, and in what order.
 *
 * **What to ask is a weighted sample of what is due; what order to ask it in is the shuffle.**
 * Keeping those apart is the whole design here, and it is not specific to any one deck. Order
 * carries no information once the cards are drawn, and a fixed one is something you learn instead
 * of the material — hence the shuffle.
 *
 * Selection used to be the top `sessionLength` by due date, which made a sitting predictable in
 * *content*: sixty cards due and a sitting of ten is the same ten every time, and the shuffle only
 * reordered them. But a plain random handful is not the answer either — that abandons the
 * schedule, and with ten drawn from sixty about one card in twelve waits over a fortnight. So the
 * draw is two tiers, and only one of them is a preference:
 *
 *   1. `BACKLOG_DEADLINE_MS` is a **guarantee**. Anything overdue by more than it is taken
 *      outright, oldest first. That is the whole of what stops a card rotting in the backlog, and
 *      no weighting can stand in for it — a soft bias moves the average and leaves the tail.
 *   2. Everything else is a **weighted sample**, tilted only slightly towards the older cards.
 *
 * Nothing in this file knows what a card *is*. Each app hands over the cards in its own scope and
 * a `spread` function that pulls apart the ones that would give each other away; both of those
 * are the app's business and neither is this module's.
 */

import type { Bucket, Card, Deck } from './types';
import { DAY, bucketOf, isDue } from './scheduler';

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
 * How long a card may wait past its due date before the sitting has to take it.
 *
 * This is a promise about wall-clock waiting, not a scheduling parameter: the scheduler has
 * already said when it wants the card, and this says how far behind that we are willing to fall
 * before the sample stops being consulted. Four days, because a week was judged too long to
 * discover a card had been quietly skipped over.
 *
 * It doubles as the scale of the weighting below, which is why there is one constant here and not
 * two. A card just due weighs 1, a card at the deadline would weigh 2 — and by then it is not
 * being sampled at all, so the two tiers meet without a step.
 */
export const BACKLOG_DEADLINE_MS = 4 * DAY;

/**
 * How much more likely an overdue card is to be sampled than one that has only just fallen due.
 *
 * Linear in how long it has waited, and bounded by construction: past `BACKLOG_DEADLINE_MS` the
 * card is not sampled at all, so nothing that reaches this function weighs as much as 2. That
 * bound is the point — the bias is meant to be felt and not obeyed, and a weight free to grow
 * would quietly turn the sample back into the oldest-first slice it replaced.
 */
function overdueWeight(card: Card, now: number): number {
  return 1 + Math.max(0, now - card.due) / BACKLOG_DEADLINE_MS;
}

/** What one sitting draws from the cards that are due, split by which rule put them there. */
export interface DueDraw {
  /** Past the deadline, so taken outright rather than sampled. Oldest first. */
  forced: string[];
  /** Drawn from the rest by weight. */
  sampled: string[];
}

/**
 * Choose up to `limit` of the cards that are due.
 *
 * The two halves come back separately because the caller has to keep them apart: a sitting can
 * still lose cards off the end of its queue to the new-card ration, and it is the sampled ones
 * that must go. Hand back one merged list and the deadline stops being a guarantee — a rescued
 * card would be dropped by the very slice it was rescued into.
 *
 * The sample is Efraimidis–Spirakis: each card takes the key `u^(1/w)` for a uniform `u`, and the
 * largest `k` keys are a weighted sample without replacement. One pass and a sort, and it draws
 * from `rng` exactly as the shuffle does, so a seeded sitting is still reproducible end to end.
 */
export function sampleDue(cards: Card[], limit: number, now: number, rng: () => number): DueDraw {
  if (limit <= 0) return { forced: [], sampled: [] };

  const overdue: Card[] = [];
  const rest: Card[] = [];
  for (const card of cards) {
    (now - card.due >= BACKLOG_DEADLINE_MS ? overdue : rest).push(card);
  }

  // More past the deadline than the sitting holds is simply being behind, and then oldest-first is
  // the right answer and the one this used to give unconditionally.
  const forced = overdue
    .sort((a, b) => a.due - b.due)
    .slice(0, limit)
    .map((c) => c.id);

  const room = limit - forced.length;
  if (room <= 0) return { forced, sampled: [] };

  const sampled = rest
    .map((card) => ({ id: card.id, key: rng() ** (1 / overdueWeight(card, now)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, room)
    .map((entry) => entry.id);

  return { forced, sampled };
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
 * minute-scale steps is that they come back promptly. They are shuffled among themselves, and
 * never sampled — there are few of them and skipping one is the ladder failing to do its job.
 *
 * The reviews behind them are `sampleDue`'s two tiers. New cards are already a random draw from
 * the whole scope, capped by `newPerSession`, and are interleaved through the reviews so that six
 * of them never arrive in a row.
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

  // A weighted sample of what is due, with anything past the deadline taken outright. The two
  // halves are shuffled separately and the forced ones kept in front: the slice at the end of this
  // function eats the tail of `review`, so putting the rescued cards anywhere but the head would
  // let the new-card ration drop the very cards the deadline exists to protect.
  const draw = sampleDue(
    cards.filter((c) => c.status === 'review' && c.due <= now),
    shape.sessionLength,
    now,
    rng
  );
  const review = [...shuffle(draw.forced, rng), ...shuffle(draw.sampled, rng)];

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
