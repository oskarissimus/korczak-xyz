import { describe, expect, it } from 'vitest';

import { resolveWindow } from './days';
import { bedtimePoints, computeStats, firstNapPoints, wakePoints } from './stats';
import { groupByDay } from './days';
import type { SleepEntry, SleepKind } from './types';

const T0 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const local = (d: number, h: number, mi = 0) => new Date(2026, 0, d, h, mi, 0, 0).getTime();
const HOUR = 3_600_000;

let seq = 0;
function entry(kind: SleepKind, start: number, end: number | null): SleepEntry {
  seq += 1;
  return { id: `e${seq}`, kind, start, end, rev: 0, updatedAt: start, writerId: 'w' };
}

/** A tidy day: two naps and a night starting that evening. */
function normalDay(d: number): SleepEntry[] {
  return [
    entry('nap', local(d, 9), local(d, 10, 30)),
    entry('nap', local(d, 13), local(d, 14)),
    entry('night', local(d, 20), local(d + 1, 6)),
  ];
}

const week = resolveWindow('7d', T0);

describe('computeStats', () => {
  it('reports nothing rather than zero when the window is empty', () => {
    const stats = computeStats([], week, T0);
    for (const metric of [
      stats.totalPerDay,
      stats.nightPerDay,
      stats.napPerDay,
      stats.napsPerDay,
      stats.napLength,
    ]) {
      expect(metric).toEqual({ mean: null, sd: null, n: 0 });
    }
    expect(stats.bedtime.mean).toBeNull();
    expect(stats.wakeTime.mean).toBeNull();
  });

  it('averages the days it has', () => {
    const entries = [...normalDay(12), ...normalDay(13)];
    const stats = computeStats(entries, week, T0);
    expect(stats.nightPerDay).toMatchObject({ mean: 10 * HOUR, n: 2 });
    expect(stats.napPerDay).toMatchObject({ mean: 150 * 60_000, n: 2 });
    expect(stats.totalPerDay.mean).toBe(10 * HOUR + 150 * 60_000);
    expect(stats.napsPerDay.mean).toBe(2);
    expect(stats.napLength.mean).toBe(75 * 60_000);
    expect(stats.napLength.n).toBe(4);
  });

  it('counts a gap day as no data, not as a day of no sleep', () => {
    // Two tracked days out of seven. Dividing by seven would halve every figure.
    const stats = computeStats([...normalDay(12), ...normalDay(13)], week, T0);
    expect(stats.nightPerDay.n).toBe(2);
  });

  it('gives each metric its own denominator', () => {
    // Naps on both days; a closed night on one only.
    const entries = [
      ...normalDay(12),
      entry('nap', local(13, 9), local(13, 10)),
    ];
    const stats = computeStats(entries, week, T0);
    expect(stats.napPerDay.n).toBe(2);
    expect(stats.nightPerDay.n).toBe(1);
    expect(stats.totalPerDay.n).toBe(1);
  });

  it('leaves today out of the averages, so they do not sag every morning', () => {
    // T0 is midday on the 15th, so the 15th is still in progress.
    const entries = [...normalDay(13), entry('nap', local(15, 9), local(15, 9, 40))];
    const stats = computeStats(entries, week, T0);
    expect(stats.napPerDay.n).toBe(1);
    expect(stats.napPerDay.mean).toBe(150 * 60_000);
  });

  it('still shows today on the chart', () => {
    const stats = computeStats([entry('nap', local(15, 9), local(15, 9, 40))], week, T0);
    const today = stats.days.find((d) => d.key === '2026-01-15');
    expect(today?.partial).toBe(true);
    expect(today?.napMs).toBe(40 * 60_000);
  });

  it('lets no forgotten timer near a mean', () => {
    const clean = computeStats(normalDay(13), week, T0);
    const withJunk = computeStats([...normalDay(13), entry('nap', local(13, 15), local(14, 2))], week, T0);
    expect(withJunk.napPerDay.mean).toBe(clean.napPerDay.mean);
    expect(withJunk.napsPerDay.mean).toBe(clean.napsPerDay.mean);
  });

  it('lets no running sleep near a mean', () => {
    const clean = computeStats(normalDay(13), week, T0);
    const withOpen = computeStats([...normalDay(13), entry('nap', local(15, 11, 30), null)], week, T0);
    expect(withOpen.napPerDay.mean).toBe(clean.napPerDay.mean);
    expect(withOpen.napPerDay.n).toBe(clean.napPerDay.n);
  });

  it('averages bedtimes around midnight correctly', () => {
    const entries = [
      entry('night', local(12, 23, 50), local(13, 7)),
      entry('night', local(14, 0, 10), local(14, 7)), // 00:10, attributed to the 13th
    ];
    const stats = computeStats(entries, week, T0);
    expect(stats.bedtime.n).toBe(2);
    expect(stats.bedtime.mean).toBeCloseTo(0, 6);
  });

  it('reports wake-up time from the night’s end', () => {
    const stats = computeStats([entry('night', local(13, 20), local(14, 6, 30))], week, T0);
    expect(stats.wakeTime.mean).toBeCloseTo(6 * 60 + 30, 6);
  });

  it('reads the first nap separately from all naps', () => {
    // 09:00 and 15:00 average to noon, an hour at which no nap ever began.
    const entries = [
      entry('nap', local(13, 9), local(13, 10)),
      entry('nap', local(13, 15), local(13, 16)),
    ];
    const stats = computeStats(entries, week, T0);
    expect(stats.firstNapStart.mean).toBeCloseTo(9 * 60, 6);
    expect(stats.napStart.mean).toBeCloseTo(12 * 60, 6);
  });

  it('ignores entries outside the window', () => {
    const stats = computeStats(normalDay(1), week, T0);
    expect(stats.nightPerDay.n).toBe(0);
  });

  it('ignores deleted entries', () => {
    const entries = normalDay(13).map((e) => ({ ...e, deleted: true }));
    expect(computeStats(entries, week, T0).nightPerDay.n).toBe(0);
  });
});

describe('chart points', () => {
  const days = groupByDay([...normalDay(12), ...normalDay(13)], week, T0);

  it('gives one bedtime and one wake-up per night, tagged with its day', () => {
    expect(bedtimePoints(days)).toEqual([
      { at: local(12, 0), minutes: 20 * 60 },
      { at: local(13, 0), minutes: 20 * 60 },
    ]);
    expect(wakePoints(days).map((p) => p.minutes)).toEqual([6 * 60, 6 * 60]);
  });

  it('gives one first-nap point per day that had a nap', () => {
    expect(firstNapPoints(days).map((p) => p.minutes)).toEqual([9 * 60, 9 * 60]);
  });

  it('has no points for days without closed sleep', () => {
    expect(bedtimePoints(groupByDay([], week, T0))).toEqual([]);
    expect(firstNapPoints(groupByDay([], week, T0))).toEqual([]);
  });
});
