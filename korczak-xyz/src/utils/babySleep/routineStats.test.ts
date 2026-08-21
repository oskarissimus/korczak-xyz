import { describe, expect, it } from 'vitest';

import { groupByDay } from './days';
import type { RoutineRecord } from './routine';
import { MAX_SETTLE_MS } from './routine';
import {
  applyLocalRoutines,
  computeRoutineStats,
  firstNightBlockStart,
  mergeRoutines,
  routineLengthPoints,
  routineStartPoints,
  routinesByNight,
  settleMs,
  settlePoints,
  visibleRoutines,
} from './routineStats';
import type { SleepEntry, TimeWindow } from './types';

const NIGHT = '2026-01-15';
const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m, 0, 0).getTime();

// Late on the 16th: the 15th is over and settled, and tonight's routine is already in the past.
const NOW = at(16, 20, 30);
const WINDOW: TimeWindow = { from: at(13, 0), to: at(17, 0) };

function routine(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return {
    id: NIGHT,
    night: NIGHT,
    start: at(15, 19, 0),
    end: at(15, 19, 25),
    rev: 0,
    updatedAt: at(15, 19, 25),
    writerId: 'a',
    ...overrides,
  };
}

function night(start: number, end: number | null, id = 'n1'): SleepEntry {
  return { id, kind: 'night', start, end, rev: 0, updatedAt: start, writerId: 'a' };
}

const days = (entries: SleepEntry[]) => groupByDay(entries, WINDOW, NOW);
const dayFor = (entries: SleepEntry[], key: string) =>
  days(entries).find((d) => d.key === key)!;

describe('firstNightBlockStart', () => {
  it('is the earliest night block, however the entries arrive', () => {
    const blocks = [
      night(at(15, 3, 0), at(16, 6, 30), 'b'),
      night(at(15, 19, 45), at(16, 2, 40), 'a'),
    ];
    expect(firstNightBlockStart(dayFor(blocks, NIGHT))).toBe(at(15, 19, 45));
  });

  it('is known while the night is still running — it does not go through nightBlocks', () => {
    const running = [night(at(16, 19, 45), null)];
    expect(firstNightBlockStart(dayFor(running, '2026-01-16'))).toBe(at(16, 19, 45));
  });

  it('is null on a day with only naps', () => {
    const nap: SleepEntry = {
      id: 'p', kind: 'nap', start: at(15, 9), end: at(15, 10), rev: 0, updatedAt: 0, writerId: 'a',
    };
    expect(firstNightBlockStart(dayFor([nap], NIGHT))).toBeNull();
  });
});

describe('settleMs', () => {
  const asleep = at(15, 19, 45);

  it('measures from the crib to sleep', () => {
    expect(settleMs(routine(), asleep)).toBe(20 * 60_000);
  });

  it('is null while the routine is still running', () => {
    expect(settleMs(routine({ end: null }), asleep)).toBeNull();
  });

  it('is null when no night has begun', () => {
    expect(settleMs(routine(), null)).toBeNull();
  });

  it('excludes an impossible gap rather than clamping it to zero', () => {
    expect(settleMs(routine({ end: at(15, 20, 0) }), asleep)).toBeNull();
  });

  it('excludes a gap past believing', () => {
    expect(settleMs(routine(), routine().end! + MAX_SETTLE_MS + 60_000)).toBeNull();
  });

  it('counts an instant settling as a real zero', () => {
    expect(settleMs(routine(), routine().end!)).toBe(0);
  });
});

describe('the points', () => {
  const entries = [night(at(15, 19, 45), at(16, 6, 30))];

  it('pair each figure with its day', () => {
    const byNight = routinesByNight([routine()]);
    const bucket = dayFor(entries, NIGHT);
    expect(settlePoints(days(entries), byNight)).toEqual([
      { at: bucket.start, ms: 20 * 60_000 },
    ]);
    expect(routineLengthPoints(days(entries), byNight)).toEqual([
      { at: bucket.start, ms: 25 * 60_000 },
    ]);
    expect(routineStartPoints(days(entries), byNight)).toEqual([
      { at: bucket.start, minutes: 19 * 60 },
    ]);
  });

  it('include tonight: a settling is complete the moment he falls asleep', () => {
    // The 16th is still in progress, and its night is still running.
    const tonight = routine({ id: '2026-01-16', night: '2026-01-16', start: at(16, 19, 0), end: at(16, 19, 20) });
    const running = [night(at(16, 19, 40), null, 'tonight')];
    const points = settlePoints(days(running), routinesByNight([tonight]));
    expect(points).toEqual([{ at: at(16, 0), ms: 20 * 60_000 }]);
  });

  it('give a routine with no night a length but no settling', () => {
    const byNight = routinesByNight([routine()]);
    expect(routineLengthPoints(days([]), byNight)).toHaveLength(1);
    expect(routineStartPoints(days([]), byNight)).toHaveLength(1);
    expect(settlePoints(days([]), byNight)).toHaveLength(0);
  });

  it('give an unfinished routine a start but no length', () => {
    const byNight = routinesByNight([routine({ end: null })]);
    expect(routineStartPoints(days(entries), byNight)).toHaveLength(1);
    expect(routineLengthPoints(days(entries), byNight)).toHaveLength(0);
    expect(settlePoints(days(entries), byNight)).toHaveLength(0);
  });

  it('ignore a tombstoned routine', () => {
    const byNight = routinesByNight([routine({ deleted: true })]);
    expect(routineStartPoints(days(entries), byNight)).toHaveLength(0);
  });
});

describe('computeRoutineStats', () => {
  it('averages each figure over the nights that have it', () => {
    const entries = [
      night(at(14, 19, 40), at(15, 6, 30), 'a'),
      night(at(15, 19, 45), at(16, 6, 30), 'b'),
    ];
    const records = [
      routine({ id: '2026-01-14', night: '2026-01-14', start: at(14, 19, 0), end: at(14, 19, 20) }),
      routine(),
    ];
    const stats = computeRoutineStats(days(entries), records);
    expect(stats.settle.n).toBe(2);
    expect(stats.settle.mean).toBe(20 * 60_000);
    expect(stats.routineLength.n).toBe(2);
    expect(stats.routineLength.mean).toBe(22.5 * 60_000);
    expect(stats.routineStart.n).toBe(2);
    expect(stats.routineStart.mean).toBeCloseTo(19 * 60, 6);
  });

  it('reports nothing rather than zero when there are no routines', () => {
    const stats = computeRoutineStats(days([]), []);
    expect(stats.settle).toEqual({ mean: null, sd: null, n: 0 });
    expect(stats.routineLength.n).toBe(0);
    expect(stats.routineStart.n).toBe(0);
  });
});

describe('mergeRoutines', () => {
  it('unions by night and lets the higher rev win', () => {
    const mine = routine({ end: null });
    const theirs = routine({ rev: 1, end: at(15, 19, 30), writerId: 'b' });
    const merged = mergeRoutines([mine], [theirs]);
    expect(merged.records).toEqual([theirs]);
    expect(merged.changed).toBe(true);
    expect(merged.localWins).toEqual([]);
  });

  it('does not re-upload a record the cloud already holds identically', () => {
    expect(mergeRoutines([routine()], [routine()]).localWins).toEqual([]);
  });

  it('names a local-only night as something to push', () => {
    expect(mergeRoutines([routine()], []).localWins).toEqual([NIGHT]);
  });

  it('lets a delete absorb a concurrent edit', () => {
    const gone = routine({ deleted: true, rev: 1 });
    const edited = routine({ rev: 1, end: at(15, 19, 30) });
    expect(mergeRoutines([edited], [gone]).records[0].deleted).toBe(true);
    expect(mergeRoutines([gone], [edited]).records[0].deleted).toBe(true);
  });

  it('hides tombstones from the UI', () => {
    expect(visibleRoutines([routine({ deleted: true })])).toEqual([]);
  });
});

describe('applyLocalRoutines', () => {
  /*
   * The bug this exists for. A routine is keyed on its night, so re-logging a night that was once
   * deleted mints the *same id* as its tombstone. Routed through `mergeRoutines`, the absorbing
   * delete swallowed the new record and kept the tombstone — no error, nothing saved, and the night
   * unloggable forever, since every retry meets the same tombstone again.
   */
  it('lets a re-logged night overwrite its own tombstone', () => {
    const gone = routine({ deleted: true, rev: 5 });
    const back = routine({ rev: 6, start: at(15, 18, 50), end: at(15, 19, 30) });
    const [record] = applyLocalRoutines([gone], [back]);
    expect(record.deleted).toBeUndefined();
    expect(record.start).toBe(at(15, 18, 50));
    expect(record.end).toBe(at(15, 19, 30));
  });

  it('still lets a local delete through', () => {
    const live = routine();
    const gone = routine({ deleted: true, rev: 1 });
    expect(applyLocalRoutines([live], [gone])[0].deleted).toBe(true);
  });

  it('adds a night it has never seen and leaves the others alone', () => {
    const other = routine({ id: '2026-01-14', night: '2026-01-14' });
    const records = applyLocalRoutines([other], [routine()]);
    expect(records.map((r) => r.id)).toEqual([NIGHT, '2026-01-14']);
  });
});
