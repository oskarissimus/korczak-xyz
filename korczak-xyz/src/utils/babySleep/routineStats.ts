/*
 * Reading the routines back against the sleeps they led into.
 *
 * Three figures come out of it, and they are three different questions:
 *
 *   - **routine length** — how long bath-to-crib actually takes, which is never what you think.
 *   - **time to fall asleep** — from the crib to sleep. The number this feature exists for: it is
 *     the part of the evening spent sitting beside him, and the one that moves.
 *   - **routine start** — a clock time, answering whether bedtime has been drifting later.
 *
 * Two rules here differ from `stats.ts`'s, and both are the kind that get quietly reversed later:
 *
 *   1. **Today is included.** These follow the clock-point rule, not the duration rule. A settling
 *      time is a complete fact the moment he falls asleep, so tonight's shows immediately;
 *      `nightDurationPoints` excludes partial days because a night's *length* needs the night to be
 *      over, and nothing here does.
 *   2. **The night's first block is read directly, never through `nightBlocks`.** That function
 *      returns null while any block is still running, which is right for a night's total and wrong
 *      here: only the first block's start is needed and it is known the instant the night begins.
 *      Going through `nightBlocks` would hide tonight's settling time until morning.
 *
 * Nothing here reads the clock, and nothing is silently clamped: an impossible settling — a routine
 * logged as ending after he was already asleep — is excluded rather than pinned to zero, because a
 * fabricated zero is worse than a gap.
 *
 * **The three figures stay night-only.** A nap routine is logged, synced and drawn on the timeline,
 * and contributes to no tile and no chart: "does bedtime drift later" is a question about bedtime,
 * and pooling a twelve-minute nap settling with a forty-minute evening one would answer neither. So
 * the point extractors read `nightRoutinesByDay` rather than every routine of the day.
 */

import { circularStat, linearStat } from './circular';
import { clipSegment, dayKeyOf, minutesOfDay } from './days';
import type { RoutineRecord } from './routine';
import {
  MAX_SETTLE_MS,
  isStaleRoutine,
  routineLength,
  routineStartMinutes,
} from './routine';
import type { ClockPoint, DurationPoint } from './stats';
import type { ClockStat, DayBucket, MeanStat, SleepEntry } from './types';
import { applyLocal, mergeById, sameRevision } from './versioned';

// --- merging ------------------------------------------------------------------------------------

function isSameVersion(a: RoutineRecord, b: RoutineRecord): boolean {
  return sameRevision(a, b) && a.start === b.start && a.end === b.end;
}

/** Newest night first, and deterministically so — the id tiebreak keeps the merge commutative. */
function byNightDesc(a: RoutineRecord, b: RoutineRecord): number {
  return b.night.localeCompare(a.night) || a.id.localeCompare(b.id);
}

export interface RoutineMergeResult {
  records: RoutineRecord[];
  changed: boolean;
  localWins: string[];
}

export function mergeRoutines(
  local: RoutineRecord[],
  remote: RoutineRecord[]
): RoutineMergeResult {
  return mergeById(local, remote, isSameVersion, byNightDesc);
}

/** This device's own write to a night's routine, applied to its own copy. */
export function applyLocalRoutines(
  records: RoutineRecord[],
  changed: RoutineRecord[]
): RoutineRecord[] {
  return applyLocal(records, changed, byNightDesc);
}

export function visibleRoutines(records: RoutineRecord[]): RoutineRecord[] {
  return records.filter((r) => !r.deleted).sort(byNightDesc);
}

/**
 * The live *night* routines by night key — what the point extractors and the night slot look up by.
 *
 * There is at most one, by construction: a night routine's id *is* its night key, so a second one
 * for the same evening is the same document.
 */
export function nightRoutinesByDay(records: RoutineRecord[]): Map<string, RoutineRecord> {
  const byNight = new Map<string, RoutineRecord>();
  for (const record of visibleRoutines(records)) {
    if (record.kind === 'night') byNight.set(record.night, record);
  }
  return byNight;
}

/**
 * Every live routine by sleep-day: the night's first, then the naps in the order they happened.
 *
 * What the history rows read. Night first because that is the row that is always drawn — a day with
 * no night routine still shows its empty row, and the naps follow it.
 */
export function routinesByDay(records: RoutineRecord[]): Map<string, RoutineRecord[]> {
  const byDay = new Map<string, RoutineRecord[]>();
  for (const record of visibleRoutines(records)) {
    const list = byDay.get(record.night) ?? [];
    list.push(record);
    byDay.set(record.night, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) =>
      a.kind === b.kind ? a.start - b.start : a.kind === 'night' ? -1 : 1
    );
  }
  return byDay;
}

/**
 * The live *nap* routines by day, earliest first.
 *
 * A list rather than a single record: a day holds one routine per nap, and each is keyed on the
 * minute it started.
 */
export function napRoutinesByDay(records: RoutineRecord[]): Map<string, RoutineRecord[]> {
  const byDay = new Map<string, RoutineRecord[]>();
  for (const record of visibleRoutines(records)) {
    if (record.kind !== 'nap') continue;
    const list = byDay.get(record.night) ?? [];
    list.push(record);
    byDay.set(record.night, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.start - b.start);
  return byDay;
}

// --- joining --------------------------------------------------------------------------------------

/**
 * When the night attributed to this day began — its first block's start.
 *
 * Read off `bucket.entries` rather than through `nightBlocks`, for the reason in the header: a night
 * with a block still running has a perfectly well-known beginning.
 */
export function firstNightBlockStart(bucket: DayBucket): number | null {
  let first: SleepEntry | null = null;
  for (const entry of bucket.entries) {
    if (entry.kind !== 'night') continue;
    if (!first || entry.start < first.start) first = entry;
  }
  return first ? first.start : null;
}

/**
 * The sleep a routine led into, or null when nothing has been logged for it yet.
 *
 * One rule for both kinds, replacing the three copies of "the first block of the night" that had
 * grown up in `routineStats.ts`, `EntryList.tsx` and `BabySleep.tsx` — and, with naps, would have
 * grown to five.
 *
 *   - **night** — the earliest night entry filed under the routine's own night key. Identical to
 *     `firstNightBlockStart` over that day's bucket, since a bucket is keyed by `dayKeyOf`; the
 *     settling is measured from the *first* block, because a waking at three in the morning starts
 *     a second entry the routine had nothing to do with.
 *   - **nap** — the earliest nap starting at or after the crib, within `MAX_SETTLE_MS`. A nap
 *     routine has no key to join on — there are several a day and the nap does not exist when the
 *     routine begins — so it joins to the next nap in *time*. That also makes the midnight edge
 *     free: the search is over the entries, not over one day's bucket.
 *
 * Null while the routine is still running: there is no crib time yet to measure from.
 */
export function asleepFor(routine: RoutineRecord, entries: SleepEntry[]): number | null {
  if (routine.kind === 'night') {
    let first: number | null = null;
    for (const entry of entries) {
      if (entry.kind !== 'night' || dayKeyOf(entry) !== routine.night) continue;
      if (first == null || entry.start < first) first = entry.start;
    }
    return first;
  }
  const crib = routine.end;
  if (crib == null) return null;
  let next: number | null = null;
  for (const entry of entries) {
    if (entry.kind !== 'nap' || entry.start < crib) continue;
    if (next == null || entry.start < next) next = entry.start;
  }
  return next != null && next - crib <= MAX_SETTLE_MS ? next : null;
}

/**
 * How long from the crib to sleep, for one routine, or null when the pair says nothing.
 *
 * Null when the routine is still running (there is no crib time yet), when no sleep has begun, and
 * when the two disagree — a negative gap means the routine was logged as ending after he was already
 * asleep, which is a mis-log and not a settling of zero.
 */
export function settleMs(routine: RoutineRecord, asleepAt: number | null): number | null {
  if (routine.end == null || asleepAt == null) return null;
  const ms = asleepAt - routine.end;
  return ms >= 0 && ms <= MAX_SETTLE_MS ? ms : null;
}

// --- drawing --------------------------------------------------------------------------------------

/** Which stretch of the evening a bar on the timeline is. */
export type RoutinePhase = 'routine' | 'settle';

/** One stretch of an evening's routine, as a single row of the timeline draws it. */
export interface RoutineSegment {
  routine: RoutineRecord;
  /** `routine` is bath to crib; `settle` is crib to asleep — the wait the tiles report. */
  phase: RoutinePhase;
  start: number;
  end: number;
  /** Nothing has ended this stretch yet, so its right edge is `now` and not a logged moment. */
  running: boolean;
  /**
   * The crib moment falls inside this row, so this row draws the tick for it. A routine begun at
   * 23:50 is clipped across two rows the way a night is, and the mark belongs on the row that
   * actually contains it — not on both, and not on the one holding only the beginning. Never set on
   * a `settle`: what ends that stretch is the night block drawn beside it.
   */
  endsHere: boolean;
}

/**
 * When the sleep each routine led into began, by **routine id**.
 *
 * Built out of the same `asleepFor` the history rows and the live strip use, so the band drawn on
 * the chart and the figure printed beside it cannot come to disagree about when he fell asleep.
 * Folded over the buckets' entries rather than the raw log, so only a believable sleep can end a
 * settling — a timer left running for thirty hours is excluded here exactly as it is everywhere.
 */
export function asleepByRoutine(days: DayBucket[], records: RoutineRecord[]): Map<string, number> {
  const entries = days.flatMap((day) => day.entries);
  const asleep = new Map<string, number>();
  for (const routine of records) {
    if (routine.deleted) continue;
    const start = asleepFor(routine, entries);
    if (start != null) asleep.set(routine.id, start);
  }
  return asleep;
}

/**
 * What a single day's row of the timeline draws for the bedtime routine: up to two bars, bath to
 * crib and crib to asleep.
 *
 * The join to a *row* is by time, deliberately not by `day.key` against `routine.night`: those agree
 * on every ordinary evening and part company at exactly the case this clipping exists for. A routine
 * begun at 00:10 is keyed to the night before by `routineNightKey`, and drawing it on that row would
 * put a bar a whole day left of the moment it happened. The join to a *sleep* — which one ends the
 * settling — is `asleepFor`'s, looked up here by routine id.
 *
 * Stretches no figure counts are not drawn, which is `segmentsForDay`'s rule for implausible entries
 * and holds for the same reason: a timer nobody stopped must not smear a bar across the chart while
 * being excluded from every average beside it.
 */
export function routineSegmentsForDay(
  records: RoutineRecord[],
  asleep: Map<string, number>,
  day: { start: number; end: number },
  now: number
): RoutineSegment[] {
  const segments: RoutineSegment[] = [];
  const add = (
    routine: RoutineRecord,
    phase: RoutinePhase,
    from: number,
    to: number,
    running: boolean
  ) => {
    const seg = clipSegment(from, to, day.start, day.end);
    if (!seg) return;
    segments.push({
      routine,
      phase,
      start: seg.start,
      end: seg.end,
      running,
      endsHere: phase === 'routine' && !running && to <= day.end,
    });
  };

  for (const routine of records) {
    if (routine.deleted) continue;
    if (isStaleRoutine(routine, now)) continue;
    const open = routine.end == null;
    if (!open && routineLength(routine) == null) continue;
    add(routine, 'routine', routine.start, routine.end ?? Math.max(routine.start, now), open);
    if (routine.end == null) continue;

    /* Crib to asleep, ending where the sleep beside it starts. While nobody has fallen asleep
       yet it runs to `now` instead — that is the figure the live strip is counting up, and it is the
       only stretch of the evening in progress once the routine itself is over. `MAX_SETTLE_MS` is
       what stops a routine whose night was never logged from smearing a band across the chart. */
    const asleepAt = asleep.get(routine.id) ?? null;
    const settled = settleMs(routine, asleepAt);
    if (settled != null) {
      add(routine, 'settle', routine.end, routine.end + settled, false);
    } else if (asleepAt == null) {
      const waited = now - routine.end;
      if (waited > 0 && waited <= MAX_SETTLE_MS) add(routine, 'settle', routine.end, now, true);
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// --- the points ------------------------------------------------------------------------------------

/*
 * The three extractors below take the *night* routines only — see the header. Each reads
 * `byNight.get(day.key)`, so a nap routine cannot reach a tile even by accident: it is not in the
 * map.
 */

export function routineLengthPoints(
  days: DayBucket[],
  byNight: Map<string, RoutineRecord>
): DurationPoint[] {
  return days.flatMap((day) => {
    const routine = byNight.get(day.key);
    if (!routine) return [];
    const ms = routineLength(routine);
    return ms == null ? [] : [{ at: day.start, ms }];
  });
}

export function settlePoints(
  days: DayBucket[],
  byNight: Map<string, RoutineRecord>
): DurationPoint[] {
  return days.flatMap((day) => {
    const routine = byNight.get(day.key);
    if (!routine) return [];
    const ms = settleMs(routine, firstNightBlockStart(day));
    return ms == null ? [] : [{ at: day.start, ms }];
  });
}

export function routineStartPoints(
  days: DayBucket[],
  byNight: Map<string, RoutineRecord>
): ClockPoint[] {
  return days.flatMap((day) => {
    const routine = byNight.get(day.key);
    return routine ? [{ at: day.start, minutes: routineStartMinutes(routine) }] : [];
  });
}

/**
 * The clock time he went into the crib, one point a night — the figure the target is set against.
 *
 * A routine still running has no crib time yet and contributes nothing; so does one whose length is
 * past believing, which is `routineLengthPoints`'s rule and holds for its reason. Note this is the
 * *end* of the routine and not the start of the sleep: what a target is aimed at is the moment you
 * can act on, which is putting him down, not the moment he happens to fall asleep afterwards.
 */
export function cribPoints(
  days: DayBucket[],
  byNight: Map<string, RoutineRecord>
): ClockPoint[] {
  return days.flatMap((day) => {
    const routine = byNight.get(day.key);
    if (!routine || routine.end == null || routineLength(routine) == null) return [];
    return [{ at: day.start, minutes: minutesOfDay(routine.end) }];
  });
}

// --- the figures -------------------------------------------------------------------------------------

export interface RoutineStats {
  routineLength: MeanStat;
  settle: MeanStat;
  routineStart: ClockStat;
  /** When he actually went into the crib — what the target on the charts is read against. */
  cribTime: ClockStat;
}

function meanStat(values: number[]): MeanStat {
  const { mean, sd, n } = linearStat(values);
  return { mean, sd, n };
}

/**
 * Built through the point extractors, so each tile and the chart drawn beneath it are one population
 * by construction — the rule `nightPerDay` follows in `stats.ts`, and for the reason stated there.
 */
export function computeRoutineStats(
  days: DayBucket[],
  records: RoutineRecord[]
): RoutineStats {
  const byNight = nightRoutinesByDay(records);
  return {
    routineLength: meanStat(routineLengthPoints(days, byNight).map((p) => p.ms)),
    settle: meanStat(settlePoints(days, byNight).map((p) => p.ms)),
    routineStart: circularStat(routineStartPoints(days, byNight).map((p) => p.minutes)),
    cribTime: circularStat(cribPoints(days, byNight).map((p) => p.minutes)),
  };
}
