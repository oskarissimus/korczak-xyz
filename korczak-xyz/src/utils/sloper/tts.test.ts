import { describe, expect, it } from 'vitest';

import { wordsFromAlignment } from './tts';

/*
 * The alignment is the only thing standing between a narration and a video whose pictures are the
 * wrong length: the last word's end time becomes the scene's `imageDuration`. So the case that
 * matters most below is the last word — a walk that closes words on spaces alone drops it, and the
 * scene is then held for however long the *second to last* word ended, which cuts the narration off
 * mid-sentence.
 */
describe('wordsFromAlignment', () => {
  const alignment = (text: string) => ({
    characters: [...text],
    character_start_times_seconds: [...text].map((_, i) => i * 0.1),
    character_end_times_seconds: [...text].map((_, i) => (i + 1) * 0.1),
  });

  it('gives nothing when the response carried no alignment', () => {
    expect(wordsFromAlignment(undefined)).toBeUndefined();
    expect(wordsFromAlignment({})).toBeUndefined();
    expect(wordsFromAlignment({ characters: ['a'] })).toBeUndefined();
  });

  it('splits characters into words on spaces', () => {
    const timing = wordsFromAlignment(alignment('ab cd'));
    expect(timing?.words.map((w) => w.word)).toEqual(['ab', 'cd']);
  });

  it('closes the final word, which is what the scene duration is read from', () => {
    const text = 'ab cd';
    const timing = wordsFromAlignment(alignment(text));
    // 'cd' ends at the fifth character, so at 0.5s.
    expect(timing?.words.at(-1)).toEqual({ word: 'cd', start: expect.any(Number), end: 0.5 });
    expect(timing?.totalDuration).toBeCloseTo(0.5, 6);
  });

  it('closes the final word when the text ends on a space too', () => {
    const timing = wordsFromAlignment(alignment('ab cd '));
    expect(timing?.words.map((w) => w.word)).toEqual(['ab', 'cd']);
    expect(timing?.totalDuration).toBeGreaterThan(0);
  });

  it('starts each word at its own first character', () => {
    const timing = wordsFromAlignment(alignment('ab cd'));
    expect(timing?.words[0].start).toBeCloseTo(0, 6);
    // 'c' is the fourth character, starting at 0.3s.
    expect(timing?.words[1].start).toBeCloseTo(0.3, 6);
  });

  it('gives a zero duration rather than a NaN for an empty alignment', () => {
    const timing = wordsFromAlignment({
      characters: [],
      character_start_times_seconds: [],
      character_end_times_seconds: [],
    });
    expect(timing).toEqual({ words: [], totalDuration: 0 });
  });

  it('does not emit a word for a run of spaces', () => {
    const timing = wordsFromAlignment(alignment('a   b'));
    expect(timing?.words.map((w) => w.word)).toEqual(['a', 'b']);
  });
});
