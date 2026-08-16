/*
 * The deck: which cards exist, and which of them a sitting should ask.
 *
 * Scope is a setting rather than a fixed deck, for the reason the fretboard trainer's is: "moving
 * chords between keys" is not one thing you learn. The major patterns and the minor ones are
 * different material, and so are the twelve keys and the seven a guitar actually lives in. Cards
 * outside the current scope are kept, never deleted — widen it again and the schedule you had
 * earnt is still there.
 *
 * The selection rule and the running order are `buildQueue` in `src/utils/srs/queue.ts`, shared
 * with the fretboard trainer. What is this deck's own is the enumeration below and
 * `spreadSubjects`.
 */

import { createCard } from '../srs/scheduler';
import type { Card } from '../srs/scheduler';
import type { QueueOptions } from '../srs/queue';
import {
  buildQueue as buildQueueFrom,
  ensureCards as ensureCardsIn,
  spreadBy,
} from '../srs/queue';
import { cardId, parseCardId, subjectOf } from './cards';
import type { CardKey, Direction } from './cards';
import type { LibraryIndex } from './library';
import { libraryTonics } from './library';
import type { Notation, PitchClass } from './theory';
import { PATTERN_IDS, patternMode } from './theory';
import type { Deck, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

export { MAX_ANSWERS_FACTOR, SESSION_HORIZON_MS, countDeck, nextDueAt, requeue } from '../srs/queue';
export type { DeckCounts, QueueOptions } from '../srs/queue';

const ALL_TONICS: PitchClass[] = Array.from({ length: 12 }, (_, i) => i);

function notationsOf(settings: Settings): Notation[] {
  return settings.notations.length > 0 ? settings.notations : DEFAULT_SETTINGS.notations;
}

/**
 * Every card the current scope contains.
 *
 * A stable enumeration, not a running order — `ensureCards`, the deck counts and the stats all
 * read it and none of them care what order it comes in. What a sitting asks, and in what order, is
 * `buildQueue`'s business, and it shuffles.
 *
 * The dedupe at the end is doing real work: a card that reads the same under two notations mints
 * the same id twice, which is exactly what `canonicalNotation` is for. Selecting a second notation
 * therefore leaves the deck the size it was except where the two genuinely disagree.
 *
 * A `transpose` card from a key to itself is skipped: "move C F G into C" is not a question, and
 * `parseCardId` refuses the id for the same reason.
 */
export function scopeIds(settings: Settings, library: LibraryIndex): string[] {
  const ids: string[] = [];
  const directions = settings.directions.length > 0 ? settings.directions : DEFAULT_SETTINGS.directions;
  const patterns = settings.patterns.length > 0 ? settings.patterns : DEFAULT_SETTINGS.patterns;
  const notations = notationsOf(settings);

  const push = (key: CardKey) => ids.push(cardId(key));

  for (const pattern of patterns) {
    if (!PATTERN_IDS.includes(pattern)) continue;
    const tonics =
      settings.keys === 'songbook' ? libraryTonics(library, pattern) : ALL_TONICS;

    for (const notation of notations) {
      for (const direction of directions) {
        if (direction === 'transpose') {
          for (const from of tonics) {
            for (const to of tonics) {
              if (from === to) continue;
              push({ direction, from, to, pattern, notation });
            }
          }
        } else {
          for (const tonic of tonics) push({ direction, tonic, pattern, notation });
        }
      }
    }
  }

  return [...new Set(ids)];
}

/** Add a card for every id in scope the deck does not have yet. Never removes any. */
export function ensureCards(deck: Deck, ids: string[]): Deck {
  return ensureCardsIn(deck, ids, createCard);
}

export function cardsInScope(deck: Deck, settings: Settings, library: LibraryIndex): Card[] {
  return scopeIds(settings, library)
    .map((id) => deck[id])
    .filter((card): card is Card => card != null);
}

/** How many cards apart the cards about one key should be kept. */
export const MIN_SUBJECT_GAP = 3;

/**
 * Push apart cards that would answer each other.
 *
 * `degrees:9:145` asks for A's I IV V and `key:9:145` shows them and asks which key they are —
 * different questions, but back to back the second is not thought about at all. It lands in the
 * log as a fast, correct answer, so the scheduler pushes the card out and the stats report a
 * fluency that was never demonstrated. A shuffle alone does not fix that; it only makes the
 * clumping unpredictable.
 *
 * Keyed on the answer (`subjectOf`), so the two spellings and the two B-namings of one key land
 * together too — those share an answer *and* a shape, which is the sharpest case of all.
 */
export function spreadSubjects(queue: string[], gap = MIN_SUBJECT_GAP): string[] {
  return spreadBy(
    queue,
    (id) => {
      const key = parseCardId(id);
      return key ? subjectOf(key) : id;
    },
    gap
  );
}

export function buildQueue(
  deck: Deck,
  settings: Settings,
  library: LibraryIndex,
  now: number,
  options: QueueOptions = {}
): string[] {
  return buildQueueFrom(cardsInScope(deck, settings, library), settings, now, {
    ...options,
    spread: (queue) => spreadSubjects(queue),
  });
}

/**
 * Whether a sitting has to ask for the mode as well as the tonic on a `key` card.
 *
 * Only when a minor pattern is in scope. In a major-only deck every answer is major, so a mode
 * slot is a formality and a wasted tap on every card of that direction. The card's shape therefore
 * moves with the settings — the same way "every E" on the fretboard gains the twelfth frets when
 * the range widens — which is the scope doing what a scope does.
 */
export function asksMode(settings: Settings): boolean {
  return settings.patterns.some((pattern) => patternMode(pattern) === 'minor');
}

/** Which direction a card belongs to, for the per-direction split in the stats. */
export function directionOf(id: string): Direction | null {
  return parseCardId(id)?.direction ?? null;
}
