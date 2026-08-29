/*
 * How long practice has taken, and when it was taken.
 *
 * Two questions, one definition of "time spent" behind both — the lifetime total on a tile, and the
 * per-day figure the practice-time chart draws. They are here together so they cannot come to
 * disagree, which is the same reason `activeTypingMs` is the typing trainer's one definition of a
 * minute typed.
 *
 * **It reads the sittings, not the answer log.** Everything else on a stats page is recomputed from
 * `events` — the deck, the accuracy, the streak — and for those that is right, because the log is
 * the record. It is the wrong source for a lifetime total: `EVENT_CAP` keeps the newest 2000
 * answers locally and `storage.ts` surrenders the older half under quota pressure, so a total folded
 * from events shrinks as the log is pruned and a year of practice quietly becomes three months of
 * it. `SessionRecord` is the durable per-sitting document — written once, capped at `SESSION_CAP`
 * sittings rather than answers, and pulled back from the account — and it already carries the one
 * number wanted, so the total is a sum over it.
 *
 * A mixed sitting writes **two records under one session id**, one per deck, each holding its own
 * half's answering time. So a per-deck total is that deck's own share, and the app-wide total is the
 * two added — no double counting, and nothing to join on.
 *
 * `totalMs` is time spent *answering*, not wall clock: the pause between cards, the 700 ms a correct
 * card stays on screen and however long a verdict is read for are not in it. That is the honest
 * measure of the same thing the typing trainer measures, and it is what makes `MAX_ANSWER_MS`
 * necessary — see below.
 */

import type { ReviewEvent, SessionRecord } from './types';

/**
 * The most one answer may contribute.
 *
 * A card's `ms` is measured from the moment it appeared, and nothing ends that measurement except
 * answering — so a sitting begun and walked away from banks every minute of the walk. Two minutes
 * is far past any real answer (`ratingFromAnswer`'s slowest budget is 5 s a place, so a six-place
 * select-all card is 30 s at its most generous), which is what makes the cap free of consequences
 * elsewhere: it can only ever touch a value already rated `hard`, and never changes a rating.
 *
 * Applied where the event is minted rather than where it is read, so one number reaches the deck,
 * the stored sitting, the day's figure and the total. The typing trainer caps an idle keystroke gap
 * at 3 s for exactly this reason.
 */
export const MAX_ANSWER_MS = 120_000;

/** What one answer contributes to practice time. */
export function answerMs(rawMs: number): number {
  if (!Number.isFinite(rawMs) || rawMs <= 0) return 0;
  return Math.min(rawMs, MAX_ANSWER_MS);
}

/** Lifetime practice time over a deck's sittings. */
export function totalPracticeMs(sessions: SessionRecord[]): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, s.totalMs || 0), 0);
}

/** Practice time over a run of answers — the same measure, where only the log is to hand. */
export function eventsPracticeMs(events: ReviewEvent[]): number {
  return events.reduce((sum, e) => sum + answerMs(e.ms), 0);
}

export type PracticeGrouping = 'day' | 'week';

export interface PracticeBucket {
  /** Local start of the bucket — midnight, or Monday midnight. */
  at: number;
  ms: number;
  sessions: number;
  answers: number;
}

/**
 * How many buckets the chart is given at most, newest kept.
 *
 * The local history is bounded by `SESSION_CAP` sittings and not by age, so one record from three
 * years ago and one from today are a thousand empty days between them — a bar chart of two bars and
 * a desert. Thirteen months of days, or eight years of weeks, is more history than either question
 * on this page is asking.
 */
export const MAX_BUCKETS = 400;

/** Local midnight. */
export function dayBucket(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local Monday midnight. */
export function weekBucket(ts: number): number {
  const d = new Date(ts);
  const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset).getTime();
}

/**
 * The next bucket along.
 *
 * Date arithmetic rather than adding 86,400,000 ms: two days a year are not 24 hours long, and a
 * fixed step drifts an hour across a DST boundary and then files everything after it one bucket out.
 */
function nextBucket(at: number, grouping: PracticeGrouping): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (grouping === 'week' ? 7 : 1)).getTime();
}

/**
 * Practice time per day or per week, **including the buckets with none**.
 *
 * The empty ones are the point: this chart answers "am I practising" as much as "for how long", and
 * a series that skips the days nobody practised draws an unbroken run of bars over a fortnight off.
 *
 * A sitting is filed whole under the bucket it *started* in. A sitting is one act, unlike the typing
 * trainer's session — which is a keystroke log, and so can be split across a midnight it spans.
 */
export function practiceBuckets(
  sessions: SessionRecord[],
  grouping: PracticeGrouping
): PracticeBucket[] {
  if (sessions.length === 0) return [];
  const keyOf = grouping === 'week' ? weekBucket : dayBucket;

  const filled = new Map<number, PracticeBucket>();
  for (const session of sessions) {
    const at = keyOf(session.startedAt);
    const bucket = filled.get(at) ?? { at, ms: 0, sessions: 0, answers: 0 };
    bucket.ms += Math.max(0, session.totalMs || 0);
    bucket.sessions += 1;
    bucket.answers += Math.max(0, session.answers || 0);
    filled.set(at, bucket);
  }

  const first = Math.min(...filled.keys());
  const last = Math.max(...filled.keys());
  const out: PracticeBucket[] = [];
  for (let at = first; at <= last; at = nextBucket(at, grouping)) {
    out.push(filled.get(at) ?? { at, ms: 0, sessions: 0, answers: 0 });
  }
  return out.slice(-MAX_BUCKETS);
}
