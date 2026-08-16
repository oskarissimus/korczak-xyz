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
  isPositionDirection,
  isPositionKey,
  midisInScope,
  noteCardId,
  noteNameAt,
  notesInScope,
  parseCardId,
  pitchCardId,
  pitchClassOfMidi,
  positionsOfNote,
  positionsSounding,
} from './notes';
import type { CardKey, Direction, Notation, PositionCardKey } from './notes';
import type { Card } from '../srs/scheduler';
import { createCard } from '../srs/scheduler';
import type { QueueOptions } from '../srs/queue';
import {
  buildQueue as buildQueueFrom,
  ensureCards as ensureCardsIn,
  spreadBy,
} from '../srs/queue';
import type { Deck, Settings } from './types';

export {
  MAX_ANSWERS_FACTOR,
  MIN_REQUEUE_GAP,
  SESSION_HORIZON_MS,
  countDeck,
  interleave,
  nextDueAt,
  requeue,
  shuffle,
} from '../srs/queue';
export type { DeckCounts, QueueOptions } from '../srs/queue';

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
 * The selected notations multiply that again, by the same argument one step out: `Cis` and `C♯`
 * are two things to know. Only where the two notations print different words, though — `cardId`
 * normalises the rest away, and pushing an id twice is what the dedupe below is for. Selecting
 * one notation therefore leaves the deck exactly the size it was.
 *
 * Three of the five directions are not enumerated over the grid at all, because they are not
 * keyed on a place: a `pitch` or `allPitch` card is one pitch however many fingers reach it, and
 * an `allNote` card is one pitch class however many places sound it. Walking the fret × string
 * loop would mint each of them several times over.
 */
export function scopeIds(settings: Settings): string[] {
  const ids: string[] = [];
  const strings = [...settings.strings].sort((a, b) => a - b);
  const directions = settings.directions.length > 0 ? settings.directions : (['name'] as Direction[]);
  const notations =
    settings.notations.length > 0 ? settings.notations : (['international'] as Notation[]);
  const maxFret = Math.min(settings.maxFret, MAX_FRET);
  for (let fret = 0; fret <= maxFret; fret++) {
    for (const string of strings) {
      if (string < 0 || string >= STRING_COUNT) continue;
      for (const direction of directions) {
        if (!isPositionDirection(direction)) continue; // enumerated below, not per position
        for (const notation of notations) {
          ids.push(cardId(direction, string, fret, 'sharp', notation));
          if (direction === 'find' && hasTwoSpellings(noteNameAt(string, fret))) {
            ids.push(cardId(direction, string, fret, 'flat', notation));
          }
        }
      }
    }
  }
  // A `pitch` card is one pitch, not one position, so it is enumerated over the distinct pitches
  // the scope can sound rather than over the grid — several places on the neck answer each one.
  // `allPitch` asks about the same pitches and is enumerated with them.
  for (const direction of ['pitch', 'allPitch'] as const) {
    if (!directions.includes(direction)) continue;
    for (const midi of midisInScope(strings, maxFret)) {
      for (const notation of notations) {
        ids.push(pitchCardId(direction, midi, 'sharp', notation));
        if (hasTwoSpellings(pitchClassOfMidi(midi))) {
          ids.push(pitchCardId(direction, midi, 'flat', notation));
        }
      }
    }
  }
  // An `allNote` card is one pitch class over the whole scope, so there are at most twelve of
  // them however wide the neck is — and fewer only when the scope is too narrow to sound all
  // twelve, which takes fewer than four frets on a single string.
  if (directions.includes('allNote')) {
    for (const note of notesInScope(strings, maxFret)) {
      for (const notation of notations) {
        ids.push(noteCardId(note, 'sharp', notation));
        if (hasTwoSpellings(note)) ids.push(noteCardId(note, 'flat', notation));
      }
    }
  }
  return [...new Set(ids)];
}

/** Add a card for every id in scope the deck does not have yet. Never removes any. */
export function ensureCards(deck: Deck, ids: string[]): Deck {
  return ensureCardsIn(deck, ids, createCard);
}

export function cardsInScope(deck: Deck, settings: Settings): Card[] {
  return scopeIds(settings)
    .map((id) => deck[id])
    .filter((card): card is Card => card != null);
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
 * on the same key here without being mentioned, because the key is the position — and so, for
 * the same reason and at no extra cost, do `find:1-4` and `find:1-4:de`, which differ only in
 * whether the note is called C♯ or Cis.
 *
 * A `pitch` card has no single position — that is the point of it — so it is keyed on the lowest
 * one that sounds it. One key per card is all this function has, and that is the most useful one
 * available: the two spellings of a pitch share it, which is the same-answer case again, and the
 * card is also held apart from the `name`/`find` cards on that square. The pitch's other squares
 * are not covered, and a leak there is the mild one — a different place, read differently.
 *
 * The two select-all directions are keyed the same way, on the lowest place they cover: an
 * `allPitch` card shares its key with the `pitch` card on the same pitch, which is the strongest
 * case here since the two have the same answer set, and an `allNote` card sits with the lowest
 * place that sounds its class. Those cards cover most of the neck, so most of what they leak
 * cannot be keyed away — but the run of squares they have just had you mark is not a run this
 * function could hold apart without becoming a scheduler of its own.
 *
 * Greedy: take the first remaining card whose position has not come up in the last `gap`, and
 * fall back to the first remaining card when none qualifies. The fallback is what makes this
 * total — a queue of nothing but one position has no valid arrangement — and it always returns a
 * permutation of its input.
 */
const ALL_STRINGS = Array.from({ length: STRING_COUNT }, (_, i) => i);

export function spreadPositions(queue: string[], gap = MIN_POSITION_GAP): string[] {
  return spreadBy(
    queue,
    (id) => {
      const key = parseCardId(id);
      if (!key) return id;
      if (isPositionKey(key)) return `${key.stringIndex}-${key.fret}`;
      // Keyed on the whole neck rather than the current scope, so the grouping is a property of
      // the card and does not shift when the settings do.
      const canonical =
        key.direction === 'allNote'
          ? positionsOfNote(key.note, ALL_STRINGS, MAX_FRET)[0]
          : positionsSounding(key.midi, ALL_STRINGS, MAX_FRET)[0];
      return canonical ? `${canonical.stringIndex}-${canonical.fret}` : id;
    },
    gap
  );
}

/**
 * The order a sitting asks its cards in.
 *
 * The selection rule is `buildQueue` in `src/utils/srs/queue.ts` and is not the fretboard's own:
 * overdue learning cards first, then the most overdue reviews with the sitting's ration of new
 * cards interleaved, all of it shuffled. What *is* this deck's own is the scope it draws from and
 * `spreadPositions`, which pulls apart the cards that would answer each other.
 *
 * Deterministic order meant every sitting walked the strings E, A, D, G, B, e in turn, which is a
 * sequence you can answer without reading the card.
 */
export function buildQueue(
  deck: Deck,
  settings: Settings,
  now: number,
  options: QueueOptions = {}
): string[] {
  return buildQueueFrom(cardsInScope(deck, settings), settings, now, {
    ...options,
    spread: (queue) => spreadPositions(queue),
  });
}

/**
 * Every card the deck holds that is *about a position*, with that position decoded — for the
 * stats heatmap. The `pitch`, `allPitch` and `allNote` cards are left out because none of them is
 * about one square, and the heatmap is a picture of squares.
 */
export function deckPositions(deck: Deck): { card: Card; key: PositionCardKey }[] {
  return Object.values(deck)
    .map((card) => ({ card, key: parseCardId(card.id) }))
    .filter((entry): entry is { card: Card; key: PositionCardKey } =>
      entry.key != null && isPositionKey(entry.key)
    );
}
