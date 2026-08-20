/*
 * What the transposition trainer stores, on top of the record shapes every trainer here shares.
 *
 * The deck, the review log, the session history and the mastery snapshots live in
 * `src/utils/srs/types.ts` and are re-exported so the rest of this app has one place to import
 * from. What is this app's own is `Settings` — a scope made of directions, patterns and notations,
 * where the fretboard's is made of strings and frets.
 *
 * A scope and only a scope: the sitting's length and its ration of new cards belong to the sitting,
 * which mixes this deck with the fretboard's, and live in `src/utils/flashcards/settings.ts`.
 */

import type { Direction, OrderScope } from './cards';
import type { Notation, PatternId, PitchClass } from './theory';

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

/**
 * Which keys the deck draws from.
 *
 * `songbook` narrows it to the keys the songs on this site are actually written in — seven of the
 * twelve, and the ones a guitar is happiest in. `all` is every key, which is what makes the deck
 * complete rather than comfortable. A **list of tonics** is neither: the keys you have decided to
 * work on, which is the only setting that keeps the deck a manageable size now that every ordering
 * of a pattern is its own card.
 *
 * The two words stay words rather than becoming presets that fill a list, because `songbook`
 * resolves per pattern — see `tonicsFor` in `deck.ts` — and a flat list of tonics cannot say that.
 */
export type KeyScope = 'all' | 'songbook' | PitchClass[];

export interface Settings {
  /** Which of the three questions are asked. Empty is not allowed; the UI keeps at least one. */
  directions: Direction[];
  /** Which chord patterns are drilled. Empty is not allowed either. */
  patterns: PatternId[];
  keys: KeyScope;
  /**
   * Which orderings of a pattern's chords are asked — `degree`, `shuffled`, or both. Empty is not
   * allowed either.
   *
   * Every ordering is its own card (see `Order` in `cards.ts`); this is which of them the deck
   * draws. It is what lets one progression in one key be practised as it is written, or only
   * scrambled, rather than always both at once.
   */
  orders: OrderScope[];
  /**
   * Which sets of chord names the deck asks under — `polish`, `german`, `international`, or any
   * combination. Empty is not allowed.
   *
   * A list rather than a choice, and a *deck axis* rather than a display setting, for the reason
   * the fretboard trainer's `notations` is one: reading `Es` and reading `E♭` are two acts, and
   * so are reading `B` as B flat and reading it as B natural. Only cards whose words actually
   * differ are split; see `canonicalNotation`.
   */
  notations: Notation[];
}

/**
 * The deck someone starts on.
 *
 * The two major patterns, because they are the ones that were asked for and because a deck of a
 * thousand cards introduces its material for half a year before it has shown you all of it. The
 * two minor ones sit beside them in the settings panel, one tap away, and the songbook wants them
 * — `a d E` is most of it.
 *
 * Both of the H-notations and not the international one. That is the asked-for shape and it is
 * also the honest one here: `Cis` and `C#` are two things to read, while `H` is simply what B
 * natural is called in the place these songs are sung. The international system is a tick away for
 * anyone reading an English chart.
 */
export const DEFAULT_SETTINGS: Settings = {
  directions: ['transpose', 'degrees', 'key'],
  patterns: ['145', '1456'],
  keys: 'all',
  // Both, which is what the ordering axis shipped as. A record written before this setting existed
  // has no key for it, so the spread over these defaults leaves such a deck exactly as it was.
  orders: ['degree', 'shuffled'],
  notations: ['polish', 'german'],
};

/**
 * The defaults a page starts someone on.
 *
 * Only the notations vary, and only by locale: the Polish page opens on the two that call B
 * natural `H`, the English one on international names. A *default* and not a consequence of the
 * language — once the setting is touched it is stored and synced, and from then on it follows the
 * account rather than which page it is read on, exactly as the fretboard's notation does.
 */
export function defaultSettings(notations: Notation[]): Settings {
  return { ...DEFAULT_SETTINGS, notations };
}
