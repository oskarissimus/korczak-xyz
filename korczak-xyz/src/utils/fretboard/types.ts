import type { Direction } from './notes';
import type { Bucket, Card, Rating } from './srs';

/** The deck, keyed by card id (`${direction}:${stringIndex}-${fret}`). */
export type Deck = Record<string, Card>;

export interface Settings {
  /** Highest fret in the deck. Everything from the open string up to it is in scope. */
  maxFret: number;
  /** Which strings are in scope, as indices (0 = low E). */
  strings: number[];
  /** Which way round positions are asked. Empty is not allowed; the UI keeps at least one. */
  directions: Direction[];
  /** How many cards a sitting aims for, before in-session repeats. */
  sessionLength: number;
  /** Ceiling on unseen cards introduced in one sitting. */
  newPerSession: number;
  /** Whether the diagram prints the string letters. Off is the harder deck. */
  stringLabels: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  maxFret: 5,
  strings: [0, 1, 2, 3, 4, 5],
  directions: ['name', 'find'],
  sessionLength: 20,
  newPerSession: 6,
  stringLabels: true,
};

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
  /** What the player chose: a note name for `name` cards, a fret for `find` cards. */
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
