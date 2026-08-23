import { describe, expect, it } from 'vitest';

import { groupByDay } from './days';
import type { RoutineRecord } from './routine';
import { MAX_ROUTINE_MS, MAX_SETTLE_MS } from './routine';
import {
  applyLocalRoutines,
  asleepByRoutine,
  asleepFor,
  computeRoutineStats,
  firstNightBlockStart,
  mergeRoutines,
  napRoutinesByDay,
  nightRoutinesByDay,
  routineLengthPoints,
  routineSegmentsForDay,
  routineStartPoints,
  routinesByDay,
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
    kind: 'night',
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

function nap(start: number, end: number | null, id = 'p1'): SleepEntry {
  return { id, kind: 'nap', start, end, rev: 0, updatedAt: start, writerId: 'a' };
}

/** A nap routine on the 15th: 12:00 to 12:20 in the crib. */
function napRoutine(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return routine({
    id: '2026-01-15-nap-1200',
    kind: 'nap',
    start: at(15, 12, 0),
    end: at(15, 12, 20),
    ...overrides,
  });
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

describe('asleepFor', () => {
  const blocks = [night(at(15, 19, 45), at(16, 2, 40), 'a'), night(at(16, 3, 10), at(16, 6, 30), 'b')];

  it('joins a night routine to the first block of its own night', () => {
    // Not the second: a waking at three in the morning starts an entry the routine had nothing to
    // do with. And not another night's — the join is by the routine's own key.
    expect(asleepFor(routine(), blocks)).toBe(at(15, 19, 45));
  });

  it('never lets a nap end a night routine\'s settling', () => {
    expect(asleepFor(routine(), [nap(at(15, 19, 40), at(15, 20, 30))])).toBeNull();
  });

  it('joins a nap routine to the next nap after the crib', () => {
    const naps = [nap(at(15, 9, 0), at(15, 10, 0), 'early'), nap(at(15, 12, 30), at(15, 13, 40))];
    expect(asleepFor(napRoutine(), naps)).toBe(at(15, 12, 30));
  });

  it('ignores a nap that was already over before the crib', () => {
    expect(asleepFor(napRoutine(), [nap(at(15, 9, 0), at(15, 10, 0))])).toBeNull();
  });

  it('ignores a nap too far past the crib to be what the routine led into', () => {
    // The routine's nap was never logged; the afternoon's is not it.
    const far = nap(napRoutine().end! + MAX_SETTLE_MS + 60_000, null);
    expect(asleepFor(napRoutine(), [far])).toBeNull();
  });

  it('has nothing to join while the routine is still running', () => {
    expect(asleepFor(napRoutine({ end: null }), [nap(at(15, 12, 30), null)])).toBeNull();
  });

  it('is what `asleepByRoutine` keys by id, so two routines of one day stay apart', () => {
    const entries = [...blocks, nap(at(15, 12, 30), at(15, 13, 40))];
    const asleep = asleepByRoutine(days(entries), [routine(), napRoutine()]);
    expect(asleep.get(NIGHT)).toBe(at(15, 19, 45));
    expect(asleep.get('2026-01-15-nap-1200')).toBe(at(15, 12, 30));
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
    const byNight = nightRoutinesByDay([routine()]);
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
    const points = settlePoints(days(running), nightRoutinesByDay([tonight]));
    expect(points).toEqual([{ at: at(16, 0), ms: 20 * 60_000 }]);
  });

  it('give a routine with no night a length but no settling', () => {
    const byNight = nightRoutinesByDay([routine()]);
    expect(routineLengthPoints(days([]), byNight)).toHaveLength(1);
    expect(routineStartPoints(days([]), byNight)).toHaveLength(1);
    expect(settlePoints(days([]), byNight)).toHaveLength(0);
  });

  it('give an unfinished routine a start but no length', () => {
    const byNight = nightRoutinesByDay([routine({ end: null })]);
    expect(routineStartPoints(days(entries), byNight)).toHaveLength(1);
    expect(routineLengthPoints(days(entries), byNight)).toHaveLength(0);
    expect(settlePoints(days(entries), byNight)).toHaveLength(0);
  });

  it('ignore a tombstoned routine', () => {
    const byNight = nightRoutinesByDay([routine({ deleted: true })]);
    expect(routineStartPoints(days(entries), byNight)).toHaveLength(0);
  });
});

describe('routineSegmentsForDay', () => {
  const dayOf = (key: string, entries: SleepEntry[] = []) => days(entries).find((d) => d.key === key)!;
  const NONE = new Map<string, number>();

  it('draws a routine on the row holding the clock time, not the row it is keyed to', () => {
    // Begun at 00:10, so `routineNightKey` files it under the 15th — but it happened on the 16th.
    const late = routine({
      id: NIGHT,
      night: NIGHT,
      start: at(16, 0, 10),
      end: at(16, 0, 40),
    });
    expect(routineSegmentsForDay([late], NONE, dayOf(NIGHT), NOW)).toEqual([]);
    expect(routineSegmentsForDay([late], NONE, dayOf('2026-01-16'), NOW)).toEqual([
      {
        routine: late,
        phase: 'routine',
        start: at(16, 0, 10),
        end: at(16, 0, 40),
        running: false,
        endsHere: true,
      },
    ]);
  });

  it('clips a routine that crosses midnight, and ticks the crib only where it falls', () => {
    const across = routine({ start: at(15, 23, 50), end: at(16, 0, 20) });
    const [before] = routineSegmentsForDay([across], NONE, dayOf(NIGHT), NOW);
    const [after] = routineSegmentsForDay([across], NONE, dayOf('2026-01-16'), NOW);
    expect(before).toMatchObject({ start: at(15, 23, 50), end: at(16, 0), endsHere: false });
    expect(after).toMatchObject({ start: at(16, 0), end: at(16, 0, 20), endsHere: true });
  });

  it('draws a running routine as far as now, with no crib to mark', () => {
    const running = routine({ start: NOW - 15 * 60_000, end: null });
    expect(routineSegmentsForDay([running], NONE, dayOf('2026-01-16'), NOW)).toEqual([
      {
        routine: running,
        phase: 'routine',
        start: NOW - 15 * 60_000,
        end: NOW,
        running: true,
        endsHere: false,
      },
    ]);
  });

  it('carries the settling on from the crib to the moment the night began', () => {
    const entries = [night(at(15, 19, 45), at(16, 6, 30))];
    const asleep = asleepByRoutine(days(entries), [routine()]);
    const segments = routineSegmentsForDay([routine()], asleep, dayOf(NIGHT, entries), NOW);
    expect(segments.map((s) => [s.phase, s.start, s.end, s.running, s.endsHere])).toEqual([
      ['routine', at(15, 19, 0), at(15, 19, 25), false, true],
      ['settle', at(15, 19, 25), at(15, 19, 45), false, false],
    ]);
  });

  it('draws a nap routine and the settling before its nap', () => {
    const entries = [nap(at(15, 12, 30), at(15, 13, 40))];
    const record = napRoutine();
    const asleep = asleepByRoutine(days(entries), [record]);
    const segments = routineSegmentsForDay([record], asleep, dayOf(NIGHT), NOW);
    expect(segments.map((s) => [s.phase, s.start, s.end, s.endsHere])).toEqual([
      ['routine', at(15, 12, 0), at(15, 12, 20), true],
      ['settle', at(15, 12, 20), at(15, 12, 30), false],
    ]);
  });

  it('runs the settling to now while nobody has fallen asleep yet', () => {
    // In the crib twenty minutes ago, and tonight's night entry has not been tapped.
    const tonight = routine({
      id: '2026-01-16',
      night: '2026-01-16',
      start: NOW - 45 * 60_000,
      end: NOW - 20 * 60_000,
    });
    const [, settling] = routineSegmentsForDay([tonight], NONE, dayOf('2026-01-16'), NOW);
    expect(settling).toMatchObject({
      phase: 'settle',
      start: NOW - 20 * 60_000,
      end: NOW,
      running: true,
    });
  });

  it('draws no settling where the figure would be excluded', () => {
    const day = dayOf(NIGHT);
    const phases = (records: RoutineRecord[], asleep: Map<string, number>) =>
      routineSegmentsForDay(records, asleep, day, NOW).map((s) => s.phase);

    // He was already asleep when the crib was logged: a mis-log, not a settling of zero.
    const backwards = [night(at(15, 19, 0), at(16, 6, 0))];
    expect(phases([routine()], asleepByRoutine(days(backwards), [routine()]))).toEqual(['routine']);

    // A night that never got logged, an evening old: the four-hour ceiling stops the band smearing.
    expect(phases([routine()], NONE)).toEqual(['routine']);

    // Past the ceiling in the other direction — asleep six hours after the crib.
    const late = [night(at(16, 1, 30), at(16, 6, 0))];
    expect(phases([routine()], asleepByRoutine(days(late), [routine()]))).toEqual(['routine']);
  });

  it('leaves out what no figure counts: a tombstone, a stale timer, an impossible length', () => {
    const day = dayOf(NIGHT);
    expect(routineSegmentsForDay([routine({ deleted: true })], NONE, day, NOW)).toEqual([]);
    // Started yesterday evening and never closed: the forgotten-timer case.
    expect(routineSegmentsForDay([routine({ end: null })], NONE, day, NOW)).toEqual([]);
    expect(
      routineSegmentsForDay(
        [routine({ end: at(15, 19, 0) + MAX_ROUTINE_MS + 60_000 })],
        NONE,
        day,
        NOW
      )
    ).toEqual([]);
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

  it('leaves the nap routines out entirely — the figures are about bedtime', () => {
    // The whole of "timeline only": a day's nap routines may not move a tile, and the guard is that
    // the same day with and without them comes out identical.
    const entries = [night(at(15, 19, 45), at(16, 6, 30)), nap(at(15, 12, 30), at(15, 13, 40))];
    const naps = [
      napRoutine(),
      napRoutine({ id: '2026-01-15-nap-1530', start: at(15, 15, 30), end: at(15, 15, 50) }),
    ];
    expect(computeRoutineStats(days(entries), [routine(), ...naps])).toEqual(
      computeRoutineStats(days(entries), [routine()])
    );
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
