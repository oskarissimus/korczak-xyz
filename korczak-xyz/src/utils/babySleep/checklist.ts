/*
 * Which steps of tonight's routine have been ticked off.
 *
 * Not a record and not synced, unlike everything else in this app that is written down. A tick is
 * a note to yourself about the twenty minutes you are in the middle of — "the teeth are done" —
 * and it is worthless by morning; `BabySleepSettings` is the same kind of thing and lives in the
 * same place. What is worth keeping about a routine is already kept: the times, as a
 * `RoutineRecord` the other parent's phone pulls.
 *
 * It is stored at all so that the twenty minutes survive the page: the phone locks between the
 * bath and the teeth, or you switch to the log tab to tap "night routine" and come back.
 */

import { sleepDayKey } from './days';
import { readJSON, writeKey } from './storage';

const KEY = 'baby-sleep-checklist';

interface StoredChecklist {
  night: string;
  done: number[];
}

/**
 * The night a tick made now belongs to — `sleepDayKey`, exactly as a routine record's id is keyed,
 * so a routine still going at 00:10 keeps ticking the evening it started in rather than starting a
 * fresh sheet halfway through. It is also what makes the state clear itself: tomorrow evening asks
 * for a different night and yesterday's ticks are simply not it.
 */
export function checklistNight(now: number): string {
  return sleepDayKey(now, 'night');
}

/**
 * Ticks belonging to `night`, and nothing else — a stored sheet from any other night reads as an
 * empty one rather than as last night's answers.
 *
 * `count` is the number of steps on today's sheet: an index past the end is dropped, so shortening
 * the list cannot leave a tick on a row that no longer means what it did. Anything unreadable is an
 * empty sheet, which is the state this can always fall back to safely.
 */
export function parseChecklist(raw: unknown, night: string, count: number): number[] {
  if (!raw || typeof raw !== 'object') return [];
  const stored = raw as Partial<StoredChecklist>;
  if (stored.night !== night || !Array.isArray(stored.done)) return [];
  const done = stored.done.filter(
    (i): i is number => Number.isInteger(i) && i >= 0 && i < count
  );
  return [...new Set(done)].sort((a, b) => a - b);
}

export function serializeChecklist(night: string, done: number[]): string {
  return JSON.stringify({ night, done: [...done].sort((a, b) => a - b) } satisfies StoredChecklist);
}

export function loadChecklist(now: number, count: number): number[] {
  return parseChecklist(readJSON<unknown>(KEY, null), checklistNight(now), count);
}

export function saveChecklist(now: number, done: number[]): boolean {
  return writeKey(KEY, serializeChecklist(checklistNight(now), done));
}
