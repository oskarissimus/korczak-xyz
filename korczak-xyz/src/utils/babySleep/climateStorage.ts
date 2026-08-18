/*
 * LocalStorage for the night climate records.
 *
 * Its own module rather than more of `storage.ts` because the two stores must be able to fail
 * independently: what evicts under quota pressure is sleep entries, never these — a night's
 * temperature is ~120 bytes and there is one of it a day, so the whole history is a rounding error
 * against the log it sits beside, and dropping it would buy nothing while losing the only copy of
 * the evidence the chart is built from.
 *
 * Writes go through `writeKey` in `storage.ts` for exactly the reason the sleep log's do: a write
 * that fails silently leaves the page logging happily while the stored copy stays frozen.
 */

import type { ClimateRecord } from './climate';
import { normalizeClimate } from './climate';
import { readJSON, writeKey } from './storage';

export const CLIMATE_KEYS = {
  records: 'baby-sleep-climate',
  unsynced: 'baby-sleep-climate-unsynced',
} as const;

/**
 * Every stored record, tombstones included — callers filter with `visibleClimate`.
 *
 * Each row goes through `normalizeClimate`, so one malformed record written by an older build costs
 * that row and not the whole history.
 */
export function loadClimate(): ClimateRecord[] {
  const raw = readJSON<unknown[]>(CLIMATE_KEYS.records, []);
  if (!Array.isArray(raw)) return [];
  const records: ClimateRecord[] = [];
  for (const item of raw) {
    const record = normalizeClimate(item);
    if (record) records.push(record);
  }
  return records;
}

export function saveClimate(records: ClimateRecord[]): boolean {
  return writeKey(CLIMATE_KEYS.records, JSON.stringify(records));
}

// --- the push queue -------------------------------------------------------------------------

export function loadClimateUnsynced(): string[] {
  const raw = readJSON<unknown>(CLIMATE_KEYS.unsynced, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
}

export function saveClimateUnsynced(ids: string[]): boolean {
  return writeKey(CLIMATE_KEYS.unsynced, JSON.stringify([...new Set(ids)]));
}

export function markClimateUnsynced(ids: string[]): boolean {
  return saveClimateUnsynced([...loadClimateUnsynced(), ...ids]);
}

export function clearClimateUnsynced(ids: string[]): boolean {
  const done = new Set(ids);
  return saveClimateUnsynced(loadClimateUnsynced().filter((id) => !done.has(id)));
}
