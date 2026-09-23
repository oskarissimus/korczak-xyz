import { describe, expect, it } from 'vitest';

import { borrowKeys, keysFrom, missingKeys, shouldBorrow } from './keys';

describe('keysFrom', () => {
  it('reads sloper’s, the backseat driver’s and its own shape alike', () => {
    expect(keysFrom({ apiKeys: { openai: ' sk-1 ', elevenLabs: 'el', google: 'g' } })).toEqual({
      openai: 'sk-1',
      elevenLabs: 'el',
    });
  });

  it('turns anything unreadable into nothing rather than a throw', () => {
    expect(keysFrom(null)).toEqual({ openai: null, elevenLabs: null });
    expect(keysFrom({ apiKeys: { openai: 42, elevenLabs: '   ' } })).toEqual({
      openai: null,
      elevenLabs: null,
    });
  });
});

describe('borrowKeys', () => {
  it('takes each key from the first source that has it', () => {
    const sloper = { openai: 'sk-sloper', elevenLabs: null };
    const backseat = { openai: 'sk-backseat', elevenLabs: 'el-backseat' };
    expect(borrowKeys([sloper, backseat])).toEqual({
      openai: 'sk-sloper',
      elevenLabs: 'el-backseat',
    });
  });

  it('is empty with nothing to borrow from', () => {
    expect(borrowKeys([])).toEqual({ openai: null, elevenLabs: null });
  });
});

describe('shouldBorrow', () => {
  const none = { openai: null, elevenLabs: null };

  it('borrows into an undecided, empty copy', () => {
    expect(shouldBorrow(none, false)).toBe(true);
  });

  it('never borrows over a key, or into a copy somebody cleared on purpose', () => {
    expect(shouldBorrow({ openai: 'sk', elevenLabs: null }, false)).toBe(false);
    // The resurrection this flag exists to stop.
    expect(shouldBorrow(none, true)).toBe(false);
  });
});

describe('missingKeys', () => {
  it('asks for both, because every guide needs both', () => {
    expect(missingKeys({ openai: null, elevenLabs: null })).toEqual(['openai', 'elevenLabs']);
    expect(missingKeys({ openai: 'sk', elevenLabs: null })).toEqual(['elevenLabs']);
    expect(missingKeys({ openai: 'sk', elevenLabs: 'el' })).toEqual([]);
  });
});
