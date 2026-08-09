import { describe, expect, it } from 'vitest';

import { circularStat, linearStat, MINUTES_PER_DAY, unwrapAround } from './circular';

const at = (h: number, m = 0) => h * 60 + m;

describe('circularStat', () => {
  it('averages across midnight, which is the whole reason it exists', () => {
    // Arithmetically these average to 12:00 — midday, when the baby was demonstrably awake.
    const stat = circularStat([at(23, 50), at(0, 10)]);
    expect(stat.mean).toBeCloseTo(0, 6);
    expect(stat.n).toBe(2);
  });

  it('reports no mean when the times cancel, rather than a plausible-looking hour', () => {
    const stat = circularStat([at(6), at(18)]);
    expect(stat.mean).toBeNull();
    expect(stat.sd).toBeNull();
    expect(stat.n).toBe(2);
    expect(stat.r).toBeLessThan(0.05);
  });

  it('gives a single time itself, with no spread', () => {
    expect(circularStat([at(7)])).toMatchObject({ mean: at(7), sd: 0, n: 1 });
  });

  it('gives identical times zero spread without going NaN on the rounding', () => {
    const stat = circularStat([at(21, 30), at(21, 30), at(21, 30)]);
    expect(stat.mean).toBeCloseTo(at(21, 30), 6);
    expect(stat.sd).toBe(0);
  });

  it('has nothing to say about no times at all', () => {
    expect(circularStat([])).toMatchObject({ mean: null, sd: null, n: 0 });
  });

  it('grows the spread as the times scatter', () => {
    const tight = circularStat([at(20, 55), at(21), at(21, 5)]);
    const loose = circularStat([at(19), at(21), at(23)]);
    expect(tight.sd).toBeLessThan(loose.sd as number);
  });

  it('is rotation-equivariant: shifting every input shifts the mean and leaves the spread alone', () => {
    const base = circularStat([at(20), at(21), at(23)]);
    const shifted = circularStat([at(20) + 120, at(21) + 120, at(23) + 120]);
    expect(shifted.mean).toBeCloseTo(((base.mean as number) + 120) % MINUTES_PER_DAY, 6);
    expect(shifted.sd).toBeCloseTo(base.sd as number, 6);
  });

  it('always reports a mean inside one day', () => {
    const stat = circularStat([at(23, 30), at(23, 50), at(0, 40)]);
    expect(stat.mean).toBeGreaterThanOrEqual(0);
    expect(stat.mean).toBeLessThan(MINUTES_PER_DAY);
  });
});

describe('unwrapAround', () => {
  it('moves a time to the near side of its centre', () => {
    expect(unwrapAround(10, 1430)).toBe(1450);
    expect(unwrapAround(1430, 10)).toBe(-10);
  });

  it('leaves a time already near the centre alone', () => {
    expect(unwrapAround(1300, 1320)).toBe(1300);
    expect(unwrapAround(0, 0)).toBe(0);
  });

  it('keeps the distance to the centre at most half a day', () => {
    for (const m of [0, 200, 719, 720, 721, 1439]) {
      expect(Math.abs(unwrapAround(m, 1380) - 1380)).toBeLessThanOrEqual(MINUTES_PER_DAY / 2);
    }
  });
});

describe('linearStat', () => {
  it('is an ordinary mean and population SD', () => {
    expect(linearStat([2, 4, 6])).toMatchObject({ mean: 4, n: 3 });
    expect(linearStat([2, 4, 6]).sd).toBeCloseTo(Math.sqrt(8 / 3), 10);
  });

  it('gives one value no spread and no values nothing', () => {
    expect(linearStat([5])).toMatchObject({ mean: 5, sd: 0, n: 1 });
    expect(linearStat([])).toMatchObject({ mean: null, sd: null, n: 0 });
  });
});
