/*
 * Reading the routines back against the nights they led into.
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
 */

import { circularStat, linearStat } from './circular';
import type { RoutineRecord } from './routine';
import { MAX_SETTLE_MS, routineLength, routineStartMinutes } from './routine';
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

/** The live routines by night key — what the list, the live strip and an edit all look up by. */
export function routinesByNight(records: RoutineRecord[]): Map<string, RoutineRecord> {
  const byNight = new Map<string, RoutineRecord>();
  for (const record of visibleRoutines(records)) byNight.set(record.night, record);
  return byNight;
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
 * How long from the crib to sleep, for one night, or null when the pair says nothing.
 *
 * Null when the routine is still running (there is no crib time yet), when no night has begun, and
 * when the two disagree — a negative gap means the routine was logged as ending after he was already
 * asleep, which is a mis-log and not a settling of zero.
 */
export function settleMs(routine: RoutineRecord, asleepAt: number | null): number | null {
  if (routine.end == null || asleepAt == null) return null;
  const ms = asleepAt - routine.end;
  return ms >= 0 && ms <= MAX_SETTLE_MS ? ms : null;
}

// --- the points ------------------------------------------------------------------------------------

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

// --- the figures -------------------------------------------------------------------------------------

export interface RoutineStats {
  routineLength: MeanStat;
  settle: MeanStat;
  routineStart: ClockStat;
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
  const byNight = routinesByNight(records);
  return {
    routineLength: meanStat(routineLengthPoints(days, byNight).map((p) => p.ms)),
    settle: meanStat(settlePoints(days, byNight).map((p) => p.ms)),
    routineStart: circularStat(routineStartPoints(days, byNight).map((p) => p.minutes)),
  };
}
