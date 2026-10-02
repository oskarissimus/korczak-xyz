import { describe, expect, it } from 'vitest';

import { NO_KEYS, keysFrom, normalizeAccountKeys, seedKeys, shouldSeed } from './keys';

describe('keysFrom', () => {
  it('reads any app’s old shape, trimming, and an empty key as none', () => {
    expect(keysFrom({ apiKeys: { openai: ' sk ', deepseek: '', google: 42 } })).toEqual({
      ...NO_KEYS,
      openai: 'sk',
    });
    expect(keysFrom(null)).toEqual(NO_KEYS);
  });
});

describe('normalizeAccountKeys', () => {
  it('defaults the writer to Google and drops a malformed credit', () => {
    expect(normalizeAccountKeys({ openaiCredit: { amount: 'x', at: 1 } })).toEqual({
      apiKeys: NO_KEYS,
      openaiCredit: null,
      audioGuideWriter: 'google',
    });
    expect(
      normalizeAccountKeys({ audioGuideWriter: 'openai', openaiCredit: { amount: 5, at: 9 } }),
    ).toMatchObject({ audioGuideWriter: 'openai', openaiCredit: { amount: 5, at: 9 } });
  });
});

describe('seedKeys', () => {
  it('takes each key from the most recently edited copy that has it', () => {
    const sloper = { keys: { ...NO_KEYS, openai: 'sk-old', deepseek: 'ds', google: 'g-old' }, updatedAt: 1 };
    const guide = { keys: { ...NO_KEYS, google: 'g-new', elevenLabs: 'el' }, updatedAt: 3 };
    const backseat = { keys: { ...NO_KEYS, openai: 'sk-new' }, updatedAt: 2 };
    expect(seedKeys([sloper, guide, backseat])).toEqual({
      ...NO_KEYS,
      openai: 'sk-new',
      google: 'g-new',
      elevenLabs: 'el',
      deepseek: 'ds',
    });
  });

  it('is empty with nothing to seed from', () => {
    expect(seedKeys([])).toEqual(NO_KEYS);
  });
});

describe('shouldSeed', () => {
  it('seeds only an empty copy nobody has decided', () => {
    expect(shouldSeed(NO_KEYS, false)).toBe(true);
    expect(shouldSeed({ ...NO_KEYS, google: 'g' }, false)).toBe(false);
    // The resurrection the flag exists to stop: everything cleared, on purpose.
    expect(shouldSeed(NO_KEYS, true)).toBe(false);
  });
});
