import { describe, expect, it } from 'vitest';

import { formatUsd, musicUsd, tokenCost, tokenPrice, usdPerVoiceCredit, voiceCost } from './cost';
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

describe('the ElevenLabs rate by day', () => {
  const before = Date.parse('2026-12-16T23:59:00Z');
  const after = Date.parse('2026-12-17T00:00:00Z');

  it('spreads the Creator fee over its 121k credits until the switch, the API list price after', () => {
    expect(usdPerVoiceCredit(before)).toBeCloseTo(22 / 121_000, 12);
    expect(usdPerVoiceCredit(after)).toBeCloseTo(0.08 / 1000, 12);
    // A Flash character is half a credit: $0.04 per 1k characters on the API pricing.
    expect(voiceCost(500, after)).toBeCloseTo(0.04, 10);
  });

  it('prices a score by its credits before the switch and per minute after', () => {
    expect(musicUsd(90, null, before)).toBeCloseTo((1350 * 22) / 121_000, 10);
    expect(musicUsd(90, 1200, before)).toBeCloseTo((1200 * 22) / 121_000, 10);
    expect(musicUsd(90, 1200, after)).toBeCloseTo(0.225, 10);
  });
});
