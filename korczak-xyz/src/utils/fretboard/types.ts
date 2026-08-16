/*
 * What the fretboard trainer stores, on top of the record shapes every trainer here shares.
 *
 * The deck, the review log, the session history and the mastery snapshots are the same shapes in
 * both trainers and live in `src/utils/srs/types.ts`; they are re-exported so the rest of this
 * app has one place to import its types from. What is genuinely the fretboard's own is `Settings`
 * — a scope made of strings and frets, which no other deck has.
 */

import type { Direction, Notation } from './notes';

export type {
  Bucket,
  Card,
  Deck,
  DeckCache,
  MasterySnapshot,
  Rating,
  ReviewEvent,
  SessionRecord,
} from '../srs/types';

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
  /**
   * Which sets of note names the deck asks under. Empty is not allowed; the UI keeps at least one.
   *
   * A list rather than a choice, because `C♯` and `Cis` are two things to know and a player may
   * want both drilled — the two spellings of a black key are in the deck together for the same
   * reason. Where the notations agree on the word there is still only one card; see
   * `hasTwoNotations`.
   */
  notations: Notation[];
}

export const DEFAULT_SETTINGS: Settings = {
  maxFret: 5,
  strings: [0, 1, 2, 3, 4, 5],
  directions: ['name', 'find'],
  sessionLength: 20,
  newPerSession: 6,
  stringLabels: true,
  notations: ['international'],
};

/**
 * The defaults a page starts someone on.
 *
 * Only the notation varies, and only by locale: the Polish page opens on H notation because that
 * is what is used here, the English one on international names. It is a *default* and not a
 * consequence of the language — once the setting is touched it is stored and synced, and from
 * then on it follows the account rather than which page it is read on.
 */
export function defaultSettings(notation: Notation): Settings {
  return { ...DEFAULT_SETTINGS, notations: [notation] };
}



