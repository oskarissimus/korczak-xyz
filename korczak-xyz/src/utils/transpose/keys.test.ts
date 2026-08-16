import { describe, expect, it } from 'vitest';
import { isCommitKey, isUndoKey, rootFromKey } from './keys';

describe('rootFromKey', () => {
  it('answers a natural with its own letter', () => {
    expect(rootFromKey('c', false, 'international')).toBe(0);
    expect(rootFromKey('G', false, 'international')).toBe(7);
    expect(rootFromKey('a', false, 'polish')).toBe(9);
  });

  it('answers a sharp with shift', () => {
    expect(rootFromKey('c', true, 'international')).toBe(1);
    expect(rootFromKey('f', true, 'polish')).toBe(6);
    expect(rootFromKey('g', true, 'german')).toBe(8);
  });

  it('has no E♯ and no B♯, because no pad button says so', () => {
    expect(rootFromKey('e', true, 'international')).toBeNull();
    expect(rootFromKey('b', true, 'international')).toBeNull();
  });

  describe('what B means', () => {
    it('is B natural internationally', () => {
      expect(rootFromKey('b', false, 'international')).toBe(11);
      expect(rootFromKey('h', false, 'international')).toBeNull();
    });

    it('is B flat in the two H-systems, where H is the natural', () => {
      for (const notation of ['polish', 'german'] as const) {
        expect(rootFromKey('h', false, notation)).toBe(11);
        expect(rootFromKey('b', false, notation)).toBe(10);
        // Nothing above B to reach for — shift would ask for what B already answers.
        expect(rootFromKey('b', true, notation)).toBeNull();
      }
    });
  });

  it('answers nothing for a key that is not a letter on the pad', () => {
    expect(rootFromKey('1', false, 'polish')).toBeNull();
    expect(rootFromKey('Enter', false, 'polish')).toBeNull();
    expect(rootFromKey('z', false, 'polish')).toBeNull();
  });
});

describe('isCommitKey / isUndoKey', () => {
  it('commits on enter or space and takes back on backspace', () => {
    expect(isCommitKey('Enter')).toBe(true);
    expect(isCommitKey(' ')).toBe(true);
    expect(isCommitKey('a')).toBe(false);
    expect(isUndoKey('Backspace')).toBe(true);
    expect(isUndoKey('Enter')).toBe(false);
  });
});
