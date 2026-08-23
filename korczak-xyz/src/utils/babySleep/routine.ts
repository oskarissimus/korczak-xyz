/*
 * The routine that leads into a sleep, and the part of it that matters.
 *
 * The log records when the baby *fell asleep*. Two facts before that are worth having and cannot be
 * recovered afterwards: when the routine began — bath, pyjamas, a book — and when it ended, which is
 * the moment he goes into the crib. The first gap is the routine; the second, from the crib to
 * sleep, is the time spent sitting beside him, and it is the number this whole module exists for.
 *
 * It is not only a *bedtime* routine. A nap is led into the same way and the settling before it is
 * the same measurement, so a routine carries a `kind` exactly as a sleep entry does.
 *
 * ## A routine is its own record, not two fields on the entry
 *
 * The entry does not exist yet. It is created by the "night sleep" tap, forty minutes after the
 * routine started, so a "routine started" button would have nowhere to write. And the two halves are
 * two separate acts twenty minutes apart, on a shared log often by two people on two phones — which
 * is the case `climate.ts` sets out at length: a single record makes those halves compete in a
 * whole-record last-write-wins merge, and a phone offline across the gap silently drops one of them.
 *
 * So this is `climate.ts`'s shape again. One document per routine, reconciled by `versioned.ts`,
 * which knows nothing about what a row is. Two things fall out of keying on the *occasion* rather
 * than on the entry: `split.ts` needs nothing at all — cutting a night in two leaves the routine
 * alone — and correcting an entry's times cannot orphan a routine.
 *
 * ## The id says which occasion, and the night keeps the bare key
 *
 *   night   2026-08-18            the sleep-day key, unchanged since routines were night-only
 *   nap     2026-08-18-nap-1230   the same key, plus the hh:mm the routine started
 *
 * The night's grammar is left alone deliberately — it is what every stored record and every
 * Firestore document already names, so it keeps its meaning and nap routines arrive as the new
 * material they are. The same migration `:b`, `:de` and `:o201` make in the flashcards deck.
 *
 * The day part is `sleepDayKey(t, kind)`, so a night goes through `NIGHT_CUTOFF_HOUR` and a nap does
 * not — which is exactly the asymmetry that rule is documented to have.
 *
 * The nap's suffix is a **time and not an ordinal**, and that is the whole of why it is safe.
 * Derived rather than a `uuid()`, so two phones tapping in the same minute converge on one document
 * instead of racing to create two; and derived from the clock rather than from a count, so a phone
 * that has been offline since yesterday cannot mint `-nap1` for the afternoon and silently overwrite
 * the morning's. A minute apart makes two records, which is visible in the history and clearable.
 * Duplicate rather than lose.
 *
 * The id is minted once, from the draft's `start`, and never again: `setRoutine` carries `prev.id`
 * through an edit, so correcting a routine's start time does not move its document.
 *
 * `kind` and `night` are **derived from the id, never believed from the field** — the rule
 * `normalizeRoutine` already followed for `night`, extended rather than joined by a second one.
 *
 * Nothing here reads the clock. `now` is always a parameter.
 */

import { getClientId } from '../../lib/clientId';
import { isNightKey } from './climate';
import { dayStart, minutesOfDay, sleepDayKey } from './days';
import type { SleepKind } from './types';
import type { Versioned } from './versioned';

/**
 * Which occasion a routine is about: its document id, the sleep-day it is filed under, and whether
 * it leads into a night or a nap. A `RoutineRecord` is one of these, so a record can be passed
 * wherever a key is wanted.
 */
export interface RoutineKey {
  id: string;
  /**
   * Local `yyyy-mm-dd` of the sleep this routine leads into — the night key for a night, the plain
   * calendar day for a nap.
   *
   * The field is called `night` for both kinds, and renaming it is not the tidy-up it looks like:
   * `pullRoutines` reads the collection with `orderBy('night', 'desc')`, and a Firestore `orderBy`
   * on a field a document lacks **excludes that document from the result**. Renaming it would make
   * every routine written before the rename invisible to the pull.
   */
  night: string;
  kind: SleepKind;
}

export interface RoutineRecord extends Versioned, RoutineKey {
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

// --- ids and days --------------------------------------------------------------------------------

const NAP_ID = /^(\d{4}-\d{2}-\d{2})-nap-(\d{2})(\d{2})$/;

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

/** The occasion a routine of this kind, started at this instant, is about. */
export function routineKey(kind: SleepKind, t: number): RoutineKey {
  const night = sleepDayKey(t, kind);
  if (kind === 'night') return { id: night, night, kind };
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { id: `${night}-nap-${hh}${mm}`, night, kind };
}

/**
 * Read an id back, or null if it is not one this app could ever have minted.
 *
 * Matched whole rather than split at a separator, so `parseClimateId`'s last-hyphen trap does not
 * arise: a `yyyy-mm-dd` key carries two hyphens of its own and the suffix carries two more.
 */
export function parseRoutineId(id: string): RoutineKey | null {
  if (isNightKey(id)) return { id, night: id, kind: 'night' };
  const m = NAP_ID.exec(id);
  if (!m) return null;
  const [, night, hh, mm] = m;
  if (!isNightKey(night) || Number(hh) > 23 || Number(mm) > 59) return null;
  return { id, night, kind: 'nap' };
}

export function isRoutineId(id: string): boolean {
  return parseRoutineId(id) != null;
}

// --- what is believable --------------------------------------------------------------------------

/**
 * Beyond this a "routine" is a timer nobody stopped. Four hours is far longer than any bedtime and
 * comfortably short of the night that follows it — and it is the ceiling for a nap routine too,
 * where it is merely generous: these bounds exist to catch a forgotten timer, not to police how
 * long a routine is allowed to take.
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

function blank(key: RoutineKey, now: number, author?: string): RoutineRecord {
  return {
    ...key,
    start: now,
    end: null,
    rev: 0,
    updatedAt: now,
    writerId: getClientId(),
    ...(author ? { authorEmail: author } : {}),
  };
}

/**
 * One occasion's routine, new or revised.
 *
 * `prev` is whatever the log already holds for it, so the id and the author survive an edit and
 * `rev` moves forward — which is what makes the revision, not the wall clock, decide the merge.
 * A `RoutineRecord` is itself a `RoutineKey`, so an edit passes the record it is editing.
 *
 * `deleted` is dropped rather than set to false: a tombstone written to again is alive, the human
 * having just entered a value into it, and an explicit `undefined` is the one thing `setDoc`
 * rejects.
 */
export function setRoutine(
  key: RoutineKey,
  draft: RoutineDraft,
  now: number,
  prev?: RoutineRecord,
  author?: string
): RoutineRecord {
  const base = prev ?? blank(key, now, author);
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
  if (typeof r.id !== 'string') return null;
  // The id is the truth: it is the document name, and `night` and `kind` are it read out. A record
  // whose fields disagree with its own id is taken at its id.
  const key = parseRoutineId(r.id);
  if (!key) return null;
  if (typeof r.start !== 'number' || !Number.isFinite(r.start)) return null;
  const end = r.end;
  if (end != null && (typeof end !== 'number' || !Number.isFinite(end))) return null;
  const rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
      ? (r.updatedAt as number)
      : dayStart(key.night);
  return {
    ...key,
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
