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

  it('carries the fal.ai key', () => {
    expect(keysFrom({ apiKeys: { fal: ' id:secret ' } })).toEqual({ ...NO_KEYS, fal: 'id:secret' });
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

describe('the account’s keys as a page holds them', () => {
  it('reads a handle as no key, so it can never stand in for one', async () => {
    const { ACCOUNT_KEY, keysFrom } = await import('./keys');
    expect(keysFrom({ apiKeys: { google: ACCOUNT_KEY, openai: 'sk-real' } })).toMatchObject({ google: null, openai: 'sk-real' });
  });

  it('turns the gateway’s answer into handles and hints, and never a key', async () => {
    const { ACCOUNT_KEY, viewOf } = await import('./keys');
    const view = viewOf({ keys: { google: 'duA1', openai: null }, audioGuideWriter: 'openai', updatedAt: 5 });
    expect(view.value.apiKeys).toMatchObject({ google: ACCOUNT_KEY, openai: null, fal: null });
    expect(view.hints.google).toBe('duA1');
    expect(view.value.audioGuideWriter).toBe('openai');
    expect(view.updatedAt).toBe(5);
  });
});
