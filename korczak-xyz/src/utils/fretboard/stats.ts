/*
 * Aggregates: what one sitting came to, and what the whole history looks like.
 *
 * All of it is derived from the review log and the deck, so nothing here is stored except the
 * daily mastery snapshots — and those exist only because "how many cards were mature last
 * Tuesday" is the one question the log cannot answer cheaply. Everything else is recomputed,
 * which means a scheduler change is reflected in the stats instead of contradicted by them.
 */

import { isPositionKey, parseCardId } from './notes';
import type { Direction } from './notes';
import type { Bucket, Card } from './srs';
import { bucketOf } from './srs';
import type { Deck, MasterySnapshot, ReviewEvent, SessionRecord } from './types';

// --- time -----------------------------------------------------------------------------------

/** Local calendar day. Local, not UTC: a session at 23:30 belongs to the day you were awake. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Seconds to one decimal below ten, whole seconds above: `1.8s`, `12s`. */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// --- one sitting ----------------------------------------------------------------------------

export interface DirectionSplit {
  direction: Direction;
  answers: number;
  correct: number;
  totalMs: number;
}

export interface SessionSummary {
  answers: number;
  correct: number;
  accuracy: number; // 0..1; 0 when nothing was answered
  cards: number; // distinct cards seen
  totalMs: number;
  avgMs: number;
  medianMs: number;
  fastestMs: number | null;
  slowestMs: number | null;
  lapses: number; // answers rated `again`
  byDirection: DirectionSplit[];
  /** Cards that were missed, worst first — what to look at before the next sitting. */
  missed: { cardId: string; misses: number }[];
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summarizeSession(events: ReviewEvent[]): SessionSummary {
  const times = events.map((e) => e.ms);
  const totalMs = times.reduce((sum, ms) => sum + ms, 0);
  const correct = events.filter((e) => e.correct).length;

  const splits = new Map<Direction, DirectionSplit>();
  const misses = new Map<string, number>();
  for (const event of events) {
    const key = parseCardId(event.cardId);
    if (key) {
      const split =
        splits.get(key.direction) ??
        { direction: key.direction, answers: 0, correct: 0, totalMs: 0 };
      split.answers++;
      split.correct += event.correct ? 1 : 0;
      split.totalMs += event.ms;
      splits.set(key.direction, split);
    }
    if (!event.correct) misses.set(event.cardId, (misses.get(event.cardId) ?? 0) + 1);
  }

  return {
    answers: events.length,
    correct,
    accuracy: events.length === 0 ? 0 : correct / events.length,
    cards: new Set(events.map((e) => e.cardId)).size,
    totalMs,
    avgMs: events.length === 0 ? 0 : totalMs / events.length,
    medianMs: median(times),
    fastestMs: times.length === 0 ? null : Math.min(...times),
    slowestMs: times.length === 0 ? null : Math.max(...times),
    lapses: events.filter((e) => e.rating === 'again').length,
    byDirection: [...splits.values()],
    missed: [...misses.entries()]
      .map(([cardId, count]) => ({ cardId, misses: count }))
      .sort((a, b) => b.misses - a.misses),
  };
}

/**
 * What a sitting leaves behind in the history table.
 *
 * `masteredAfter` is a reading taken at the end rather than a number recomputed later: it is
 * what the deck looked like when you stopped, and a scheduler change should not rewrite the
 * past. The mastery chart is drawn from the daily snapshots for the same reason.
 */
export function buildSessionRecord(
  id: string,
  startedAt: number,
  endedAt: number,
  events: ReviewEvent[],
  newIntroduced: number,
  masteredAfter: number
): SessionRecord {
  const summary = summarizeSession(events);
  return {
    id,
    startedAt,
    endedAt,
    answers: summary.answers,
    correct: summary.correct,
    totalMs: summary.totalMs,
    cards: summary.cards,
    newIntroduced,
    masteredAfter,
  };
}

// --- history --------------------------------------------------------------------------------

export interface DayStats {
  day: string;
  at: number; // start of that day, for the x-axis
  answers: number;
  correct: number;
  accuracy: number;
  avgMs: number;
}

export function dailyStats(events: ReviewEvent[]): DayStats[] {
  const days = new Map<string, { at: number; answers: number; correct: number; totalMs: number }>();
  for (const event of events) {
    const key = dayKey(event.at);
    const entry = days.get(key) ?? { at: dayStart(event.at), answers: 0, correct: 0, totalMs: 0 };
    entry.answers++;
    entry.correct += event.correct ? 1 : 0;
    entry.totalMs += event.ms;
    days.set(key, entry);
  }
  return [...days.entries()]
    .map(([day, e]) => ({
      day,
      at: e.at,
      answers: e.answers,
      correct: e.correct,
      accuracy: e.correct / e.answers,
      avgMs: e.totalMs / e.answers,
    }))
    .sort((a, b) => a.at - b.at);
}

export function countBuckets(cards: Card[]): Record<Bucket, number> {
  const counts: Record<Bucket, number> = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const card of cards) counts[bucketOf(card)]++;
  return counts;
}

/**
 * Record where the deck stands today.
 *
 * One entry per day, overwritten as the day goes on, so the series is "where things stood when
 * you stopped" rather than a sawtooth of mid-session states. Kept for a year: the chart is the
 * point of the whole exercise, and a year of four small numbers is under 30 kB.
 */
export const MASTERY_HISTORY_DAYS = 400;

export function snapshotMastery(
  history: MasterySnapshot[],
  counts: Record<Bucket, number>,
  now: number
): MasterySnapshot[] {
  const day = dayKey(now);
  const others = history.filter((s) => s.day !== day);
  return [...others, { day, at: now, counts }]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-MASTERY_HISTORY_DAYS);
}

// --- per-position ---------------------------------------------------------------------------

export interface PositionStat {
  stringIndex: number;
  fret: number;
  seen: number;
  correct: number;
  accuracy: number | null;
  avgMs: number | null;
  /** The weakest card on the square — a position is only known when every way of asking it is. */
  bucket: Bucket;
}

const BUCKET_ORDER: Bucket[] = ['new', 'learning', 'young', 'mature'];

/**
 * Collapse the deck onto the neck for the heatmap.
 *
 * Every card asking about a position shares its square — both of those directions, on a black key
 * both spellings of the `find` card, and under each notation in the deck — because the square is a
 * place on the instrument and that is what the picture is about. They are combined by taking the
 * weakest: a position you can read but not find is not a position you know, and nor is one you can
 * find as C♯ but not as D♭, or as C♯ but not as Cis.
 *
 * The cards that ask about no one square are not in the picture at all — `pitch` and `allPitch`,
 * which ask for a pitch wherever it lies, and `allNote`, which asks for a whole pitch class.
 * There is nothing to take the weakest of on any one square, and folding a select-all card onto
 * every square it covers would count one card a dozen times.
 */
export function positionStats(deck: Deck): PositionStat[] {
  const squares = new Map<string, PositionStat>();
  for (const card of Object.values(deck)) {
    const key = parseCardId(card.id);
    // A card that is not keyed on a position has no place in a picture of squares: three or four
    // of them answer a `pitch` card, and a dozen answer an `allNote` one.
    if (!key || !isPositionKey(key)) continue;
    const squareKey = `${key.stringIndex}-${key.fret}`;
    const existing = squares.get(squareKey);
    const bucket = bucketOf(card);
    if (!existing) {
      squares.set(squareKey, {
        stringIndex: key.stringIndex,
        fret: key.fret,
        seen: card.seen,
        correct: card.correct,
        accuracy: card.seen === 0 ? null : card.correct / card.seen,
        avgMs: card.seen === 0 ? null : card.totalMs / card.seen,
        bucket,
      });
      continue;
    }
    const seen = existing.seen + card.seen;
    const correct = existing.correct + card.correct;
    const totalMs =
      (existing.avgMs ?? 0) * existing.seen + (card.seen === 0 ? 0 : card.totalMs);
    squares.set(squareKey, {
      ...existing,
      seen,
      correct,
      accuracy: seen === 0 ? null : correct / seen,
      avgMs: seen === 0 ? null : totalMs / seen,
      bucket:
        BUCKET_ORDER.indexOf(bucket) < BUCKET_ORDER.indexOf(existing.bucket)
          ? bucket
          : existing.bucket,
    });
  }
  return [...squares.values()];
}

/** Totals for the stats header. */
export interface OverallStats {
  answers: number;
  correct: number;
  accuracy: number;
  totalMs: number;
  sessions: number;
  days: number;
  streak: number; // consecutive days up to today
}

export function overallStats(
  events: ReviewEvent[],
  sessions: SessionRecord[],
  now: number
): OverallStats {
  const correct = events.filter((e) => e.correct).length;
  const days = new Set(events.map((e) => dayKey(e.at)));
  return {
    answers: events.length,
    correct,
    accuracy: events.length === 0 ? 0 : correct / events.length,
    totalMs: events.reduce((sum, e) => sum + e.ms, 0),
    sessions: sessions.length,
    days: days.size,
    streak: currentStreak(days, now),
  };
}

/**
 * Consecutive days of practice ending today.
 *
 * Yesterday still counts as an unbroken streak until today is over — a streak that resets at
 * midnight punishes you for not having practised yet.
 */
export function currentStreak(days: Set<string>, now: number): number {
  const DAY = 86_400_000;
  let cursor = dayStart(now);
  if (!days.has(dayKey(cursor))) {
    cursor -= DAY;
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}
