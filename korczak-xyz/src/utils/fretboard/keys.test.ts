import { describe, expect, it } from 'vitest';
import { fretFromKey, isAdvanceKey, noteFromKey } from './keys';

describe('noteFromKey', () => {
  it('answers the natural for a plain letter, in either case', () => {
    expect(noteFromKey('a', false)).toBe('A');
    expect(noteFromKey('G', false)).toBe('G');
  });

  it('answers the sharp when shift is held', () => {
    expect(noteFromKey('f', true)).toBe('F#');
    expect(noteFromKey('c', true)).toBe('C#');
  });

  it('ignores shift on the two letters with no sharp on the pad', () => {
    // E♯ and B♯ are F and C, and nobody asks for them that way.
    expect(noteFromKey('e', true)).toBeNull();
    expect(noteFromKey('b', true)).toBeNull();
  });

  it('ignores everything that is not a note letter', () => {
    expect(noteFromKey('h', false)).toBeNull();
    expect(noteFromKey('1', false)).toBeNull();
    expect(noteFromKey('Enter', false)).toBeNull();
    expect(noteFromKey('', false)).toBeNull();
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
