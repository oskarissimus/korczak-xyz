import { describe, expect, it } from 'vitest';

import {
  estimateImageCost,
  estimateLlmCost,
  estimateTotalCost,
  estimateTtsCost,
  formatUsd,
} from './pricing';

/*
 * The estimate is shown before anything is spent, which is the only reason it exists — so the
 * cases worth testing are the ones where it could be confidently wrong rather than honestly
 * unknown. Every one below is a place where a lookup can miss, and the assertion is about what it
 * does then.
 */
describe('estimateLlmCost', () => {
  it('scales with the target length and the scene count', () => {
    const short = estimateLlmCost('gpt-4o', 30, 3);
    const long = estimateLlmCost('gpt-4o', 300, 12);
    expect(long.completionTokens).toBeGreaterThan(short.completionTokens);
    expect(long.totalCost).toBeGreaterThan(short.totalCost);
  });

  /* An unlisted model gets gpt-4o's rates AND says so — the flag is what puts the caveat on screen. */
  it('flags a model it has never heard of', () => {
    const known = estimateLlmCost('gpt-4o', 60, 6);
    const unknown = estimateLlmCost('gpt-9-ultra', 60, 6);
    expect(known.modelFound).toBe(true);
    expect(unknown.modelFound).toBe(false);
    expect(unknown.totalCost).toBeCloseTo(known.totalCost, 10);
  });
});

describe('estimateImageCost', () => {
  it('prices a listed OpenAI model per image and multiplies by the scenes', () => {
    const one = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1024 }, 1);
    const six = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1024 }, 6);
    expect(one.perImage).not.toBeNull();
    expect(six.total).toBeCloseTo((one.perImage ?? 0) * 6, 10);
  });

  /*
   * The estimate must be quoted for the size that will actually be requested. DALL-E 3 does not
   * serve 1024x1536, so images.ts sends 1024x1792 — and a price quoted for 1024x1024 against a
   * request that becomes 1024x1792 is worse than no price at all.
   */
  it('quotes the size the request will be normalized to, not the one asked for', () => {
    const portrait = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1536 }, 1);
    const tall = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1792 }, 1);
    expect(portrait.perImage).toBe(tall.perImage);
  });

  it('maps low/medium/high onto standard/hd where that is what the table says', () => {
    const low = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1024 }, 1);
    const high = estimateImageCost('openai', 'dall-e-3', 'high', { width: 1024, height: 1024 }, 1);
    expect(high.perImage).toBeGreaterThan(low.perImage ?? 0);
  });

  it('says it does not know rather than guessing, for an unlisted model', () => {
    const unknown = estimateImageCost('openai', 'dall-e-7', 'low', { width: 1024, height: 1024 }, 4);
    expect(unknown.modelFound).toBe(false);
    expect(unknown.perImage).toBeNull();
    expect(unknown.total).toBeNull();
  });

  /* Gemini ids carry a date suffix, so an exact miss falls back to the longest matching prefix. */
  it('matches a dated Gemini model id by prefix', () => {
    const exact = estimateImageCost('google', 'gemini-2.5-flash-image', '1:1' as never, { width: 1024, height: 1024 }, 1);
    const dated = estimateImageCost('google', 'gemini-2.5-flash-image-preview-09-2026', '1:1' as never, { width: 1024, height: 1024 }, 1);
    expect(exact.isGemini).toBe(true);
    if (exact.perImage !== null) expect(dated.perImage).toBe(exact.perImage);
  });
});

describe('estimateTtsCost', () => {
  it('counts characters from the target length, not from a written script', () => {
    // 60s × 2.5 words/s × 5 chars/word.
    expect(estimateTtsCost('eleven_multilingual_v2', 'starter', 60).totalChars).toBe(750);
  });

  it('puts turbo and flash models in the cheaper band', () => {
    const standard = estimateTtsCost('eleven_multilingual_v2', 'pro', 60);
    const turbo = estimateTtsCost('eleven_turbo_v2_5', 'pro', 60);
    expect(standard.modelFound).toBe(true);
    expect(turbo.modelFound).toBe(true);
    if (standard.perKChars !== null && turbo.perKChars !== null) {
      expect(turbo.perKChars).toBeLessThanOrEqual(standard.perKChars);
    }
  });
});

describe('estimateTotalCost', () => {
  const llm = estimateLlmCost('gpt-4o', 60, 6);

  it('adds the three halves when all three are known', () => {
    const image = estimateImageCost('openai', 'dall-e-3', 'low', { width: 1024, height: 1024 }, 6);
    const tts = estimateTtsCost('eleven_multilingual_v2', 'pro', 60);
    expect(estimateTotalCost(llm, image, tts)).toBeCloseTo(
      llm.totalCost + (image.total ?? 0) + (tts.totalCost ?? 0),
      10,
    );
  });

  /*
   * One unknown half is still worth a number — the known parts are real money. Both unknown is
   * the case where the total would be the script cost dressed up as a total, so it is reported
   * as exactly the script cost and the UI's "varies" note carries the rest.
   */
  it('still totals when one half is unknown', () => {
    const image = estimateImageCost('openai', 'dall-e-7', 'low', { width: 1024, height: 1024 }, 6);
    const tts = estimateTtsCost('eleven_multilingual_v2', 'pro', 60);
    const total = estimateTotalCost(llm, image, tts);
    expect(total).toBeCloseTo(llm.totalCost + (tts.totalCost ?? 0), 10);
  });
});

describe('formatUsd', () => {
  /* Slop videos cost fractions of a cent; two decimal places would print every one of them as $0.00. */
  it('gives four places under a cent and two above it', () => {
    expect(formatUsd(0.0031)).toBe('$0.0031');
    expect(formatUsd(1.5)).toBe('$1.50');
  });
});
