/*
 * Which day a sleep belongs to, and how a sleep is cut to fit a chart row.
 *
 * Everything here works in *local* time and steps through the `Date(y, m, d)` constructor rather
 * than epoch arithmetic, because a day is not always 86_400_000 ms: on the two DST changeover days
 * it is 23 or 25 hours, and adding a fixed day to a midnight lands an hour off — which walks a
 * whole chart out of alignment for the rest of the window. Poland shifts twice a year, so this is
 * not theoretical.
 *
 * Nothing here reads the clock. `now` is always a parameter, which is what lets the module be
 * tested in node against a fixed epoch.
 */

import type { DayBucket, SleepEntry, SleepKind, TimeWindow, WindowChoice } from './types';
import { isPlausible } from './types';

/**
 * A night beginning before this hour counts as the previous day's night.
 *
 * Without the rule a bedtime of 00:30 files itself under the day it is technically in, so that
 * calendar day holds two nights and the evening before holds none — and both days are then wrong.
 * Six is comfortably after any bedtime and comfortably before any morning wake-up.
 *
 * The rule is deliberately *not* symmetric: it applies to nights only. Shifting everything back six
 * hours would file a 9am nap under the previous day, and the morning nap is the commonest kind.
 */
export const NIGHT_CUTOFF_HOUR = 6;

/** Local `yyyy-mm-dd` for an instant. */
export function dayKeyAt(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Epoch ms of local midnight opening the given `yyyy-mm-dd`, or NaN if it is not a date. */
export function dayStart(key: string): number {
  const parts = key.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return NaN;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** Epoch ms of local midnight opening the day containing `t`. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/** Local midnight `days` days from the one containing `t`. DST-safe; `days` may be negative. */
export function addDays(t: number, days: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0).getTime();
}

/** Local midnight closing the day containing `t`. 23 or 25 hours after `startOfDay` twice a year. */
export function endOfDay(t: number): number {
  return addDays(t, 1);
}

/** Minutes after local midnight, 0–1439. */
export function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** The day a sleep of this kind starting at this instant belongs to. */
export function sleepDayKey(start: number, kind: SleepKind): string {
  if (kind === 'night' && new Date(start).getHours() < NIGHT_CUTOFF_HOUR) {
    return dayKeyAt(addDays(start, -1));
  }
  return dayKeyAt(start);
}

export function dayKeyOf(entry: SleepEntry): string {
  return sleepDayKey(entry.start, entry.kind);
}

/** Local midnights from `from` up to (not including) `to`, in order. DST-safe. */
export function eachDay(from: number, to: number): number[] {
  const days: number[] = [];
  for (let t = startOfDay(from); t < to; t = addDays(t, 1)) {
    days.push(t);
    // A custom range typed as 1970 must not hang the page.
    if (days.length >= 400) break;
  }
  return days;
}

/**
 * The window a preset or a pair of typed dates means.
 *
 * Presets count whole local days ending with today, so "3 days" is today and the two before it —
 * not the last 72 hours, which would cut this morning's nap off a chart drawn at noon. A custom
 * range includes both dates it names, in either order.
 */
export function resolveWindow(
  choice: WindowChoice,
  now: number,
  custom?: { from: string; to: string }
): TimeWindow {
  if (choice === 'custom') {
    const a = dayStart(custom?.from ?? '');
    const b = dayStart(custom?.to ?? '');
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { from: addDays(now, -6), to: addDays(now, 1) };
    }
    return { from: Math.min(a, b), to: addDays(Math.max(a, b), 1) };
  }
  const span = choice === '3d' ? 3 : choice === '7d' ? 7 : 30;
  return { from: addDays(now, -(span - 1)), to: addDays(now, 1) };
}

/**
 * The part of a sleep that falls inside `[from, to)`, or null if none of it does.
 *
 * A single interval clipped to a single window is at most *one* segment. The two pieces a night
 * crossing midnight draws as are two rows each asking for their own clip — not one call answering
 * twice.
 */
export function clipSegment(
  start: number,
  end: number,
  from: number,
  to: number
): { start: number; end: number } | null {
  const lo = Math.max(start, from);
  const hi = Math.min(end, to);
  return hi > lo ? { start: lo, end: hi } : null;
}

/** When a sleep ends for drawing purposes: its wake time, or `now` while it is still running. */
export function effectiveEnd(entry: SleepEntry, now: number): number {
  return entry.end ?? Math.max(entry.start, now);
}

/** A sleep, or the part of one, as a single row of the timeline draws it. */
export interface DaySegment {
  entry: SleepEntry;
  start: number;
  end: number;
  /** The sleep began before this row — so this piece is the continuation of one above. */
  continuesBefore: boolean;
  /** The sleep runs past this row — so it is continued in the one below. */
  continuesAfter: boolean;
}

/**
 * What a single day's row of the timeline has to draw.
 *
 * This asks which sleeps *overlap* the row, which is emphatically not the same question as which
 * sleeps are *attributed* to the day. A night beginning at 20:40 belongs to that evening and to no
 * other, but it is still on the screen at 06:30 the following morning, so the row below has to draw
 * its tail. Using `DayBucket.entries` here — the attributed set — silently drew only the first half
 * of every night, and the chart looked plausible enough that only counting the rectangles caught it.
 *
 * Implausible entries are dropped, so a timer left running for thirty hours does not smear a bar
 * across two days of the chart while being excluded from every figure beside it.
 */
export function segmentsForDay(
  entries: SleepEntry[],
  day: { start: number; end: number },
  now: number
): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const entry of entries) {
    if (!isPlausible(entry, now)) continue;
    const end = effectiveEnd(entry, now);
    const seg = clipSegment(entry.start, end, day.start, day.end);
    if (!seg) continue;
    segments.push({
      entry,
      start: seg.start,
      end: seg.end,
      continuesBefore: entry.start < day.start,
      continuesAfter: end > day.end,
    });
  }
  return segments.sort((a, b) => a.start - b.start);
}

/** A closed entry's length, or null while it runs — an unfinished sleep has no duration to report. */
export function durationOf(entry: SleepEntry): number | null {
  return entry.end == null ? null : Math.max(0, entry.end - entry.start);
}

/**
 * One bucket per local day in the window, in order, gaps included — a chart needs an empty day to
 * be visible. Only believable entries are bucketed at all, so a forgotten thirty-hour timer never
 * reaches a total. `nightMs` is null where no closed night is attributed to the day, which is what
 * distinguishes "the baby slept nothing" from "this day was not fully tracked".
 */
export function groupByDay(entries: SleepEntry[], window: TimeWindow, now: number): DayBucket[] {
  const buckets = new Map<string, DayBucket>();
  for (const at of eachDay(window.from, window.to)) {
    const key = dayKeyAt(at);
    buckets.set(key, {
      key,
      start: at,
      end: endOfDay(at),
      nightMs: null,
      napMs: 0,
      naps: 0,
      entries: [],
      partial: endOfDay(at) > now,
    });
  }

  for (const entry of entries) {
    if (!isPlausible(entry, now)) continue;
    const bucket = buckets.get(dayKeyOf(entry));
    if (!bucket) continue;
    bucket.entries.push(entry);
    const ms = durationOf(entry);
    if (ms == null) continue; // still running: drawn, never counted
    if (entry.kind === 'night') {
      bucket.nightMs = (bucket.nightMs ?? 0) + ms;
    } else {
      bucket.napMs += ms;
      bucket.naps += 1;
    }
  }

  for (const bucket of buckets.values()) {
    bucket.entries.sort((a, b) => a.start - b.start);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}
