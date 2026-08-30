import { describe, expect, it } from 'vitest';

import { movingAverage, AVERAGE_WINDOW } from './movingAverage';
import type { DurationPoint } from './stats';

const HOUR = 3_600_000;

/** Local midnight of the nth day of January 2026 — the shape `groupByDay` produces. */
const at = (d: number) => new Date(2026, 0, d, 0, 0, 0, 0).getTime();

const nights = (hours: number[], startDay = 1): DurationPoint[] =>
  hours.map((h, i) => ({ at: at(startDay + i), ms: h * HOUR }));

describe('movingAverage', () => {
  it('gives nothing until the window is full', () => {
    const six = nights([10, 10, 10, 10, 10, 10]);
    expect(movingAverage(six, 7)).toEqual([]);
    expect(movingAverage([], 7)).toEqual([]);
  });

  it('starts at the last night of the first full window', () => {
    const week = nights([9, 10, 11, 10, 9, 12, 12]);
    const avg = movingAverage(week, 7);

    expect(avg).toHaveLength(1);
    // The point is filed under night seven, not night four: it is a trailing mean, so the line ends
    // at the newest dot rather than three days short of it.
    expect(avg[0].at).toBe(at(7));
    expect(avg[0].ms).toBeCloseTo(((9 + 10 + 11 + 10 + 9 + 12 + 12) / 7) * HOUR, 6);
  });

  it('gives one point per night from there on, each over its own last seven', () => {
    const nine = nights([8, 8, 8, 8, 8, 8, 8, 15, 15]);
    const avg = movingAverage(nine, 7);

    expect(avg.map((p) => p.at)).toEqual([at(7), at(8), at(9)]);
    expect(avg[0].ms).toBeCloseTo(8 * HOUR, 6);
    expect(avg[1].ms).toBeCloseTo(((8 * 6 + 15) / 7) * HOUR, 6);
    expect(avg[2].ms).toBeCloseTo(((8 * 5 + 15 * 2) / 7) * HOUR, 6);
  });

  /*
   * The window counts nights, not days. A week away from the log leaves a gap in `at`, and the
   * average must go on averaging the same seven readings across it — reading the gap as seven nights
   * of nothing would draw a collapse that never happened.
   */
  it('counts logged nights, not calendar days', () => {
    const gapped: DurationPoint[] = [
      ...nights([10, 10, 10]),
      ...nights([10, 10, 10, 10], 20),
    ];
    const avg = movingAverage(gapped, 7);

    expect(avg).toHaveLength(1);
    expect(avg[0].at).toBe(at(23));
    expect(avg[0].ms).toBeCloseTo(10 * HOUR, 6);
  });

  it('is the identity at a window of one', () => {
    const three = nights([9, 10, 11]);
    expect(movingAverage(three, 1)).toEqual(three);
  });

  it('refuses a window that is not a positive whole number', () => {
    const ten = nights([9, 10, 11, 10, 9, 12, 12, 10, 10, 10]);
    expect(movingAverage(ten, 0)).toEqual([]);
    expect(movingAverage(ten, -3)).toEqual([]);
    expect(movingAverage(ten, 2.5)).toEqual([]);
  });

  /*
   * A rolling sum drifts where a fresh sum per window does not, and the drift is invisible: the line
   * simply stops matching the dots it is drawn through. Over a long window of large millisecond
   * values that is worth pinning rather than trusting.
   */
  it('agrees with a plain mean of each window', () => {
    const long = nights(
      Array.from({ length: 40 }, (_, i) => 8 + ((i * 7) % 11) / 3)
    );
    const avg = movingAverage(long, AVERAGE_WINDOW);

    expect(avg).toHaveLength(40 - AVERAGE_WINDOW + 1);
    avg.forEach((p, i) => {
      const window = long.slice(i, i + AVERAGE_WINDOW);
      const plain = window.reduce((sum, q) => sum + q.ms, 0) / AVERAGE_WINDOW;
      expect(p.ms).toBeCloseTo(plain, 6);
      expect(p.at).toBe(window[window.length - 1].at);
    });
  });

  it('leaves its input alone', () => {
    const week = nights([9, 10, 11, 10, 9, 12, 12]);
    const copy = week.map((p) => ({ ...p }));
    movingAverage(week, 7);
    expect(week).toEqual(copy);
  });
});
