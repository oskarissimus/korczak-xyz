import { describe, expect, it } from 'vitest';
import { fretFromKey, isAdvanceKey, noteFromKey } from './keys';

describe('noteFromKey', () => {
  it('answers the natural for a plain letter, in either case', () => {
    expect(noteFromKey('a', false, 'international')).toBe('A');
    expect(noteFromKey('G', false, 'international')).toBe('G');
  });

  it('answers the sharp when shift is held', () => {
    expect(noteFromKey('f', true, 'international')).toBe('F#');
    expect(noteFromKey('c', true, 'international')).toBe('C#');
  });

  it('ignores shift on the two letters with no sharp on the pad', () => {
    // E♯ and B♯ are F and C, and nobody asks for them that way.
    expect(noteFromKey('e', true, 'international')).toBeNull();
    expect(noteFromKey('b', true, 'international')).toBeNull();
  });

  it('ignores everything that is not a note letter', () => {
    expect(noteFromKey('h', false, 'international')).toBeNull();
    expect(noteFromKey('1', false, 'international')).toBeNull();
    expect(noteFromKey('Enter', false, 'international')).toBeNull();
    expect(noteFromKey('', false, 'international')).toBeNull();
  });
});

describe('noteFromKey under German notation', () => {
  it('answers B natural with H', () => {
    expect(noteFromKey('h', false, 'german')).toBe('B');
    expect(noteFromKey('H', false, 'german')).toBe('B');
  });

  it('answers the black key with an unshifted B', () => {
    // The pad says `A♯/B` here, so `B` has to reach it — the letter is the flat name.
    expect(noteFromKey('b', false, 'german')).toBe('A#');
  });

  it('has nothing above B or H to shift to', () => {
    expect(noteFromKey('b', true, 'german')).toBeNull();
    expect(noteFromKey('h', true, 'german')).toBeNull();
    expect(noteFromKey('e', true, 'german')).toBeNull();
  });

  it('leaves the other letters as they were', () => {
    expect(noteFromKey('a', false, 'german')).toBe('A');
    expect(noteFromKey('f', true, 'german')).toBe('F#');
    expect(noteFromKey('g', true, 'german')).toBe('G#');
  });
});

describe('fretFromKey', () => {
  it('answers the fret a digit names', () => {
    expect(fretFromKey('0', 5)).toBe(0);
    expect(fretFromKey('5', 5)).toBe(5);
  });

  it('ignores a fret outside the current range', () => {
    expect(fretFromKey('7', 5)).toBeNull();
  });

  it('ignores anything that is not a single digit', () => {
    expect(fretFromKey('a', 12)).toBeNull();
    expect(fretFromKey('12', 12)).toBeNull();
    expect(fretFromKey('Enter', 12)).toBeNull();
  });
});

describe('isAdvanceKey', () => {
  it('takes Enter or space', () => {
    expect(isAdvanceKey('Enter')).toBe(true);
    expect(isAdvanceKey(' ')).toBe(true);
    expect(isAdvanceKey('a')).toBe(false);
  });
});
