/*
 * The figures on the stats page.
 *
 * Two rules run through everything here, and both are the kind that get quietly reversed by a later
 * change unless they are written down:
 *
 *   1. **Only believable, closed entries are counted.** A sleep still running has no duration, and
 *      one left open by mistake has a fictitious one — `groupByDay` has already dropped both. If an
 *      open night were counted, "mean night sleep" would sag every evening as tonight's partial
 *      block landed, and recover by morning, for no reason anyone could see.
 *   2. **Every mean names its own denominator.** They are not the same: a day with naps logged and
 *      no closed night is a day of data for the nap mean and not for the night mean. So each figure
 *      is a `MeanStat` carrying `n`, and the page prints it — an average over two days and an
 *      average over thirty should not look alike.
 *
 * Days still in progress are shown on the charts and excluded from every denominator. Today's naps
 * are real but incomplete, and averaging them in drags every figure down each morning, which is the
 * commonest way a sleep tracker comes to be distrusted.
 */

import { circularStat, linearStat } from './circular';
import { groupByDay, minutesOfDay } from './days';
import type { DayBucket, MeanStat, SleepEntry, SleepStats, TimeWindow } from './types';

function meanStat(values: number[]): MeanStat {
  const { mean, sd, n } = linearStat(values);
  return { mean, sd, n };
}

/** Closed nights attributed to a day. There is normally one; two means the log was edited oddly. */
function closedNights(bucket: DayBucket): SleepEntry[] {
  return bucket.entries.filter((e) => e.kind === 'night' && e.end != null);
}

function closedNaps(bucket: DayBucket): SleepEntry[] {
  return bucket.entries.filter((e) => e.kind === 'nap' && e.end != null);
}

/** A day holding at least one finished sleep — evidence somebody was logging that day. */
function isTracked(bucket: DayBucket): boolean {
  return bucket.entries.some((e) => e.end != null);
}

/** One dot on a spread chart: which day, and the clock time being plotted. */
export interface ClockPoint {
  /** Local midnight of the day the sleep is attributed to — the chart's x value. */
  at: number;
  /** Minutes after midnight. */
  minutes: number;
}

export function computeStats(entries: SleepEntry[], window: TimeWindow, now: number): SleepStats {
  const days = groupByDay(entries, window, now);
  const settled = days.filter((d) => !d.partial);
  const tracked = settled.filter(isTracked);

  const withNight = tracked.filter((d) => d.nightMs != null);

  return {
    days,
    totalPerDay: meanStat(withNight.map((d) => (d.nightMs ?? 0) + d.napMs)),
    nightPerDay: meanStat(withNight.map((d) => d.nightMs as number)),
    napPerDay: meanStat(tracked.map((d) => d.napMs)),
    napsPerDay: meanStat(tracked.map((d) => d.naps)),
    napLength: meanStat(
      tracked.flatMap((d) => closedNaps(d).map((e) => (e.end as number) - e.start))
    ),
    bedtime: circularStat(bedtimePoints(days).map((p) => p.minutes)),
    wakeTime: circularStat(wakePoints(days).map((p) => p.minutes)),
    firstNapStart: circularStat(firstNapPoints(days).map((p) => p.minutes)),
    napStart: circularStat(
      days.flatMap((d) => closedNaps(d).map((e) => minutesOfDay(e.start)))
    ),
  };
}

/*
 * Clock-time points come from every day in the window, today included: a bedtime is a complete fact
 * the moment the night is closed, unlike a daily total, which needs the day to be over. In practice
 * today contributes nothing here anyway — its night has not finished — but the rule is about what
 * the number means, not about which rows happen to be present.
 */

export function bedtimePoints(days: DayBucket[]): ClockPoint[] {
  return days.flatMap((d) =>
    closedNights(d).map((e) => ({ at: d.start, minutes: minutesOfDay(e.start) }))
  );
}

export function wakePoints(days: DayBucket[]): ClockPoint[] {
  return days.flatMap((d) =>
    closedNights(d).map((e) => ({ at: d.start, minutes: minutesOfDay(e.end as number) }))
  );
}

/**
 * The first nap of each day.
 *
 * A single mean over *all* nap starts is close to meaningless: a baby naps two to four times at
 * unrelated hours, so the 9am and the 3pm nap average into something near noon, an hour at which no
 * nap ever began. The first nap is a real, repeatable event in the day's shape, so that is the one
 * worth a headline figure.
 */
export function firstNapPoints(days: DayBucket[]): ClockPoint[] {
  const points: ClockPoint[] = [];
  for (const day of days) {
    const naps = closedNaps(day);
    if (naps.length === 0) continue;
    const first = naps.reduce((a, b) => (a.start <= b.start ? a : b));
    points.push({ at: day.start, minutes: minutesOfDay(first.start) });
  }
  return points;
}
