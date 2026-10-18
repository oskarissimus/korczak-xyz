import { describe, expect, it } from 'vitest';

import { formatUsd, tokenCost, tokenPrice } from './cost';
import { voiceCredits } from './devlog';

describe('cost', () => {
  it('prices by the longest matching prefix', () => {
    expect(tokenPrice('gemini-3.1-flash-lite')).toEqual({ input: 0.25, output: 1.5 });
    expect(tokenPrice('gemini-3.1-pro-preview')).toEqual({ input: 2, output: 12 });
    expect(tokenPrice('gemini-2.5-flash-lite')).toEqual({ input: 0.1, output: 0.4 });
    expect(tokenPrice('gpt-4.1-2025-04-14')).toEqual({ input: 2, output: 8 });
  });

  it('bills thinking as output and has no price for a model it does not know', () => {
    expect(tokenCost('gemini-3-flash-preview', { input: 1_000_000, output: 0, thoughts: 1_000_000 })).toBe(3.5);
    expect(tokenCost('gemma-4-31b-it', { input: 9000, output: 9000, thoughts: 0 })).toBe(0);
    expect(tokenCost('gemini-flash-latest', { input: 1, output: 1, thoughts: 0 })).toBeNull();
    expect(formatUsd(null)).toBe('?');
  });

  it('takes ElevenLabs’ own credit count when the response gives one', () => {
    expect(voiceCredits(100, '42')).toBe(42);
    expect(voiceCredits(100, null)).toBe(50);
  });
});
