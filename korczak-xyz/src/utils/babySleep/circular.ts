/*
 * Means and spreads of clock times.
 *
 * A clock is a circle, and an arithmetic average does not know that. Bedtimes of 23:50 and 00:10
 * are twenty minutes apart and average to midnight; averaged as numbers they give 12:00 — midday,
 * the one time of day the baby was demonstrably awake. Any bedtime statistic computed the obvious
 * way is wrong for exactly the family whose bedtime is near midnight, which is most of them.
 *
 * So each time becomes a unit vector, the vectors are averaged, and the mean is that vector's
 * direction. The length of the resultant, `r`, measures agreement: 1 when every time is identical,
 * 0 when they cancel. The spread the owner asked for as "variance" is the circular standard
 * deviation, sqrt(-2 ln r), which behaves like an ordinary SD in minutes while the times are
 * clustered and grows without bound as they scatter.
 *
 * When `r` is near zero the mean direction is *undefined* — not zero, and not some plausible-looking
 * hour. Two bedtimes twelve hours apart have no meaningful average, and reporting one would be a
 * fabricated number sitting in a tile looking like a measurement. So it returns null.
 */

import type { ClockStat } from './types';

export const MINUTES_PER_DAY = 1440;

/**
 * Below this resultant length the times are spread so widely that their mean direction carries no
 * information. Roughly: two times more than ~16 hours apart, or a genuinely scattered handful.
 */
const MIN_RESULTANT = 0.05;

export const EMPTY_CLOCK_STAT: ClockStat = { mean: null, sd: null, n: 0, r: 0 };

/**
 * Mean and circular SD of times given as minutes after midnight.
 *
 * A single value has a mean and zero spread. No values, or values that cancel, have neither.
 */
export function circularStat(minutes: number[]): ClockStat {
  const n = minutes.length;
  if (n === 0) return EMPTY_CLOCK_STAT;

  let sumSin = 0;
  let sumCos = 0;
  for (const m of minutes) {
    const angle = (2 * Math.PI * m) / MINUTES_PER_DAY;
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  }
  const r = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / n;
  if (r < MIN_RESULTANT) return { mean: null, sd: null, n, r };

  let mean = (Math.atan2(sumSin / n, sumCos / n) * MINUTES_PER_DAY) / (2 * Math.PI);
  mean = ((mean % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  // r can exceed 1 by a rounding hair when every value is identical, which would make the log
  // positive and the sqrt NaN.
  const sd = r >= 1 ? 0 : (Math.sqrt(-2 * Math.log(r)) * MINUTES_PER_DAY) / (2 * Math.PI);

  return { mean, sd, n, r };
}

/**
 * The representation of `minutes` nearest to `center`, which may fall outside 0–1439.
 *
 * This is how a chart plots clock times without a seam: with a mean near midnight, 23:50 becomes
 * -10 and sits just below 00:10 instead of at the opposite edge of the axis. The dots and the SD
 * band must both go through this, or the shading ends up a day away from the points it describes.
 */
export function unwrapAround(minutes: number, center: number): number {
  let m = minutes;
  while (m - center > MINUTES_PER_DAY / 2) m -= MINUTES_PER_DAY;
  while (center - m > MINUTES_PER_DAY / 2) m += MINUTES_PER_DAY;
  return m;
}

/** Ordinary mean and SD, for durations — which are lengths, not directions, and not circular. */
export function linearStat(values: number[]): { mean: number | null; sd: number | null; n: number } {
  const n = values.length;
  if (n === 0) return { mean: null, sd: null, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, sd: 0, n };
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance), n };
}
