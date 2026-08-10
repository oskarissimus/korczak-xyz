/*
 * Splitting one sleep in two around a waking.
 *
 * A baby wakes at three in the morning and is back asleep twenty minutes later. That night is one
 * night — the same bedtime, the same morning — but it is not one *block* of sleep, and counting the
 * twenty minutes as sleep is the difference between a log that matches the night and one that
 * flatters it.
 *
 * The record does not change shape for this: **a wake period is not a field on an entry, it is the
 * gap between two entries.** Two `night` rows on the same day are one broken night, and `stats.ts`
 * reads them back that way. That choice is worth stating because the alternative is tempting and
 * worse — a `wakes: [...]` array inside an entry would need its own merge rule for two devices
 * editing the same night, where the existing per-entry rule already handles two rows without being
 * told anything at all.
 *
 * There are two ways in and they produce the same rows. Live: tap "woke up", tap "night sleep" again
 * when the baby settles — no split involved. After the fact: this module, cutting a sleep already
 * logged into the two halves it was really slept in.
 *
 * Nothing here reads the clock; `now` is a parameter, as everywhere else in this directory.
 */

import type { SleepEntry } from './types';
import { MIN_SLEEP_MS, editEntry, newEntry } from './types';

/** The shortest gap two minute-granular `<input type="time">` fields can express, and so the
 *  shortest wake anyone can log. A gap of zero is not a waking, it is a mistyped field. */
export const MIN_WAKE_MS = 60_000;

/** How long the wake period is when the form opens, so it opens on a valid pair, not on an error. */
const DEFAULT_WAKE_MS = 20 * 60_000;

export type SplitError = 'not-splittable' | 'wake-outside' | 'wake-order' | 'too-short' | 'future';

export type SplitOutcome =
  | { ok: true; entries: [SleepEntry, SleepEntry] }
  | { ok: false; error: SplitError };

/** When a sleep ends for splitting purposes: its wake time, or now while it is still running. */
function endOf(entry: SleepEntry, now: number): number {
  return entry.end ?? Math.max(entry.start, now);
}

/**
 * Whether there is room in this sleep for a wake period at all — which is what decides whether the
 * button is offered on a row.
 *
 * A running sleep needs half as much room: its second half inherits the open end, and an entry still
 * running has no duration that could be too short.
 */
export function canSplit(entry: SleepEntry, now: number): boolean {
  if (entry.deleted) return false;
  const halves = entry.end == null ? 1 : 2;
  return endOf(entry, now) - entry.start >= halves * MIN_SLEEP_MS + MIN_WAKE_MS;
}

/**
 * Round to the nearest five minutes. Every timezone offset is a whole number of quarter hours, so
 * this lands on a five-minute mark on the wall clock as well as on the epoch.
 */
function round5(t: number): number {
  return Math.round(t / 300_000) * 300_000;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * A wake period the form can open with: the middle of the sleep, twenty minutes long, pulled inside
 * whatever room the entry actually has.
 *
 * Only ever called on an entry `canSplit` accepts, and that is what makes the clamps below safe: on
 * anything shorter the lower bound would cross the upper one and the pair would come out inverted.
 */
export function defaultSplit(entry: SleepEntry, now: number): { wakeAt: number; sleepAt: number } {
  const end = endOf(entry, now);
  // The room the second half needs at the end. A running one needs none — it has no wake time yet.
  const tail = entry.end == null ? 0 : MIN_SLEEP_MS;
  const wakeAt = clamp(
    round5(entry.start + (end - entry.start) / 2),
    entry.start + MIN_SLEEP_MS,
    end - tail - MIN_WAKE_MS
  );
  return { wakeAt, sleepAt: Math.min(wakeAt + DEFAULT_WAKE_MS, end - tail) };
}

/**
 * Cut `entry` into the sleep before the waking and the sleep after it.
 *
 * The first half **keeps the entry's id** — it is the same sleep, shortened — so another device
 * holding it receives an ordinary edit rather than a delete and two inserts. The second half is a
 * new entry carrying the original's `authorEmail`: that field answers who *recorded* the sleep, and
 * cutting a night in half two days later does not change the answer.
 *
 * A running sleep splits too, and its second half stays running. That is the case for having slept
 * through the waking oneself and only logging it in the morning.
 */
export function splitEntry(
  entry: SleepEntry,
  wakeAt: number,
  sleepAt: number,
  now: number
): SplitOutcome {
  if (entry.deleted) return { ok: false, error: 'not-splittable' };
  if (!Number.isFinite(wakeAt) || !Number.isFinite(sleepAt)) {
    return { ok: false, error: 'wake-outside' };
  }
  if (wakeAt > now || sleepAt > now) return { ok: false, error: 'future' };

  const end = entry.end;
  if (wakeAt <= entry.start) return { ok: false, error: 'wake-outside' };
  if (end != null && (wakeAt >= end || sleepAt >= end)) return { ok: false, error: 'wake-outside' };
  if (sleepAt - wakeAt < MIN_WAKE_MS) return { ok: false, error: 'wake-order' };

  if (wakeAt - entry.start < MIN_SLEEP_MS) return { ok: false, error: 'too-short' };
  if (end != null && end - sleepAt < MIN_SLEEP_MS) return { ok: false, error: 'too-short' };

  return {
    ok: true,
    entries: [
      editEntry(entry, { end: wakeAt }, now),
      newEntry({ kind: entry.kind, start: sleepAt, end }, now, entry.authorEmail),
    ],
  };
}
