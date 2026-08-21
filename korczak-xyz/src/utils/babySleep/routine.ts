/*
 * The bedtime routine that leads into a night, and the part of it that matters.
 *
 * The log records when the baby *fell asleep*. Two facts before that are worth having and cannot be
 * recovered afterwards: when the routine began — bath, pyjamas, a book — and when it ended, which is
 * the moment he goes into the crib. The first gap is the routine; the second, from the crib to
 * sleep, is the time spent sitting beside him, and it is the number this whole module exists for.
 *
 * ## A routine is its own record, not two fields on the entry
 *
 * The entry does not exist yet. It is created by the "night sleep" tap, forty minutes after the
 * routine started, so a "routine started" button would have nowhere to write. And the two halves are
 * two separate acts twenty minutes apart, on a shared log often by two people on two phones — which
 * is the case `climate.ts` sets out at length: a single record makes those halves compete in a
 * whole-record last-write-wins merge, and a phone offline across the gap silently drops one of them.
 *
 * So this is `climate.ts`'s shape again. One document a night, reconciled by `versioned.ts`, which
 * knows nothing about what a row is. Two things fall out of keying on the night rather than on the
 * entry: `split.ts` needs nothing at all — cutting a night in two leaves the routine alone — and
 * correcting an entry's times cannot orphan a routine.
 *
 * ## The id is the night key
 *
 * Derived, not a `uuid()`, so two devices logging the same evening converge on one document instead
 * of racing to create two. There is one record per night rather than climate's two, so there is no
 * `-part` suffix to split off and `parseClimateId`'s last-hyphen trap does not arise here: the whole
 * id is the key.
 *
 * Nothing here reads the clock. `now` is always a parameter.
 */

import { getClientId } from '../../lib/clientId';
import { isNightKey } from './climate';
import { dayStart, minutesOfDay, sleepDayKey } from './days';
import type { Versioned } from './versioned';

export interface RoutineRecord extends Versioned {
  /** Local `yyyy-mm-dd` of the night this routine leads into. Also the id. */
  night: string;
  /** Epoch ms the routine began. */
  start: number;
  /** Epoch ms he went into the crib, or null while the routine is still running. */
  end: number | null;
  /**
   * Who logged it. Set on creation and never changed by an edit — it answers who *recorded* the
   * routine, which a later correction does not alter. `writerId` cannot stand in for it: that is a
   * browser profile, so one person on a phone and a laptop is two writers.
   */
  authorEmail?: string;
}

/** What the form holds before it becomes a record. */
export interface RoutineDraft {
  start: number;
  end: number | null;
}

// --- ids and nights ------------------------------------------------------------------------------

/**
 * Which night a routine at this instant belongs to.
 *
 * Deliberately `sleepDayKey(_, 'night')` and **not** climate's `currentNightKey`. A routine is
 * logged at the *start* of the night, exactly as a night entry's `start` is, so it has to go through
 * the same `NIGHT_CUTOFF_HOUR` rule: a routine begun at 00:10 belongs to the evening before, and so
 * does the sleep that follows it. Running both through one function is what makes the routine and
 * the entry agree by construction rather than by coincidence.
 */
export function routineNightKey(t: number): string {
  return sleepDayKey(t, 'night');
}

export function isRoutineId(id: string): boolean {
  return isNightKey(id);
}

// --- what is believable --------------------------------------------------------------------------

/**
 * Beyond this a "routine" is a timer nobody stopped. Four hours is far longer than any bedtime and
 * comfortably short of the night that follows it.
 */
export const MAX_ROUTINE_MS = 4 * 60 * 60_000;

/** Beyond this the gap from crib to sleep is a mis-log, not a settling. */
export const MAX_SETTLE_MS = 4 * 60 * 60_000;

export type RoutineError = 'no-start' | 'end-before-start' | 'future' | 'too-long';

/**
 * Whether a draft is worth storing.
 *
 * There is no minimum length: a five-minute routine is a real routine, and `end > start` is the only
 * thing a pair of minute-granular fields can be wrong about.
 */
export function validateRoutine(draft: RoutineDraft, now: number): RoutineError | null {
  if (!Number.isFinite(draft.start)) return 'no-start';
  if (draft.start > now) return 'future';
  if (draft.end != null) {
    if (!Number.isFinite(draft.end)) return 'end-before-start';
    if (draft.end <= draft.start) return 'end-before-start';
    if (draft.end > now) return 'future';
    if (draft.end - draft.start > MAX_ROUTINE_MS) return 'too-long';
  }
  return null;
}

/** A routine still running that has run too long to believe — the forgotten-timer case. */
export function isStaleRoutine(record: RoutineRecord, now: number): boolean {
  return !record.deleted && record.end == null && now - record.start > MAX_ROUTINE_MS;
}

/** A closed routine's length, or null while it runs. Null too when it is past believing. */
export function routineLength(record: RoutineRecord): number | null {
  if (record.end == null) return null;
  const ms = record.end - record.start;
  return ms > 0 && ms <= MAX_ROUTINE_MS ? ms : null;
}

/** Minutes after local midnight the routine began — the clock figure. */
export function routineStartMinutes(record: RoutineRecord): number {
  return minutesOfDay(record.start);
}

// --- constructing and editing --------------------------------------------------------------------

function blank(night: string, now: number, author?: string): RoutineRecord {
  return {
    id: night,
    night,
    start: now,
    end: null,
    rev: 0,
    updatedAt: now,
    writerId: getClientId(),
    ...(author ? { authorEmail: author } : {}),
  };
}

/**
 * A night's routine, new or revised.
 *
 * `prev` is whatever the log already holds for that night, so the id and the author survive an edit
 * and `rev` moves forward — which is what makes the revision, not the wall clock, decide the merge.
 *
 * `deleted` is dropped rather than set to false: a tombstone written to again is alive, the human
 * having just entered a value into it, and an explicit `undefined` is the one thing `setDoc`
 * rejects.
 */
export function setRoutine(
  night: string,
  draft: RoutineDraft,
  now: number,
  prev?: RoutineRecord,
  author?: string
): RoutineRecord {
  const base = prev ?? blank(night, now, author);
  const { deleted: _gone, ...live } = base;
  return {
    ...live,
    start: draft.start,
    end: draft.end,
    rev: prev != null ? base.rev + 1 : 0,
    updatedAt: now,
    writerId: getClientId(),
  };
}

export function tombstoneRoutine(prev: RoutineRecord, now: number): RoutineRecord {
  return { ...prev, deleted: true, rev: prev.rev + 1, updatedAt: now, writerId: getClientId() };
}

/**
 * Coerce an untrusted record — from localStorage written by an older build, or from Firestore —
 * into a `RoutineRecord`, or reject it. Returns null rather than throwing, so one bad document
 * cannot take the whole log down with it.
 *
 * This is an **allow-list**: the object is rebuilt field by field, so a field added to
 * `RoutineRecord` and not added here is silently stripped on every read and every pull.
 */
export function normalizeRoutine(raw: unknown): RoutineRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !isRoutineId(r.id)) return null;
  if (typeof r.start !== 'number' || !Number.isFinite(r.start)) return null;
  const end = r.end;
  if (end != null && (typeof end !== 'number' || !Number.isFinite(end))) return null;
  const rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
      ? (r.updatedAt as number)
      : dayStart(r.id);
  return {
    id: r.id,
    // The id is the truth: it is the document name, and `night` is it written out for readability.
    // A record whose field disagrees with its own id is taken at its id.
    night: r.id,
    start: r.start,
    end: end == null ? null : (end as number),
    rev,
    updatedAt,
    writerId: typeof r.writerId === 'string' ? r.writerId : '',
    // Spread conditionally rather than assigned: `setDoc` rejects an explicit `undefined`, and this
    // record goes straight to Firestore.
    ...(typeof r.authorEmail === 'string' && r.authorEmail !== ''
      ? { authorEmail: r.authorEmail }
      : {}),
    ...(r.deleted === true ? { deleted: true as const } : {}),
  };
}
