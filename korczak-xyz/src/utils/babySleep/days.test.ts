import { describe, expect, it } from 'vitest';

import {
  addDays,
  clipSegment,
  dayKeyAt,
  dayStart,
  eachDay,
  endOfDay,
  groupByDay,
  groupHistory,
  minutesOfDay,
  resolveWindow,
  segmentsForDay,
  sleepDayKey,
  startOfDay,
} from './days';
import type { SleepEntry, SleepKind } from './types';

/** Midday local, so no test accidentally depends on which side of midnight the fixture sits. */
const T0 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();

const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

let seq = 0;
function entry(kind: SleepKind, start: number, end: number | null): SleepEntry {
  seq += 1;
  return { id: `e${seq}`, kind, start, end, rev: 0, updatedAt: start, writerId: 'w' };
}

describe('sleepDayKey', () => {
  it('files a nap under the date it started on', () => {
    expect(sleepDayKey(local(2026, 1, 15, 9, 30), 'nap')).toBe('2026-01-15');
    expect(sleepDayKey(local(2026, 1, 15, 15, 0), 'nap')).toBe('2026-01-15');
  });

  it('files an evening bedtime under that evening', () => {
    expect(sleepDayKey(local(2026, 1, 15, 23, 30), 'night')).toBe('2026-01-15');
  });

  it('files a bedtime past midnight under the evening it belongs to', () => {
    expect(sleepDayKey(local(2026, 1, 16, 0, 30), 'night')).toBe('2026-01-15');
    expect(sleepDayKey(local(2026, 1, 16, 5, 59), 'night')).toBe('2026-01-15');
  });

  it('stops rolling back at the cutoff', () => {
    expect(sleepDayKey(local(2026, 1, 16, 6, 0), 'night')).toBe('2026-01-16');
  });

  it('does not apply the night rule to naps — the asymmetry is deliberate', () => {
    // A 5am nap and a 5am night are one minute of intent apart and land on different days. That is
    // the point: shifting naps back too would file the 9am nap, the commonest one, under yesterday.
    expect(sleepDayKey(local(2026, 1, 16, 5, 0), 'nap')).toBe('2026-01-16');
    expect(sleepDayKey(local(2026, 1, 16, 5, 0), 'night')).toBe('2026-01-15');
  });
});

describe('day boundaries across DST', () => {
  // Poland springs forward on the last Sunday of March and falls back on the last Sunday of October.
  const springForward = local(2026, 3, 29, 12);
  const fallBack = local(2026, 10, 25, 12);
  const HOUR = 3_600_000;

  it('knows a spring-forward day is 23 hours long', () => {
    const len = endOfDay(springForward) - startOfDay(springForward);
    // Skipped where the test machine has no DST; where it does, the day must be short.
    expect([23 * HOUR, 24 * HOUR]).toContain(len);
  });

  it('knows a fall-back day is 25 hours long', () => {
    const len = endOfDay(fallBack) - startOfDay(fallBack);
    expect([25 * HOUR, 24 * HOUR]).toContain(len);
  });

  it('steps day by day without repeating or skipping one over a changeover', () => {
    const from = local(2026, 3, 27);
    const to = local(2026, 4, 1);
    const days = eachDay(from, to);
    expect(days.map(dayKeyAt)).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
  });

  it('lands every step exactly on local midnight', () => {
    for (const at of eachDay(local(2026, 10, 23), local(2026, 10, 28))) {
      expect(new Date(at).getHours()).toBe(0);
      expect(new Date(at).getMinutes()).toBe(0);
    }
  });
});

describe('dayStart / dayKeyAt / addDays', () => {
  it('round-trips a key through its midnight', () => {
    expect(dayKeyAt(dayStart('2026-02-28'))).toBe('2026-02-28');
  });

  it('rejects a key that is not a date', () => {
    expect(Number.isNaN(dayStart('not-a-date'))).toBe(true);
    expect(Number.isNaN(dayStart(''))).toBe(true);
  });

  it('crosses a month and a year boundary', () => {
    expect(dayKeyAt(addDays(local(2026, 1, 1), -1))).toBe('2025-12-31');
    expect(dayKeyAt(addDays(local(2024, 2, 28), 1))).toBe('2024-02-29'); // leap year
  });
});

describe('minutesOfDay', () => {
  it('counts minutes after local midnight', () => {
    expect(minutesOfDay(local(2026, 1, 15, 0, 0))).toBe(0);
    expect(minutesOfDay(local(2026, 1, 15, 21, 30))).toBe(21 * 60 + 30);
    expect(minutesOfDay(local(2026, 1, 15, 23, 59))).toBe(1439);
  });
});

describe('resolveWindow', () => {
  it('counts whole days ending with today', () => {
    const w = resolveWindow('3d', T0);
    expect(dayKeyAt(w.from)).toBe('2026-01-13');
    expect(w.to).toBe(local(2026, 1, 16));
    expect(eachDay(w.from, w.to)).toHaveLength(3);
  });

  it('gives a week seven days and a month thirty', () => {
    const week = resolveWindow('7d', T0);
    const month = resolveWindow('30d', T0);
    expect(eachDay(week.from, week.to)).toHaveLength(7);
    expect(eachDay(month.from, month.to)).toHaveLength(30);
  });

  it('includes both dates a custom range names', () => {
    const w = resolveWindow('custom', T0, { from: '2026-01-10', to: '2026-01-12' });
    expect(w.from).toBe(local(2026, 1, 10));
    expect(w.to).toBe(local(2026, 1, 13));
    expect(eachDay(w.from, w.to)).toHaveLength(3);
  });

  it('accepts a custom range given backwards', () => {
    const a = resolveWindow('custom', T0, { from: '2026-01-12', to: '2026-01-10' });
    const b = resolveWindow('custom', T0, { from: '2026-01-10', to: '2026-01-12' });
    expect(a).toEqual(b);
  });

  it('falls back to a week when a custom range is incomplete', () => {
    expect(resolveWindow('custom', T0, { from: '', to: '' })).toEqual(resolveWindow('7d', T0));
    expect(resolveWindow('custom', T0)).toEqual(resolveWindow('7d', T0));
  });
});

describe('eachDay', () => {
  it('refuses to enumerate an absurd range forever', () => {
    expect(eachDay(local(1970, 1, 1), T0).length).toBe(400);
  });
});

describe('clipSegment', () => {
  const from = local(2026, 1, 15);
  const to = local(2026, 1, 16);

  it('passes a sleep wholly inside the day through', () => {
    const s = clipSegment(local(2026, 1, 15, 13), local(2026, 1, 15, 14, 30), from, to);
    expect(s).toEqual({ start: local(2026, 1, 15, 13), end: local(2026, 1, 15, 14, 30) });
  });

  it('cuts a night at midnight, and the two rows sum to the whole block', () => {
    const start = local(2026, 1, 15, 21, 40);
    const end = local(2026, 1, 16, 6, 15);
    const first = clipSegment(start, end, from, to);
    const second = clipSegment(start, end, to, addDays(to, 1));
    expect(first).toEqual({ start, end: to });
    expect(second).toEqual({ start: to, end });
    const drawn =
      (first as { start: number; end: number }).end -
      (first as { start: number; end: number }).start +
      ((second as { start: number; end: number }).end - (second as { start: number; end: number }).start);
    expect(drawn).toBe(end - start);
  });

  it('has nothing to draw for a day the sleep misses', () => {
    expect(clipSegment(local(2026, 1, 10, 13), local(2026, 1, 10, 14), from, to)).toBeNull();
  });

  it('treats a sleep that merely touches the boundary as absent', () => {
    expect(clipSegment(local(2026, 1, 14, 22), from, from, to)).toBeNull();
  });

  it('covers the whole row for a sleep spanning it entirely', () => {
    const s = clipSegment(local(2026, 1, 14), local(2026, 1, 20), from, to);
    expect(s).toEqual({ start: from, end: to });
  });
});

describe('segmentsForDay', () => {
  // The 14th and the 15th, so every fixture sits before T0 (midday on the 15th) and is therefore
  // believable — an entry starting in the future is not.
  const day = { start: local(2026, 1, 14), end: local(2026, 1, 15) };
  const nextDay = { start: local(2026, 1, 15), end: local(2026, 1, 16) };

  it('draws a night on both rows it crosses, not only the one it belongs to', () => {
    // The bug this exists to prevent: `groupByDay` attributes a night to the evening it began on and
    // to no other, so a row asking only for its attributed entries drew half of every night.
    const night = entry('night', local(2026, 1, 14, 20, 40), local(2026, 1, 15, 6, 30));
    const first = segmentsForDay([night], day, T0);
    const second = segmentsForDay([night], nextDay, T0);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].entry.id).toBe(second[0].entry.id);
  });

  it('splits the night without losing or double-counting a minute', () => {
    const start = local(2026, 1, 14, 20, 40);
    const end = local(2026, 1, 15, 6, 30);
    const night = entry('night', start, end);
    const drawn =
      segmentsForDay([night], day, T0).reduce((n, s) => n + (s.end - s.start), 0) +
      segmentsForDay([night], nextDay, T0).reduce((n, s) => n + (s.end - s.start), 0);
    expect(drawn).toBe(end - start);
  });

  it('says which side a piece continues on, so neither half reads as a whole sleep', () => {
    const night = entry('night', local(2026, 1, 14, 20, 40), local(2026, 1, 15, 6, 30));
    expect(segmentsForDay([night], day, T0)[0]).toMatchObject({
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(segmentsForDay([night], nextDay, T0)[0]).toMatchObject({
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('marks a sleep contained in one row as continuing nowhere', () => {
    const nap = entry('nap', local(2026, 1, 14, 13), local(2026, 1, 14, 14));
    expect(segmentsForDay([nap], day, T0)[0]).toMatchObject({
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it('draws a running sleep up to now', () => {
    const running = entry('nap', local(2026, 1, 15, 11, 30), null);
    const [seg] = segmentsForDay([running], nextDay, T0);
    expect(seg.end).toBe(T0);
  });

  it('refuses to smear a forgotten timer across the chart', () => {
    const forgotten = entry('nap', local(2026, 1, 14, 9), local(2026, 1, 15, 4));
    expect(segmentsForDay([forgotten], day, T0)).toEqual([]);
    expect(segmentsForDay([forgotten], nextDay, T0)).toEqual([]);
  });

  it('ignores a deleted entry and one that misses the row', () => {
    const gone = { ...entry('nap', local(2026, 1, 14, 13), local(2026, 1, 14, 14)), deleted: true };
    const elsewhere = entry('nap', local(2026, 1, 10, 13), local(2026, 1, 10, 14));
    expect(segmentsForDay([gone, elsewhere], day, T0)).toEqual([]);
  });

  it('returns a row’s pieces in the order they happened', () => {
    const entries = [
      entry('night', local(2026, 1, 14, 20), local(2026, 1, 15, 6)),
      entry('nap', local(2026, 1, 14, 13), local(2026, 1, 14, 14)),
      entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10)),
    ];
    expect(segmentsForDay(entries, day, T0).map((s) => s.start)).toEqual([
      local(2026, 1, 14, 9),
      local(2026, 1, 14, 13),
      local(2026, 1, 14, 20),
    ]);
  });
});

describe('groupByDay', () => {
  const window = { from: local(2026, 1, 13), to: local(2026, 1, 16) };

  it('returns every day in the window, gaps included', () => {
    const days = groupByDay([], window, T0);
    expect(days.map((d) => d.key)).toEqual(['2026-01-13', '2026-01-14', '2026-01-15']);
    expect(days.every((d) => d.nightMs === null && d.napMs === 0)).toBe(true);
  });

  it('adds up a day of naps and its night', () => {
    const entries = [
      entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10, 30)),
      entry('nap', local(2026, 1, 14, 13), local(2026, 1, 14, 14)),
      entry('night', local(2026, 1, 14, 20), local(2026, 1, 15, 6)),
    ];
    const day = groupByDay(entries, window, T0).find((d) => d.key === '2026-01-14');
    expect(day?.naps).toBe(2);
    expect(day?.napMs).toBe(150 * 60_000);
    expect(day?.nightMs).toBe(10 * 3_600_000);
  });

  it('leaves nightMs null on a day with naps but no closed night', () => {
    const day = groupByDay(
      [entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10))],
      window,
      T0
    ).find((d) => d.key === '2026-01-14');
    expect(day?.nightMs).toBeNull();
    expect(day?.napMs).toBe(3_600_000);
  });

  it('draws a running sleep but counts nothing for it', () => {
    const running = entry('nap', local(2026, 1, 15, 11, 30), null);
    const day = groupByDay([running], window, T0).find((d) => d.key === '2026-01-15');
    expect(day?.entries).toHaveLength(1);
    expect(day?.naps).toBe(0);
    expect(day?.napMs).toBe(0);
  });

  it('ignores a forgotten timer entirely — an implausible entry reaches no total', () => {
    const forgotten = entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 23));
    const day = groupByDay([forgotten], window, T0).find((d) => d.key === '2026-01-14');
    expect(day?.entries).toHaveLength(0);
    expect(day?.napMs).toBe(0);
  });

  it('ignores a deleted entry', () => {
    const gone = { ...entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10)), deleted: true };
    const day = groupByDay([gone], window, T0).find((d) => d.key === '2026-01-14');
    expect(day?.napMs).toBe(0);
  });

  it('drops an entry outside the window', () => {
    const days = groupByDay([entry('nap', local(2026, 1, 1, 9), local(2026, 1, 1, 10))], window, T0);
    expect(days.every((d) => d.napMs === 0)).toBe(true);
  });

  it('attributes a bedtime past midnight to the evening before', () => {
    const late = entry('night', local(2026, 1, 15, 0, 30), local(2026, 1, 15, 7, 30));
    const days = groupByDay([late], window, T0);
    expect(days.find((d) => d.key === '2026-01-14')?.nightMs).toBe(7 * 3_600_000);
    expect(days.find((d) => d.key === '2026-01-15')?.nightMs).toBeNull();
  });

  it('marks the day still in progress as partial and the finished ones as not', () => {
    const days = groupByDay([], window, T0);
    expect(days.find((d) => d.key === '2026-01-15')?.partial).toBe(true);
    expect(days.find((d) => d.key === '2026-01-14')?.partial).toBe(false);
  });

  it('orders a day’s entries as they happened', () => {
    const entries = [
      entry('night', local(2026, 1, 14, 20), local(2026, 1, 15, 6)),
      entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10)),
    ];
    const day = groupByDay(entries, window, T0).find((d) => d.key === '2026-01-14');
    expect(day?.entries.map((e) => e.kind)).toEqual(['nap', 'night']);
  });
});

describe('groupHistory', () => {
  it('lists a day that holds only a routine', () => {
    // The bug this exists to prevent: grouped by the entries alone, a day with a routine and no
    // sleep had no heading at all, so its routine rows were never drawn and the record — stored and
    // synced — could not be reached. Logging a nap first was the only way in.
    const groups = groupHistory([], ['2026-01-14']);
    expect(groups.map((g) => g.key)).toEqual(['2026-01-14']);
    expect(groups[0].entries).toEqual([]);
    expect(groups[0].at).toBe(local(2026, 1, 14));
  });

  it('does not duplicate a day that holds both', () => {
    const nap = entry('nap', local(2026, 1, 14, 9), local(2026, 1, 14, 10));
    const groups = groupHistory([nap], ['2026-01-14']);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toEqual([nap]);
  });

  it('keeps every day newest first, routine-only days among them', () => {
    const entries = [
      entry('nap', local(2026, 1, 13, 9), local(2026, 1, 13, 10)),
      entry('night', local(2026, 1, 15, 20), local(2026, 1, 16, 6)),
    ];
    const groups = groupHistory(entries, ['2026-01-14', '2026-01-13']);
    expect(groups.map((g) => g.key)).toEqual(['2026-01-15', '2026-01-14', '2026-01-13']);
  });

  it('files a bedtime past midnight under the evening it began', () => {
    // `dayKeyOf`'s rule, so the list and the charts cannot disagree about which night is which.
    const late = entry('night', local(2026, 1, 15, 0, 30), local(2026, 1, 15, 7));
    expect(groupHistory([late], []).map((g) => g.key)).toEqual(['2026-01-14']);
  });
});
