import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  dailyStats,
  dayKey,
  formatDuration,
  formatSeconds,
  median,
  overallStats,
  positionStats,
  snapshotMastery,
  summarizeSession,
} from './stats';
import { createCard } from '../srs/scheduler';
import type { Card } from '../srs/scheduler';
import type { Deck, MasterySnapshot, ReviewEvent, SessionRecord } from './types';

const DAY = 86_400_000;
// Midday local, so adding and subtracting whole days never crosses a boundary by accident.
const T0 = new Date(2026, 0, 15, 12, 0, 0).getTime();

function event(overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    cardId: 'name:0-5',
    at: T0,
    ms: 2_000,
    correct: true,
    rating: 'good',
    answered: 'A',
    ...overrides,
  };
}

describe('summarizeSession', () => {
  const events = [
    event({ id: 'a', cardId: 'name:0-5', ms: 1_000, rating: 'easy' }),
    event({ id: 'b', cardId: 'find:2-7', ms: 9_000, correct: false, rating: 'again' }),
    event({ id: 'c', cardId: 'find:2-7', ms: 3_000 }),
    event({ id: 'd', cardId: 'name:0-5', ms: 5_000, correct: false, rating: 'again' }),
  ];

  it('counts the answers, not the cards', () => {
    const summary = summarizeSession(events);
    expect(summary.answers).toBe(4);
    expect(summary.cards).toBe(2);
    expect(summary.correct).toBe(2);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.lapses).toBe(2);
  });

  it('measures how long answers took', () => {
    const summary = summarizeSession(events);
    expect(summary.totalMs).toBe(18_000);
    expect(summary.avgMs).toBe(4_500);
    expect(summary.medianMs).toBe(4_000);
    expect(summary.fastestMs).toBe(1_000);
    expect(summary.slowestMs).toBe(9_000);
  });

  it('splits the two directions apart', () => {
    const summary = summarizeSession(events);
    const find = summary.byDirection.find((d) => d.direction === 'find')!;
    expect(find).toMatchObject({ answers: 2, correct: 1, totalMs: 12_000 });
  });

  it('counts a `pitch` card under its own direction', () => {
    const summary = summarizeSession([
      ...events,
      event({ id: 'p', cardId: 'pitch:61', correct: true, ms: 3_000, answered: '2-11' }),
    ]);
    expect(summary.byDirection.find((d) => d.direction === 'pitch')).toMatchObject({
      answers: 1,
      correct: 1,
      totalMs: 3_000,
    });
  });

  it('ranks what was missed, worst first', () => {
    const summary = summarizeSession([...events, event({ id: 'e', correct: false, rating: 'again' })]);
    expect(summary.missed[0]).toEqual({ cardId: 'name:0-5', misses: 2 });
  });

  it('survives an empty sitting', () => {
    expect(summarizeSession([])).toMatchObject({ answers: 0, accuracy: 0, fastestMs: null });
  });
});

describe('median', () => {
  it('averages the middle pair when the count is even', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('dailyStats', () => {
  it('groups by local calendar day and sorts forwards', () => {
    const days = dailyStats([
      event({ id: 'a', at: T0 }),
      event({ id: 'b', at: T0 + 3 * 3_600_000 }), // same day, later
      event({ id: 'c', at: T0 - DAY, correct: false, ms: 6_000 }),
    ]);
    expect(days.map((d) => d.day)).toEqual([dayKey(T0 - DAY), dayKey(T0)]);
    expect(days[1].answers).toBe(2);
    expect(days[0].accuracy).toBe(0);
    expect(days[0].avgMs).toBe(6_000);
  });

  it('has nothing to say about no answers', () => {
    expect(dailyStats([])).toEqual([]);
  });
});

describe('currentStreak', () => {
  const days = (...offsets: number[]) => new Set(offsets.map((o) => dayKey(T0 - o * DAY)));

  it('counts back from today', () => {
    expect(currentStreak(days(0, 1, 2), T0)).toBe(3);
  });

  it('still counts a streak that has not been continued today yet', () => {
    // Resetting at midnight would punish you for not having practised before lunch.
    expect(currentStreak(days(1, 2, 3), T0)).toBe(3);
  });

  it('breaks on a missed day', () => {
    expect(currentStreak(days(0, 2, 3), T0)).toBe(1);
    expect(currentStreak(days(2, 3), T0)).toBe(0);
    expect(currentStreak(new Set(), T0)).toBe(0);
  });
});

describe('snapshotMastery', () => {
  const counts = { new: 10, learning: 4, young: 3, mature: 2 };

  it('keeps one entry per day, the latest', () => {
    const first = snapshotMastery([], counts, T0);
    const second = snapshotMastery(first, { ...counts, mature: 5 }, T0 + 3_600_000);
    expect(second).toHaveLength(1);
    expect(second[0].counts.mature).toBe(5);
  });

  it('keeps the days in order', () => {
    const history = snapshotMastery(snapshotMastery([], counts, T0), counts, T0 - DAY);
    expect(history.map((s) => s.day)).toEqual([dayKey(T0 - DAY), dayKey(T0)]);
  });

  it('drops history past the cap', () => {
    let history: MasterySnapshot[] = [];
    for (let i = 500; i >= 0; i--) history = snapshotMastery(history, counts, T0 - i * DAY);
    expect(history).toHaveLength(400);
    expect(history[history.length - 1].day).toBe(dayKey(T0));
  });
});

describe('positionStats', () => {
  function card(id: string, overrides: Partial<Card>): Card {
    return { ...createCard(id), ...overrides };
  }

  it('puts both directions of a position on one square', () => {
    const deck: Deck = {
      'name:2-7': card('name:2-7', { seen: 4, correct: 4, totalMs: 4_000, status: 'review', intervalDays: 30 }),
      'find:2-7': card('find:2-7', { seen: 6, correct: 3, totalMs: 12_000, status: 'review', intervalDays: 4 }),
    };
    const [square] = positionStats(deck);
    expect(square).toMatchObject({ stringIndex: 2, fret: 7, seen: 10, correct: 7 });
    expect(square.avgMs).toBe(1_600);
  });

  it('takes the weaker direction, whichever way round the deck is read', () => {
    // A position you can read but not find is not a position you know.
    const strong = card('name:2-7', { status: 'review', intervalDays: 30 });
    const weak = card('find:2-7', { status: 'learning' });
    expect(positionStats({ 'name:2-7': strong, 'find:2-7': weak })[0].bucket).toBe('learning');
    expect(positionStats({ 'find:2-7': weak, 'name:2-7': strong })[0].bucket).toBe('learning');
  });

  it('leaves an unseen square without an accuracy rather than calling it zero', () => {
    expect(positionStats({ 'name:0-0': createCard('name:0-0') })[0].accuracy).toBeNull();
  });

  it('leaves `pitch` cards out — they belong to no one square', () => {
    // Three or four places answer a pitch card. Folding it onto all of them would count one
    // card several times over, and onto one of them would be a place it never named.
    const positional = { 'name:2-7': card('name:2-7', { seen: 4, correct: 4, totalMs: 4_000 }) };
    const withPitch: Deck = {
      ...positional,
      'pitch:61': card('pitch:61', { seen: 9, correct: 1, totalMs: 40_000, status: 'learning' }),
    };
    expect(positionStats(withPitch)).toEqual(positionStats(positional));
  });
});

describe('overallStats', () => {
  it('totals the history', () => {
    const sessions: SessionRecord[] = [
      {
        id: 's1',
        startedAt: T0,
        endedAt: T0 + 60_000,
        answers: 2,
        correct: 1,
        totalMs: 8_000,
        cards: 2,
        newIntroduced: 1,
        masteredAfter: 0,
      },
    ];
    const stats = overallStats(
      [event({ id: 'a' }), event({ id: 'b', correct: false, ms: 6_000 })],
      sessions,
      T0
    );
    expect(stats).toMatchObject({ answers: 2, correct: 1, accuracy: 0.5, totalMs: 8_000, sessions: 1, days: 1, streak: 1 });
  });
});

describe('formatting', () => {
  it('keeps a decimal on answer times below ten seconds', () => {
    expect(formatSeconds(1_840)).toBe('1.8s');
    expect(formatSeconds(12_400)).toBe('12s');
  });

  it('writes session lengths in minutes and hours', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(605_000)).toBe('10m 05s');
    expect(formatDuration(3_930_000)).toBe('1h 05m');
  });
});
