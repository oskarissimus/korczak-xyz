import { describe, expect, it } from 'vitest';
import {
  A4_HZ,
  centsBetween,
  isInTune,
  nearestString,
  STANDARD_TUNING,
} from './notes';

describe('STANDARD_TUNING', () => {
  it('runs low to high, six strings, numbered the way guitarists number them', () => {
    expect(STANDARD_TUNING).toHaveLength(6);
    expect(STANDARD_TUNING.map((s) => s.name)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    // String 1 is the thinnest, so the numbering runs backwards against the pitch order.
    expect(STANDARD_TUNING.map((s) => s.number)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('matches the published equal-tempered frequencies at A440', () => {
    const expected = [82.41, 110.0, 146.83, 195.998, 246.94, 329.63];
    STANDARD_TUNING.forEach((string, i) => {
      expect(string.frequency).toBeCloseTo(expected[i], 1);
    });
  });

  it('places A2 exactly two octaves below the reference', () => {
    expect(STANDARD_TUNING[1].frequency).toBeCloseTo(A4_HZ / 4, 10);
  });
});

describe('centsBetween', () => {
  it('is zero at the reference', () => {
    expect(centsBetween(440, 440)).toBe(0);
  });

  it('makes an octave 1200 cents', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 10);
  });

  it('is negative when flat', () => {
    expect(centsBetween(430, 440)).toBeLessThan(0);
  });

  /*
   * The reason the whole tuner works in cents. The same 1 Hz error is a fifth of the tolerance on
   * the low E and a twentieth of it on the high E, so a needle marked in hertz would mean a
   * different thing on every string.
   */
  it('gives one hertz a different weight on each end of the instrument', () => {
    const lowE = Math.abs(centsBetween(83.41, 82.41));
    const highE = Math.abs(centsBetween(330.63, 329.63));
    expect(lowE / highE).toBeGreaterThan(3.5);
  });
});

describe('nearestString', () => {
  it.each(STANDARD_TUNING.map((s) => [s.name, s.frequency] as const))(
    'matches %s to itself when exactly in tune',
    (name, frequency) => {
      const match = nearestString(frequency);
      expect(match.string.name).toBe(name);
      expect(match.cents).toBeCloseTo(0, 6);
    },
  );

  it('reports how flat a string is', () => {
    const match = nearestString(80); // a little under E2
    expect(match.string.name).toBe('E2');
    expect(match.cents).toBeLessThan(0);
    expect(match.cents).toBeGreaterThan(-100);
  });

  /*
   * The known limit of auto-detection. B3 and G3 are four semitones apart, the closest pair in
   * standard tuning, so a string more than two semitones flat crosses over and is attributed to
   * its neighbour. Pinned here so the behaviour is a documented boundary rather than a surprise.
   */
  it('hands a badly flat string to its lower neighbour past the halfway point', () => {
    const b3 = STANDARD_TUNING[4];
    const justInside = b3.frequency * Math.pow(2, -190 / 1200);
    const pastHalfway = b3.frequency * Math.pow(2, -210 / 1200);
    expect(nearestString(justInside).string.name).toBe('B3');
    expect(nearestString(pastHalfway).string.name).toBe('G3');
  });

  it('clamps to the outer strings beyond either end of the instrument', () => {
    expect(nearestString(60).string.name).toBe('E2');
    expect(nearestString(1200).string.name).toBe('E4');
  });
});

describe('isInTune', () => {
  it('accepts five cents either way and nothing beyond', () => {
    expect(isInTune(0)).toBe(true);
    expect(isInTune(5)).toBe(true);
    expect(isInTune(-5)).toBe(true);
    expect(isInTune(5.1)).toBe(false);
    expect(isInTune(-5.1)).toBe(false);
  });
});
