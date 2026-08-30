/*
 * A trailing mean over the last few nights — the line that says which way the numbers are going.
 *
 * The mean already on the night-length chart is one flat line across the whole window, so it answers
 * "how much does this vary" and cannot answer "is it getting better": a fortnight of slow
 * improvement and a fortnight of noise draw the same picture under it. A moving average is the
 * second line that tells them apart.
 *
 * Three rules, each of the kind that gets quietly reversed by a later change unless it is written
 * down:
 *
 *   1. **The window counts logged points, not calendar days.** A night nobody logged is not a night
 *      of zero sleep, and a window measured in days would have to either invent one or silently
 *      shorten itself. Counting points also makes DST irrelevant, which a millisecond window would
 *      not be — the day buckets here are local midnights, and two of them a year are not 24 hours
 *      apart.
 *   2. **Full windows only.** Fewer points than the window gives nothing at all, and the line starts
 *      at the seventh night rather than at the first. Every point on it is then genuinely a mean of
 *      seven, which is what the legend beside it claims; a line whose left end averages one night
 *      and whose right end averages seven is noisier on the left than it looks, and nothing on the
 *      chart says so.
 *   3. **A point sits at the *last* night of its window**, not in the middle of it. Centring the
 *      average would draw it three days to the left of the data it summarises and leave the three
 *      most recent nights — the ones actually being looked at — with no line over them.
 *
 * Input order is the caller's business and is not re-sorted here: `nightDurationPoints` walks the
 * day buckets, which `groupByDay` already returns oldest first.
 */

import type { DurationPoint } from './stats';

/**
 * A week: long enough to absorb the one bad night, short enough to still turn inside a month.
 *
 * One window for every chart that draws this line — the night's length and both activity windows —
 * because a legend saying "7-day average" beside a line smoothed over five is the kind of quiet
 * disagreement nothing on the screen would ever show.
 */
export const AVERAGE_WINDOW = 7;

/**
 * The mean of each run of `window` consecutive points, placed at the last point of its run.
 *
 * Empty when there are fewer points than the window, or when the window is not a positive whole
 * number — a window of zero has no mean and one of 1.5 has no meaning.
 */
export function movingAverage(points: DurationPoint[], window: number): DurationPoint[] {
  if (!Number.isInteger(window) || window < 1) return [];
  if (points.length < window) return [];

  const out: DurationPoint[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    sum += points[i].ms;
    if (i >= window) sum -= points[i - window].ms;
    if (i >= window - 1) out.push({ at: points[i].at, ms: sum / window });
  }
  return out;
}
