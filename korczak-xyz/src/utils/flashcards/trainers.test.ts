import { describe, expect, it } from 'vitest';
import { QUALIFIER, TRAINERS, isTrainerId, qualify, trainerOf, unqualify } from './trainers';
import { scopeIds as fretboardScope } from '../fretboard/deck';
import { DIRECTIONS, NOTATIONS } from '../fretboard/notes';
import { DEFAULT_SETTINGS as FRETBOARD_DEFAULTS } from '../fretboard/types';
import { scopeIds as transposeScope } from '../transpose/deck';
import { DIRECTIONS as TP_DIRECTIONS } from '../transpose/cards';
import { NOTATIONS as TP_NOTATIONS, PATTERN_IDS } from '../transpose/theory';
import { DEFAULT_SETTINGS as TRANSPOSE_DEFAULTS } from '../transpose/types';

describe('qualify / unqualify', () => {
  it('round-trips every trainer', () => {
    for (const trainer of TRAINERS) {
      const id = qualify(trainer, 'find:1-4:b');
      expect(unqualify(id)).toEqual({ trainer, cardId: 'find:1-4:b' });
      expect(trainerOf(id)).toBe(trainer);
    }
  });

  it('gives the two trainers different prefixes', () => {
    expect(qualify('fretboard', 'x')).not.toBe(qualify('transpose', 'x'));
  });

  it('refuses an id that is not qualified, rather than guessing a trainer', () => {
    // Guessing would file one deck's answer in the other's log, which is the one thing the
    // prefix exists to make impossible.
    expect(unqualify('find:1-4')).toBeNull();
    expect(unqualify('degrees:9:145')).toBeNull();
    expect(unqualify('')).toBeNull();
    expect(trainerOf('find:1-4')).toBeNull();
  });

  it('refuses a prefix with nothing behind it', () => {
    expect(unqualify(qualify('fretboard', ''))).toBeNull();
  });

  it('knows a trainer id from anything else', () => {
    expect(isTrainerId('fretboard')).toBe(true);
    expect(isTrainerId('flashcards')).toBe(false);
    expect(isTrainerId(undefined)).toBe(false);
  });
});

/*
 * The assumption the whole scheme rests on: the separator cannot occur in a real card id, so
 * `unqualify` can split on the first one and never mis-split a card. Asserted over the widest
 * scope either trainer can enumerate rather than taken on trust — a grammar that grew a `|` would
 * otherwise fail silently, in the form of answers filed against ids nobody minted.
 */
describe('the separator is not part of any card id', () => {
  const fretboardIds = fretboardScope({
    ...FRETBOARD_DEFAULTS,
    maxFret: 12,
    strings: [0, 1, 2, 3, 4, 5],
    directions: [...DIRECTIONS],
    notations: [...NOTATIONS],
  });

  const transposeIds = transposeScope(
    {
      ...TRANSPOSE_DEFAULTS,
      directions: [...TP_DIRECTIONS],
      patterns: [...PATTERN_IDS],
      keys: 'all',
      notations: [...TP_NOTATIONS],
    },
    {}
  );

  it('enumerates both decks in full', () => {
    expect(fretboardIds.length).toBeGreaterThan(200);
    expect(transposeIds.length).toBeGreaterThan(200);
  });

  it('holds for every card in either deck', () => {
    for (const id of [...fretboardIds, ...transposeIds]) {
      expect(id).not.toContain(QUALIFIER);
    }
  });

  it('and so every qualified id splits back into exactly what went in', () => {
    for (const id of fretboardIds) {
      expect(unqualify(qualify('fretboard', id))).toEqual({ trainer: 'fretboard', cardId: id });
    }
    for (const id of transposeIds) {
      expect(unqualify(qualify('transpose', id))).toEqual({ trainer: 'transpose', cardId: id });
    }
  });

  it('keeps the two decks apart even where their ids look alike', () => {
    // Both grammars build from `:` and `-`, so the prefix is the only thing telling them apart.
    const overlap = fretboardIds.filter((id) => transposeIds.includes(id));
    expect(overlap).toEqual([]);
    const qualified = new Set([
      ...fretboardIds.map((id) => qualify('fretboard', id)),
      ...transposeIds.map((id) => qualify('transpose', id)),
    ]);
    expect(qualified.size).toBe(fretboardIds.length + transposeIds.length);
  });
});
