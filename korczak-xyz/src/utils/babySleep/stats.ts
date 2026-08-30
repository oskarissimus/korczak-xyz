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
 *
 * A third rule joined them when night wakings arrived: **a night is however many blocks it was slept
 * in, and it is still one night.** Several `night` entries on one day are a night broken by a
 * waking, whether they were logged live ("woke up", then "night sleep" again at 3am) or cut apart
 * afterwards by `split.ts`. So its duration is the blocks added up, its bedtime is the first block's
 * start and its wake-up is the last block's end — one of each per day, never one per entry.
 */

import { circularStat, linearStat } from './circular';
import { groupByDay, minutesOfDay } from './days';
import type { DayBucket, MeanStat, SleepEntry, SleepStats, TimeWindow } from './types';
import { isPlausible } from './types';

function meanStat(values: number[]): MeanStat {
  const { mean, sd, n } = linearStat(values);
  return { mean, sd, n };
}

/**
 * The night attributed to a day, as the blocks it was actually slept in — earliest first.
 *
 * Null when the day has no night at all, and null when any of its blocks is still running: half a
 * night has no wake-up time, and a night with a block open is half a night however much of it is
 * already closed.
 *
 * That second case is why this exists rather than a filter on `nightMs`. Before wakings were
 * modelled, an unfinished night left `nightMs` null and that alone kept tonight out of every night
 * figure. A broken night can have a closed first block and a running second one, so it reports a
 * duration while the baby is still asleep — and `nightMs == null` would let it into the averages.
 */
export function nightBlocks(bucket: DayBucket): SleepEntry[] | null {
  const nights = bucket.entries.filter((e) => e.kind === 'night');
  if (nights.length === 0 || nights.some((e) => e.end == null)) return null;
  return [...nights].sort((a, b) => a.start - b.start);
}

/** How many times a night was broken. Zero for a night slept through — a real figure, not missing. */
function wakeCount(blocks: SleepEntry[]): number {
  return blocks.length - 1;
}

/** Time spent awake between the blocks of one night. */
function awakeMs(blocks: SleepEntry[]): number {
  let total = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    total += Math.max(0, blocks[i].start - (blocks[i - 1].end as number));
  }
  return total;
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

/** One dot on a duration chart: which day, and how long the sleep lasted. */
export interface DurationPoint {
  /** Local midnight of the day the sleep is attributed to — the chart's x value. */
  at: number;
  ms: number;
}

/**
 * Longer than this and the gap is a nap nobody logged, not a stretch anybody stayed awake for.
 *
 * `MAX_SETTLE_MS`'s rule, applied to the other join this app makes between two records: an activity
 * window is measured between two sleeps, so a missing sleep in the middle silently doubles one. Nine
 * hours would then land in the mean as a day the baby was up all morning, and nothing on the chart
 * would say the afternoon nap was the first one logged. Excluded rather than counted — a fabricated
 * window is worse than a gap. Eight hours is past any real one and short enough to catch that.
 */
export const MAX_WAKE_MS = 8 * 60 * 60_000;

/**
 * The morning wake-up on a day: the latest night block that *ended* inside it.
 *
 * Read off the ends rather than off the day's own night, because the night a morning belongs to is
 * filed under the *previous* day — a night beginning at 20:40 on the 18th is the 18th's, and the
 * wake-up it produces is the 19th's morning. Going through the previous day's bucket would also cost
 * the first day of every window its point, that night having started before the window opened.
 *
 * A night broken by a waking needs nothing special: the last block to end is the one he got up from.
 */
function morningWakeAt(day: DayBucket, nightEnds: number[]): number | null {
  let last: number | null = null;
  for (const end of nightEnds) {
    if (end < day.start || end >= day.end) continue;
    if (last == null || end > last) last = end;
  }
  return last;
}

/** Every believable night block's wake time, whichever day the night itself was filed under. */
function nightEndsOf(entries: SleepEntry[], now: number): number[] {
  return entries.flatMap((e) =>
    e.kind === 'night' && e.end != null && isPlausible(e, now) ? [e.end] : []
  );
}

/** The naps attributed to a day, earliest first. Running ones included — a start is a start. */
function napsOf(bucket: DayBucket): SleepEntry[] {
  return bucket.entries.filter((e) => e.kind === 'nap');
}

/** One activity window, or null when either end of it is missing or past believing. */
function wakeWindow(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null;
  const ms = to - from;
  return ms > 0 && ms <= MAX_WAKE_MS ? ms : null;
}

/*
 * The activity windows — how long he was awake between one sleep and the next.
 *
 * Two of them get a chart, because they are two different questions. The **first** is set by the
 * morning: it is the one that decides whether the first nap lands mid-morning or at noon, and it is
 * the window that shifts as he grows out of one. The **second** is set by how the first nap went — a
 * forty-minute nap and a two-hour one do not buy the same afternoon — so pooling the two would
 * average away exactly what each is for.
 *
 * Both follow the **clock-point rule and not the duration one**, so today is included: a window is a
 * complete fact the moment the next sleep begins, however much of the day is still to come. That is
 * `routineStats.ts`'s rule for a settling time, and it holds here for its reason.
 */

/** Morning wake-up to the first nap, one point a day. */
export function firstWakeWindowPoints(
  days: DayBucket[],
  entries: SleepEntry[],
  now: number
): DurationPoint[] {
  const ends = nightEndsOf(entries, now);
  return days.flatMap((day) => {
    const naps = napsOf(day);
    if (naps.length === 0) return [];
    const ms = wakeWindow(morningWakeAt(day, ends), naps[0].start);
    return ms == null ? [] : [{ at: day.start, ms }];
  });
}

/**
 * The first nap to the second, one point a day.
 *
 * Needs no entries beyond the day's own: both ends of it are naps, and a nap is filed under the day
 * it happened on. It needs the first nap *closed*, where the window above needs only a start — which
 * is why a day with one nap still running contributes to the first chart and not to this one.
 */
export function secondWakeWindowPoints(days: DayBucket[]): DurationPoint[] {
  return days.flatMap((day) => {
    const naps = napsOf(day);
    if (naps.length < 2) return [];
    const ms = wakeWindow(naps[0].end, naps[1].start);
    return ms == null ? [] : [{ at: day.start, ms }];
  });
}

export function computeStats(entries: SleepEntry[], window: TimeWindow, now: number): SleepStats {
  const days = groupByDay(entries, window, now);
  const settled = days.filter((d) => !d.partial);
  const tracked = settled.filter(isTracked);

  // Days whose night is finished, paired with the blocks it was slept in. `nightMs` on these is the
  // whole night, because every block of it is closed.
  const nights = tracked.flatMap((d) => {
    const blocks = nightBlocks(d);
    return blocks ? [{ day: d, blocks }] : [];
  });
  const withNight = nights.map((n) => n.day);

  return {
    days,
    totalPerDay: meanStat(withNight.map((d) => (d.nightMs ?? 0) + d.napMs)),
    // Through the point extractor, not over `withNight`, so the tile and the chart drawn beneath it
    // are the same population by construction — the clock figures have worked that way from the
    // start, and a mean over one set of nights beside dots showing another is exactly the kind of
    // disagreement nobody notices until they add the dots up by hand.
    nightPerDay: meanStat(nightDurationPoints(days).map((p) => p.ms)),
    nightWakes: meanStat(nights.map((n) => wakeCount(n.blocks))),
    nightAwake: meanStat(nights.map((n) => awakeMs(n.blocks))),
    napPerDay: meanStat(tracked.map((d) => d.napMs)),
    napsPerDay: meanStat(tracked.map((d) => d.naps)),
    napLength: meanStat(
      tracked.flatMap((d) => closedNaps(d).map((e) => (e.end as number) - e.start))
    ),
    // Through the extractors, like `nightPerDay` and for its reason: the tile and the chart under it
    // are then one population, today included in both or in neither.
    firstWakeWindow: meanStat(firstWakeWindowPoints(days, entries, now).map((p) => p.ms)),
    secondWakeWindow: meanStat(secondWakeWindowPoints(days).map((p) => p.ms)),
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

/*
 * One point per *night*, not one per night entry. A night broken by a waking is two entries, and
 * mapping over them gave that day two bedtimes and two wake-ups — a 03:20 "bedtime" and a 03:00
 * "wake-up" that nobody experienced, dragging both circular means towards the middle of the night.
 * The bedtime is when the night started and the wake-up is when it ended, however many times it was
 * interrupted in between.
 */

export function bedtimePoints(days: DayBucket[]): ClockPoint[] {
  return days.flatMap((d) => {
    const blocks = nightBlocks(d);
    return blocks ? [{ at: d.start, minutes: minutesOfDay(blocks[0].start) }] : [];
  });
}

export function wakePoints(days: DayBucket[]): ClockPoint[] {
  return days.flatMap((d) => {
    const blocks = nightBlocks(d);
    if (!blocks) return [];
    return [{ at: d.start, minutes: minutesOfDay(blocks[blocks.length - 1].end as number) }];
  });
}

/**
 * How long each night was — its blocks added up, one point per night.
 *
 * Days still in progress are excluded here, and that is the one place these points part company with
 * the clock ones above. A bedtime is a complete fact the moment the night starts; a *duration* is
 * only complete once the night is over, and a day is not settled while more sleep may still be
 * attributed to it. In practice the difference rarely shows — tonight's night is running, so
 * `nightBlocks` already refuses it — but the rule is about what the number means, and it is what
 * keeps this set identical to the one `nightPerDay` averages.
 */
export function nightDurationPoints(days: DayBucket[]): DurationPoint[] {
  return days.flatMap((d) => {
    if (d.partial) return [];
    // Every block is closed, so the day's `nightMs` is the whole night.
    return nightBlocks(d) ? [{ at: d.start, ms: d.nightMs as number }] : [];
  });
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
