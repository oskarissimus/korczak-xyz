import { describe, expect, it } from 'vitest';

import { keyHeaders, missingKeys, NO_KEYS } from './keys';

describe('missingKeys', () => {
  it('asks for the writer’s key and ElevenLabs, because every guide needs both', () => {
    expect(missingKeys(NO_KEYS)).toEqual(['google', 'elevenLabs']);
    expect(missingKeys({ ...NO_KEYS, google: 'g' })).toEqual(['elevenLabs']);
    expect(missingKeys({ ...NO_KEYS, google: 'g', elevenLabs: 'el' })).toEqual([]);
  });

  it('asks for OpenAI instead when OpenAI writes, whatever Google key there is', () => {
    const keys = { ...NO_KEYS, writer: 'openai' as const, google: 'g', elevenLabs: 'el' };
    expect(missingKeys(keys)).toEqual(['openai']);
    expect(missingKeys({ ...keys, openai: 'sk' })).toEqual([]);
  });
});

describe('keyHeaders', () => {
  it('sends only the writer’s key, so the function takes that writer’s path', () => {
    const keys = { writer: 'google' as const, google: 'g', openai: 'sk', elevenLabs: 'el' };
    expect(keyHeaders(keys)).toEqual({ 'X-Google-Key': 'g', 'X-ElevenLabs-Key': 'el' });
    expect(keyHeaders({ ...keys, writer: 'openai' })).toEqual({
      'X-OpenAI-Key': 'sk',
      'X-ElevenLabs-Key': 'el',
    });
  });
});
