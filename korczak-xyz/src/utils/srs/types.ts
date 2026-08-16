/*
 * The record shapes every spaced-repetition trainer on this site shares.
 *
 * Two of them — the fretboard trainer and the transposition trainer — hold completely different
 * material and ask completely different questions, and none of that reaches this file. What they
 * have in common is the *shape of the history*: an answer is an immutable, uniquely identified
 * fact about one card, and the deck is a fold of those facts. That is what `replay.ts` needs and
 * all it needs, which is why these types live beside it rather than inside either app.
 *
 * A card id is an opaque string here. Each app owns its own grammar for it and its own parser;
 * nothing in this directory ever looks inside one.
 */

import type { Bucket, Card, Rating } from './scheduler';

/** Every card the app knows about, by id. */
export type Deck = Record<string, Card>;

/**
 * One answer.
 *
 * These are the record. Card state is a fold of them, which is what lets two devices merge by
 * unioning their logs instead of picking a winner — see `replay.ts`. So an event is immutable
 * once written, and `id` has to be unique across devices: `${sessionId}-${ordinal}`, where the
 * session id already carries a random suffix.
 */
export interface ReviewEvent {
  id: string;
  sessionId: string;
  cardId: string;
  at: number; // epoch ms
  ms: number; // time to answer
  correct: boolean;
  rating: Rating;
  /** What the player chose, in whatever form the app records answers. */
  answered: string;
}

/** What a finished sitting is remembered by. */
export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  answers: number; // answers given, counting in-session repeats
  correct: number;
  totalMs: number; // time spent answering, not wall clock
  cards: number; // distinct cards seen
  newIntroduced: number;
  masteredAfter: number; // mature cards in the deck when the sitting ended
}

/** A day's end-state, so mastery can be charted without replaying every answer. */
export interface MasterySnapshot {
  day: string; // YYYY-MM-DD, local
  at: number; // epoch ms of the last update that day
  counts: Record<Bucket, number>;
}

/**
 * The deck cache.
 *
 * Derived state, kept because the events it was folded from may have been pruned. `foldedThrough`
 * is the timestamp of the newest event already in it — everything newer can be folded on top,
 * and anything older arriving from another device means the fold has to start again.
 */
export interface DeckCache {
  version: 1;
  deck: Deck;
  foldedThrough: number;
  /** Whether the local event log still holds every event the deck was folded from. */
  logComplete: boolean;
}

/** Passed through so an app can name a card or a bucket from one import. */
export type { Bucket, Card, Rating };
