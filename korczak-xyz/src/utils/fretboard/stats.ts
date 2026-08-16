/*
 * What the fretboard's own numbers are: the heatmap, and reading a direction out of a card id.
 *
 * Everything that is true of any deck — the day keys, the session summary, the mastery snapshots,
 * the streak — is in `src/utils/srs/history.ts` and re-exported here, so the rest of this app has
 * one place to import from. What is left below is the part that has to know a card id names a
 * square on a neck.
 */

import { isPositionKey, parseCardId } from './notes';
import type { Bucket, Card } from '../srs/scheduler';
import { bucketOf } from '../srs/scheduler';
import { summarizeSession as summarize } from '../srs/history';
import type { SessionSummary } from '../srs/history';
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

/**
 * One sitting, with the answers split by which way round the cards asked.
 *
 * The split is the only part of a summary that needs to read a card id, and reading one is this
 * app's business — hence the callback rather than a parser in the shared module.
 */
export function summarizeSession(events: ReviewEvent[]): SessionSummary {
  return summarize(events, (cardId) => parseCardId(cardId)?.direction ?? null);
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
