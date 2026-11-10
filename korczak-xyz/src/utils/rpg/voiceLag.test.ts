import { describe, expect, it } from 'vitest';

import { lagFor, percentile, recordVoiceLag, summarize } from './voiceLag';

describe('voice lag', () => {
  it('takes nearest-rank percentiles', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(summarize([300, 100, 200])).toEqual({ n: 3, median: 200, p90: 300 });
  });

  it('finds the latest record for a line', () => {
    const base = { at: 0, fetchMs: 0, startMs: 0, afterHeroMs: null, cached: false, free: false };
    recordVoiceLag({ ...base, who: 'Ada', text: 'Hej.', lagMs: 900 });
    recordVoiceLag({ ...base, who: 'Ada', text: 'Hej.', lagMs: 120 });
    expect(lagFor('Ada', 'Hej.')?.lagMs).toBe(120);
    expect(lagFor('Ada', 'Nie.')).toBeUndefined();
  });
});
