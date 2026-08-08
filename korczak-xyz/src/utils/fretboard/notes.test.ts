import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  MAX_FRET,
  PITCH_CLASSES,
  STRING_COUNT,
  cardId,
  fretsSounding,
  noteLabelAt,
  noteNameAt,
  octaveAt,
  parseCardId,
  pitchLabel,
  stringLabel,
} from './notes';

describe('noteNameAt', () => {
  it('names the open strings', () => {
    const open = Array.from({ length: STRING_COUNT }, (_, s) => noteNameAt(s, 0));
    expect(open).toEqual(['E', 'A', 'D', 'G', 'B', 'E']);
  });

  it('names positions up the neck', () => {
    expect(noteNameAt(0, 5)).toBe('A'); // low E string, 5th fret
    expect(noteNameAt(1, 2)).toBe('B');
    expect(noteNameAt(2, 7)).toBe('A');
    expect(noteNameAt(4, 1)).toBe('C');
    expect(noteNameAt(5, 3)).toBe('G');
  });

  it('closes the octave at the twelfth fret', () => {
    for (let s = 0; s < STRING_COUNT; s++) {
      expect(noteNameAt(s, 12)).toBe(noteNameAt(s, 0));
      expect(octaveAt(s, 12)).toBe(octaveAt(s, 0) + 1);
    }
  });

  it('labels accidentals both ways round', () => {
    expect(noteLabelAt(0, 1, 'international')).toBe('F');
    expect(noteLabelAt(0, 2, 'international')).toBe('F♯/G♭');
  });

  it('rejects a position that is not on the instrument', () => {
    expect(() => noteNameAt(6, 0)).toThrow();
    expect(() => noteNameAt(0, -1)).toThrow();
  });
});

describe('notation', () => {
  it('renames exactly two of the twelve', () => {
    const differ = PITCH_CLASSES.filter(
      ({ name }) => pitchLabel(name, 'german') !== pitchLabel(name, 'international')
    ).map(({ name }) => name);
    expect(differ).toEqual(['A#', 'B']);
  });

  it('gives B to the black key and H to B natural', () => {
    expect(pitchLabel('A#', 'international')).toBe('A♯/B♭');
    expect(pitchLabel('A#', 'german')).toBe('A♯/B');
    expect(pitchLabel('B', 'international')).toBe('B');
    expect(pitchLabel('B', 'german')).toBe('H');
  });

  it('makes the 2nd string the H string, and leaves the case alone', () => {
    const german = Array.from({ length: STRING_COUNT }, (_, s) => stringLabel(s, 'german'));
    expect(german).toEqual(['E', 'A', 'D', 'G', 'H', 'e']);
    const intl = Array.from({ length: STRING_COUNT }, (_, s) => stringLabel(s, 'international'));
    expect(intl).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
  });

  it('follows through to a position on the neck', () => {
    // 2nd string open, and the fret below it.
    expect(noteLabelAt(4, 0, 'german')).toBe('H');
    expect(noteLabelAt(4, 11, 'german')).toBe('A♯/B');
  });

  it('leaves the stored name alone, whichever notation is shown', () => {
    // The deck is keyed and graded on `noteNameAt`, and `ReviewEvent.answered` records it. A
    // notation that reached this far would split one card's history in two.
    expect(noteNameAt(4, 0)).toBe('B');
    expect(noteNameAt(4, 11)).toBe('A#');
    expect(PITCH_CLASSES.map((p) => p.name)).toContain('B');
    expect(PITCH_CLASSES.map((p) => p.name)).not.toContain('H');
  });
});

describe('card ids', () => {
  it('round-trips every card in the full deck', () => {
    for (const direction of DIRECTIONS) {
      for (let s = 0; s < STRING_COUNT; s++) {
        for (let f = 0; f <= MAX_FRET; f++) {
          expect(parseCardId(cardId(direction, s, f))).toEqual({
            direction,
            stringIndex: s,
            fret: f,
          });
        }
      }
    }
  });

  it('keeps the two directions apart', () => {
    expect(cardId('name', 3, 7)).not.toBe(cardId('find', 3, 7));
  });

  it('returns null for anything else', () => {
    expect(parseCardId('3-7')).toBeNull();
    expect(parseCardId('sing:3-7')).toBeNull();
    expect(parseCardId('name:9-7')).toBeNull();
    expect(parseCardId('')).toBeNull();
  });
});

describe('fretsSounding', () => {
  it('finds the one place a note sits on a string', () => {
    expect(fretsSounding(0, 'A', 12)).toEqual([5]);
    expect(fretsSounding(2, 'A', 12)).toEqual([7]);
  });

  it('counts the open string and its octave as the same answer', () => {
    // Marking the twelfth fret wrong for a card written at the nut would teach something false.
    expect(fretsSounding(0, 'E', 12)).toEqual([0, 12]);
    expect(fretsSounding(4, 'B', 12)).toEqual([0, 12]);
  });

  it('stays inside the scope it was given', () => {
    expect(fretsSounding(0, 'E', 5)).toEqual([0]);
    expect(fretsSounding(0, 'A', 4)).toEqual([]);
  });
});
