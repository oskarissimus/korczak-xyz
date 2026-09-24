import { describe, expect, it } from 'vitest';

import { parseServerTiming } from './telemetry';

describe('parseServerTiming', () => {
  it('reads what the function writes', () => {
    expect(
      parseServerTiming('cold, articles;dur=812, facts;dur=6120, sources;dur=1403, total;dur=21400'),
    ).toEqual({ cold: 1, articles: 812, facts: 6120, sources: 1403, total: 21400 });
  });

  it('is empty without a header', () => {
    expect(parseServerTiming(null)).toEqual({});
    expect(parseServerTiming('')).toEqual({});
  });

  it('skips what it cannot read rather than guessing', () => {
    expect(parseServerTiming('facts;dur=abc, ;dur=5, weird name;dur=3, tts;desc="x";dur=9.6')).toEqual({
      tts: 10,
    });
  });
});
