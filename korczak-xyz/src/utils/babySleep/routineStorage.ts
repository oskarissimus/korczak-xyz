/*
 * LocalStorage for the bedtime routine records.
 *
 * Its own module rather than more of `storage.ts`, for `climateStorage.ts`'s reason: what evicts
 * under quota pressure is sleep entries, never these. A routine is ~140 bytes and there is one of it
 * a night, so the whole history is a rounding error against the log it sits beside, and dropping it
 * would buy nothing while losing the only copy of what the chart is built from.
 *
 * Writes go through `writeKey` in `storage.ts`, never a bare `catch {}`: a write that fails silently
 * leaves the page logging happily while the stored copy stays frozen.
 */

import type { RoutineRecord } from './routine';
import { normalizeRoutine } from './routine';
import { readJSON, writeKey } from './storage';

export const ROUTINE_KEYS = {
  records: 'baby-sleep-routines',
  unsynced: 'baby-sleep-routines-unsynced',
} as const;

/**
 * Every stored record, tombstones included — callers filter with `visibleRoutines`.
 *
 * Each row goes through `normalizeRoutine`, so one malformed record written by an older build costs
 * that row and not the whole history.
 */
export function loadRoutines(): RoutineRecord[] {
  const raw = readJSON<unknown[]>(ROUTINE_KEYS.records, []);
  if (!Array.isArray(raw)) return [];
  const records: RoutineRecord[] = [];
  for (const item of raw) {
    const record = normalizeRoutine(item);
    if (record) records.push(record);
  }
  return records;
}

export function saveRoutines(records: RoutineRecord[]): boolean {
  return writeKey(ROUTINE_KEYS.records, JSON.stringify(records));
}

// --- the push queue -------------------------------------------------------------------------

export function loadRoutinesUnsynced(): string[] {
  const raw = readJSON<unknown>(ROUTINE_KEYS.unsynced, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

export function saveRoutinesUnsynced(ids: string[]): boolean {
  return writeKey(ROUTINE_KEYS.unsynced, JSON.stringify([...new Set(ids)]));
}

export function markRoutineUnsynced(ids: string[]): boolean {
  return saveRoutinesUnsynced([...loadRoutinesUnsynced(), ...ids]);
}

export function clearRoutineUnsynced(ids: string[]): boolean {
  const done = new Set(ids);
  return saveRoutinesUnsynced(loadRoutinesUnsynced().filter((id) => !done.has(id)));
}
