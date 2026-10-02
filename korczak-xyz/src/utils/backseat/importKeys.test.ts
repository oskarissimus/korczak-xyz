import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, DEFAULT_GOOGLE_MODEL } from './defaults';
import { switchedToGoogle, GOOGLE_SWITCH_AT } from './importKeys';

describe('switchedToGoogle', () => {
  const before = GOOGLE_SWITCH_AT - 1;
  const onOpenAi = {
    ...DEFAULT_CONFIG,
    apiKeys: { openai: 'sk-a', google: null, elevenLabs: null },
    vision: { provider: 'openai' as const, model: 'gpt-4o-mini' },
  };

  it('moves an OpenAI config saved before the switch to Gemma with the wizard’s Google key', () => {
    const config = switchedToGoogle(onOpenAi, before, 'AIza-w');
    expect(config?.vision).toEqual({ provider: 'google', model: DEFAULT_GOOGLE_MODEL });
    expect(config?.apiKeys).toEqual({ openai: 'sk-a', google: 'AIza-w', elevenLabs: null });
  });

  it('prefers a Google key the config already holds', () => {
    const own = { ...onOpenAi, apiKeys: { ...onOpenAi.apiKeys, google: 'AIza-own' } };
    expect(switchedToGoogle(own, before, 'AIza-w')?.apiKeys.google).toBe('AIza-own');
  });

  it('leaves alone a config chosen after the switch, or one with no Google key anywhere', () => {
    expect(switchedToGoogle(onOpenAi, GOOGLE_SWITCH_AT + 1, 'AIza-w')).toBeNull();
    expect(switchedToGoogle(onOpenAi, before, null)).toBeNull();
    expect(switchedToGoogle(DEFAULT_CONFIG, before, 'AIza-w')).toBeNull();
  });
});

describe('switchedToGoogle, off the first Gemma default', () => {
  const onGemma = {
    ...DEFAULT_CONFIG,
    apiKeys: { openai: null, google: 'AIza', elevenLabs: null },
    vision: { provider: 'google' as const, model: 'gemma-3-27b-it' },
  };

  it('moves a config put on Gemma before the second switch to the new default, once', () => {
    expect(switchedToGoogle(onGemma, Date.UTC(2026, 9, 1, 10, 57), null)?.vision.model).toBe(
      DEFAULT_GOOGLE_MODEL,
    );
    expect(switchedToGoogle(onGemma, Date.UTC(2026, 9, 1, 12, 0), null)).toBeNull();
  });
});
