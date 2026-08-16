/*
 * The transposition trainer's own numbers.
 *
 * Everything true of any deck — day keys, session summaries, mastery snapshots, streaks — is in
 * `src/utils/srs/history.ts` and re-exported here so the rest of this app has one import path.
 * What is left below is the part that has to know a card id names a key: the per-key table, which
 * is this deck's answer to the fretboard's neck heatmap.
 */

import type { Bucket, Card } from '../srs/scheduler';
import { bucketOf } from '../srs/scheduler';
import { summarizeSession as summarize } from '../srs/history';
import type { SessionSummary } from '../srs/history';
import { parseCardId, answerTonic } from './cards';
import type { Direction } from './cards';
import type { Mode, PitchClass } from './theory';
import { patternMode } from './theory';
import type { Deck, ReviewEvent } from './types';

export {
  MASTERY_HISTORY_DAYS,
  buildSessionRecord,
  countBuckets,
  currentStreak,
  dailyStats,
  dayKey,
  dayStart,
  formatDuration,
  formatSeconds,
  median,
  overallStats,
  snapshotMastery,
} from '../srs/history';
export type { DayStats, DirectionSplit, OverallStats, SessionSummary } from '../srs/history';

/** One sitting, with the answers split by which of the three questions was asked. */
export function summarizeSession(events: ReviewEvent[]): SessionSummary {
  return summarize(events, (cardId) => parseCardId(cardId)?.direction ?? null);
}

export interface KeyStat {
  tonic: PitchClass;
  mode: Mode;
  seen: number;
  correct: number;
  accuracy: number | null;
  avgMs: number | null;
  /** The weakest card on the key — a key you can name but not produce is not a key you know. */
  bucket: Bucket;
}

const BUCKET_ORDER: Bucket[] = ['new', 'learning', 'young', 'mature'];

/**
 * Collapse the deck onto the twelve keys.
 *
 * Every card is filed under the key of its **answer** — the target of a `transpose` card, the
 * subject of the other two — because that is the fact the card is about and it is the same key
 * `spreadSubjects` holds apart. Cards on one key are combined by taking the weakest of them: a key
 * whose chords you can produce but not recognise is not a key you know, and nor is one you can
 * reach from C but not from E♭.
 *
 * A `transpose` card's *source* key is not represented, exactly as a `pitch` card's other
 * positions are not on the fretboard's heatmap. One card, one square.
 */
export function keyStats(deck: Deck): KeyStat[] {
  const keys = new Map<string, KeyStat>();
  for (const card of Object.values(deck)) {
    const key = parseCardId(card.id);
    if (!key) continue;
    const tonic = answerTonic(key);
    const mode = patternMode(key.pattern);
    const id = `${tonic}:${mode}`;
    const bucket = bucketOf(card);
    const existing = keys.get(id);

    if (!existing) {
      keys.set(id, {
        tonic,
        mode,
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
    const totalMs = (existing.avgMs ?? 0) * existing.seen + (card.seen === 0 ? 0 : card.totalMs);
    keys.set(id, {
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
  return [...keys.values()].sort((a, b) => a.mode.localeCompare(b.mode) || a.tonic - b.tonic);
}

/** How each of the three questions is going, over the whole history rather than one sitting. */
export interface DirectionStat {
  direction: Direction;
  cards: number;
  mastered: number;
  seen: number;
  correct: number;
  accuracy: number | null;
  avgMs: number | null;
}

export function directionStats(deck: Deck): DirectionStat[] {
  const stats = new Map<Direction, DirectionStat & { totalMs: number }>();
  for (const card of Object.values(deck)) {
    const key = parseCardId(card.id);
    if (!key) continue;
    const stat =
      stats.get(key.direction) ??
      {
        direction: key.direction,
        cards: 0,
        mastered: 0,
        seen: 0,
        correct: 0,
        accuracy: null,
        avgMs: null,
        totalMs: 0,
      };
    stat.cards++;
    if (bucketOf(card) === 'mature') stat.mastered++;
    stat.seen += card.seen;
    stat.correct += card.correct;
    stat.totalMs += card.totalMs;
    stats.set(key.direction, stat);
  }
  return [...stats.values()].map(({ totalMs, ...stat }) => ({
    ...stat,
    accuracy: stat.seen === 0 ? null : stat.correct / stat.seen,
    avgMs: stat.seen === 0 ? null : totalMs / stat.seen,
  }));
}

/** Cards, for the callers that only want the deck's own numbers. */
export function deckCards(deck: Deck): Card[] {
  return Object.values(deck);
}
