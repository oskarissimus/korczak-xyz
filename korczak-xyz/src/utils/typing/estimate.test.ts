import { describe, expect, it } from 'vitest';
import {
  charsCovered,
  estimateRemainingMs,
  MIN_KEYSTROKES_FOR_ESTIMATE,
  typeableChars,
} from './estimate';
import { createDefaultProgress, type TypingProgress } from './types';

const BOOK = 'krasnoludek';
const PASSAGES = ['alpha', 'beta', 'gamma']; // 5 + 4 + 5 characters

function progress(overrides: Partial<TypingProgress> = {}): TypingProgress {
  return { ...createDefaultProgress(BOOK), ...overrides };
}

describe('typeableChars', () => {
  it('counts the Enter that finishes each section', () => {
    expect(typeableChars(PASSAGES)).toBe(5 + 1 + 4 + 1 + 5 + 1);
  });

  it('is zero for a book with no sections', () => {
    expect(typeableChars([])).toBe(0);
  });
});

describe('charsCovered', () => {
  it('is zero at the start', () => {
    expect(charsCovered(PASSAGES, progress())).toBe(0);
  });

  it('counts finished sections with their newline, plus the partial one', () => {
    expect(charsCovered(PASSAGES, progress({ passageIndex: 1, typed: 'be' }))).toBe(6 + 2);
  });

  it('reaches the typeable length when the book is finished', () => {
    const finished = progress({ passageIndex: PASSAGES.length });
    expect(charsCovered(PASSAGES, finished)).toBe(typeableChars(PASSAGES));
  });
});

describe('estimateRemainingMs', () => {
  it('divides what is left by the pace measured so far', () => {
    // 6000 keystrokes in 5 minutes = 20 chars/s. 12000 characters left is 10 minutes.
    const ms = estimateRemainingMs({
      remainingChars: 12_000,
      totalTimeMs: 300_000,
      timedKeystrokes: 6_000,
    });
    expect(ms).toBe(600_000);
  });

  it('withholds an estimate until there is a pace to measure', () => {
    expect(
      estimateRemainingMs({
        remainingChars: 12_000,
        totalTimeMs: 4_000,
        timedKeystrokes: MIN_KEYSTROKES_FOR_ESTIMATE - 1,
      })
    ).toBeNull();
  });

  /*
   * The regression the paired counter exists for. A reader who is already deep into a book
   * when the clock ships has a large `totalKeystrokes` and no recorded time at all; measuring
   * the pace against that count would divide by zero and promise the book was nearly over.
   * `timedKeystrokes` starts at zero alongside the clock, so this is simply "not yet known".
   */
  it('has no opinion about a record that predates the clock', () => {
    const legacy = progress({ passageIndex: 400, totalKeystrokes: 120_000 });
    expect(
      estimateRemainingMs({
        remainingChars: 200_000,
        totalTimeMs: legacy.totalTimeMs,
        timedKeystrokes: legacy.timedKeystrokes,
      })
    ).toBeNull();
  });

  it('has nothing to say about a finished book', () => {
    expect(
      estimateRemainingMs({ remainingChars: 0, totalTimeMs: 300_000, timedKeystrokes: 6_000 })
    ).toBeNull();
  });
});
