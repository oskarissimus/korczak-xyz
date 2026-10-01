import { describe, expect, it } from 'vitest';

import { borrowKeys, keysFrom, missingKeys, shouldBorrow } from './keys';

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
