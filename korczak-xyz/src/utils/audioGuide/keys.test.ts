import { describe, expect, it } from 'vitest';

import { borrowKeys, GOOGLE_SWITCH_AT, keysFrom, missingKeys, shouldBorrow, withGoogleKey } from './keys';

describe('keysFrom', () => {
  it('reads sloper’s, the backseat driver’s and its own shape alike', () => {
    expect(keysFrom({ apiKeys: { google: ' g-1 ', elevenLabs: 'el', openai: 'sk' } })).toEqual({
      google: 'g-1',
      elevenLabs: 'el',
    });
  });

  it('turns anything unreadable into nothing rather than a throw', () => {
    expect(keysFrom(null)).toEqual({ google: null, elevenLabs: null });
    expect(keysFrom({ apiKeys: { google: 42, elevenLabs: '   ' } })).toEqual({
      google: null,
      elevenLabs: null,
    });
  });
});

describe('borrowKeys', () => {
  it('takes each key from the first source that has it', () => {
    const sloper = { google: 'g-sloper', elevenLabs: null };
    const backseat = { google: 'g-backseat', elevenLabs: 'el-backseat' };
    expect(borrowKeys([sloper, backseat])).toEqual({
      google: 'g-sloper',
      elevenLabs: 'el-backseat',
    });
  });

  it('is empty with nothing to borrow from', () => {
    expect(borrowKeys([])).toEqual({ google: null, elevenLabs: null });
  });
});

describe('shouldBorrow', () => {
  const none = { google: null, elevenLabs: null };

  it('borrows into an undecided, empty copy', () => {
    expect(shouldBorrow(none, false)).toBe(true);
  });

  it('never borrows over a key, or into a copy somebody cleared on purpose', () => {
    expect(shouldBorrow({ google: 'sk', elevenLabs: null }, false)).toBe(false);
    // The resurrection this flag exists to stop.
    expect(shouldBorrow(none, true)).toBe(false);
  });
});

describe('missingKeys', () => {
  it('asks for both, because every guide needs both', () => {
    expect(missingKeys({ google: null, elevenLabs: null })).toEqual(['google', 'elevenLabs']);
    expect(missingKeys({ google: 'sk', elevenLabs: null })).toEqual(['elevenLabs']);
    expect(missingKeys({ google: 'sk', elevenLabs: 'el' })).toEqual([]);
  });
});

describe('withGoogleKey', () => {
  const before = GOOGLE_SWITCH_AT - 1;

  it('fills only the Google key of a copy saved before the switch', () => {
    expect(withGoogleKey({ google: null, elevenLabs: 'el' }, before, 'g')).toEqual({
      google: 'g',
      elevenLabs: 'el',
    });
  });

  it('never fills one edited since, one that has a key, or with nothing to fill it from', () => {
    expect(withGoogleKey({ google: null, elevenLabs: 'el' }, GOOGLE_SWITCH_AT + 1, 'g')).toBeNull();
    expect(withGoogleKey({ google: 'mine', elevenLabs: 'el' }, before, 'g')).toBeNull();
    expect(withGoogleKey({ google: null, elevenLabs: 'el' }, before, null)).toBeNull();
    expect(withGoogleKey({ google: null, elevenLabs: 'el' }, 0, 'g')).toBeNull();
  });
});
