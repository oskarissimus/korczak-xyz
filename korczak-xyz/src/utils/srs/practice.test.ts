import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWER_MS,
  MAX_BUCKETS,
  answerMs,
  dayBucket,
  eventsPracticeMs,
  practiceBuckets,
  totalPracticeMs,
  weekBucket,
} from './practice';
import type { ReviewEvent, SessionRecord } from './types';

function session(startedAt: number, totalMs: number, answers = 10): SessionRecord {
  return {
    id: `s${startedAt}`,
    startedAt,
    endedAt: startedAt + totalMs,
    answers,
    correct: answers,
    totalMs,
    cards: answers,
    newIntroduced: 0,
    masteredAfter: 0,
  };
}

function event(ms: number): ReviewEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    cardId: 'find:1-4',
    at: 0,
    ms,
    correct: true,
    rating: 'good',
    answered: 'C',
  };
}

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('answerMs', () => {
  it('passes an ordinary answer through', () => {
    expect(answerMs(4200)).toBe(4200);
  });

  it('caps a card that was left on the screen', () => {
    expect(answerMs(9 * 60 * 60 * 1000)).toBe(MAX_ANSWER_MS);
  });

  it('reads a missing or impossible measurement as nothing', () => {
    expect(answerMs(0)).toBe(0);
    expect(answerMs(-5)).toBe(0);
    expect(answerMs(Number.NaN)).toBe(0);
  });

  it('leaves every real answer well below the cap', () => {
    // The slowest budget `ratingFromAnswer` grades on is 5s a place; six places is 30s.
    expect(answerMs(30_000)).toBe(30_000);
  });
});

describe('totalPracticeMs', () => {
  it('sums the sittings', () => {
    expect(totalPracticeMs([session(at(2026, 8, 1), 60_000), session(at(2026, 8, 2), 90_000)])).toBe(
      150_000
    );
  });

  it('is zero with no history', () => {
    expect(totalPracticeMs([])).toBe(0);
  });
});

describe('eventsPracticeMs', () => {
  it('caps each answer, not the total', () => {
    expect(eventsPracticeMs([event(1000), event(600_000), event(2000)])).toBe(
      3000 + MAX_ANSWER_MS
    );
  });
});

describe('practiceBuckets', () => {
  it('is empty with no sittings', () => {
    expect(practiceBuckets([], 'day')).toEqual([]);
  });

  it('adds up several sittings in one day', () => {
    const buckets = practiceBuckets(
      [session(at(2026, 8, 3, 9), 60_000, 12), session(at(2026, 8, 3, 21), 30_000, 8)],
      'day'
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ ms: 90_000, sessions: 2, answers: 20 });
    expect(buckets[0].at).toBe(dayBucket(at(2026, 8, 3)));
  });

  it('keeps the days nobody practised, so a gap reads as a gap', () => {
    const buckets = practiceBuckets(
      [session(at(2026, 8, 3), 60_000), session(at(2026, 8, 6), 30_000)],
      'day'
    );
    expect(buckets.map((b) => b.ms)).toEqual([60_000, 0, 0, 30_000]);
    expect(buckets.map((b) => b.sessions)).toEqual([1, 0, 0, 1]);
  });

  it('groups a week onto its Monday', () => {
    // 2026-08-05 is a Wednesday; 2026-08-09 the Sunday after it — one week.
    const buckets = practiceBuckets(
      [session(at(2026, 8, 5), 60_000), session(at(2026, 8, 9), 30_000)],
      'week'
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].ms).toBe(90_000);
    expect(new Date(buckets[0].at).getDay()).toBe(1);
    expect(buckets[0].at).toBe(weekBucket(at(2026, 8, 5)));
  });

  it('steps by calendar weeks, filling the ones missed', () => {
    const buckets = practiceBuckets(
      [session(at(2026, 8, 5), 60_000), session(at(2026, 8, 26), 30_000)],
      'week'
    );
    expect(buckets.map((b) => b.ms)).toEqual([60_000, 0, 0, 30_000]);
  });

  it('files a sitting under the day it started in, not the one it ended in', () => {
    const buckets = practiceBuckets([session(at(2026, 8, 3, 23), 90 * 60_000)], 'day');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].at).toBe(dayBucket(at(2026, 8, 3)));
  });

  it('steps a day at a time across a DST boundary', () => {
    // Only bites in a zone that has one — Europe/Warsaw springs forward on 2026-03-29, making that
    // day 23 hours long, while CI runs in UTC and never does. A fixed 86,400,000 ms step lands
    // inside the previous day there and files everything after it one bucket out; asserting the
    // bucket starts are real midnights is what catches it wherever the test happens to run.
    const buckets = practiceBuckets(
      [session(at(2026, 3, 27), 60_000), session(at(2026, 3, 31), 30_000)],
      'day'
    );
    expect(buckets.map((b) => b.ms)).toEqual([60_000, 0, 0, 0, 30_000]);
    for (const bucket of buckets) expect(bucket.at).toBe(dayBucket(bucket.at));
  });

  it('keeps the newest buckets when the history is long and sparse', () => {
    const buckets = practiceBuckets(
      [session(at(2020, 1, 1), 60_000), session(at(2026, 8, 3), 30_000)],
      'day'
    );
    expect(buckets).toHaveLength(MAX_BUCKETS);
    expect(buckets[buckets.length - 1].ms).toBe(30_000);
    expect(buckets[buckets.length - 1].at).toBe(dayBucket(at(2026, 8, 3)));
  });
});
