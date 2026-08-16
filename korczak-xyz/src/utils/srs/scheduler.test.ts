import { describe, expect, it } from 'vitest';
import {
  DAY,
  MINUTE,
  SRS,
  bucketOf,
  createCard,
  isDue,
  rate,
  ratingFromAnswer,
} from './scheduler';
import type { Card } from './scheduler';

const T0 = 1_700_000_000_000;

function reviewCard(overrides: Partial<Card> = {}): Card {
  return {
    ...createCard('name:0-5'),
    status: 'review',
    intervalDays: 10,
    due: T0,
    reps: 4,
    seen: 4,
    correct: 4,
    ...overrides,
  };
}

describe('ratingFromAnswer', () => {
  it('fails a wrong answer however quickly it came', () => {
    expect(ratingFromAnswer(false, 10)).toBe('again');
    expect(ratingFromAnswer(false, 30_000)).toBe('again');
  });

  it('grades a correct answer on how long it took', () => {
    expect(ratingFromAnswer(true, 900)).toBe('easy');
    expect(ratingFromAnswer(true, SRS.fastMs)).toBe('easy');
    expect(ratingFromAnswer(true, 3_500)).toBe('good');
    expect(ratingFromAnswer(true, SRS.slowMs)).toBe('good');
    expect(ratingFromAnswer(true, 12_000)).toBe('hard');
  });

  it('budgets the time per place asked for, so a select-all card is not always `hard`', () => {
    // Six positions marked in nine seconds is a second and a half each — recalled, not counted
    // up. Against the one-tap budget it would be the slowest possible answer.
    expect(ratingFromAnswer(true, 9_000, 6)).toBe('easy');
    expect(ratingFromAnswer(true, 9_000)).toBe('hard');
    expect(ratingFromAnswer(true, SRS.slowMs * 6, 6)).toBe('good');
    expect(ratingFromAnswer(true, SRS.slowMs * 6 + 1, 6)).toBe('hard');
    // A card asking for nothing is still one answer, not a division by zero.
    expect(ratingFromAnswer(true, 900, 0)).toBe('easy');
  });
});

describe('the learning ladder', () => {
  it('starts a new card on the first step', () => {
    const card = rate(createCard('name:0-5'), 'good', T0, 1_500);
    expect(card.status).toBe('learning');
    expect(card.step).toBe(1);
    expect(card.due).toBe(T0 + SRS.learningSteps[1] * MINUTE);
  });

  it('graduates off the last step', () => {
    const first = rate(createCard('name:0-5'), 'good', T0, 1_500);
    const graduated = rate(first, 'good', T0 + MINUTE, 1_500);
    expect(graduated.status).toBe('review');
    expect(graduated.intervalDays).toBe(SRS.graduatingInterval);
    expect(graduated.due).toBe(T0 + MINUTE + SRS.graduatingInterval * DAY);
  });

  it('graduates a new card outright when it was answered fast', () => {
    const card = rate(createCard('name:0-5'), 'easy', T0, 800);
    expect(card.status).toBe('review');
    expect(card.intervalDays).toBe(SRS.easyInterval);
  });

  it('drops back to the first step on a miss', () => {
    const second = rate(createCard('name:0-5'), 'good', T0, 1_500);
    const missed = rate(second, 'again', T0 + MINUTE, 4_000);
    expect(missed.step).toBe(0);
    expect(missed.due).toBe(T0 + MINUTE + SRS.learningSteps[0] * MINUTE);
    expect(missed.status).toBe('learning');
  });

  it('repeats the current step on a slow answer rather than advancing', () => {
    const card = rate(createCard('name:0-5'), 'hard', T0, 8_000);
    expect(card.step).toBe(0);
    expect(card.due).toBe(T0 + SRS.learningSteps[0] * MINUTE);
  });
});

describe('reviews', () => {
  it('multiplies the interval by the ease', () => {
    const card = rate(reviewCard(), 'good', T0, 1_500);
    expect(card.intervalDays).toBe(25); // 10 x 2.5
    expect(card.due).toBe(T0 + 25 * DAY);
    expect(card.ease).toBe(2.5);
  });

  it('adds a bonus and raises the ease when the answer was instant', () => {
    const card = rate(reviewCard(), 'easy', T0, 800);
    expect(card.ease).toBe(2.65);
    expect(card.intervalDays).toBe(Math.round(10 * 2.65 * SRS.easyBonus));
  });

  it('grows slowly and lowers the ease when the answer was laboured', () => {
    const card = rate(reviewCard(), 'hard', T0, 9_000);
    expect(card.ease).toBe(2.35);
    expect(card.intervalDays).toBe(12);
  });

  it('never lets a correct answer shorten the gap', () => {
    // 1 day x 1.2 rounds back to 1, which would ask the same card again tomorrow forever.
    const card = rate(reviewCard({ intervalDays: 1 }), 'hard', T0, 9_000);
    expect(card.intervalDays).toBe(2);
  });

  it('keeps the ease inside its bounds', () => {
    let card = reviewCard({ ease: SRS.minEase });
    card = rate(card, 'hard', T0, 9_000);
    expect(card.ease).toBe(SRS.minEase);
    let easy = reviewCard({ ease: SRS.maxEase });
    easy = rate(easy, 'easy', T0, 500);
    expect(easy.ease).toBe(SRS.maxEase);
  });

  it('caps the interval', () => {
    const card = rate(reviewCard({ intervalDays: SRS.maxIntervalDays }), 'easy', T0, 500);
    expect(card.intervalDays).toBe(SRS.maxIntervalDays);
  });
});

describe('lapses', () => {
  it('sends a failed review back to relearning without erasing its interval', () => {
    const card = rate(reviewCard(), 'again', T0, 7_000);
    expect(card.status).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(card.ease).toBe(2.3);
    expect(card.due).toBe(T0 + SRS.relearningSteps[0] * MINUTE);
    expect(card.intervalDays).toBe(10);
  });

  it('graduates a relearnt card near where it was, not back at one day', () => {
    const lapsed = rate(reviewCard(), 'again', T0, 7_000);
    const back = rate(lapsed, 'good', T0 + 10 * MINUTE, 2_500);
    expect(back.status).toBe('review');
    expect(back.intervalDays).toBe(5); // half of the ten days it had earnt
  });

  it('counts repeated lapses against the ease', () => {
    let card = reviewCard();
    for (let i = 0; i < 3; i++) {
      card = rate(card, 'again', T0 + i * DAY, 7_000);
      card = rate(card, 'good', T0 + i * DAY + 10 * MINUTE, 2_500);
    }
    expect(card.lapses).toBe(3);
    expect(card.ease).toBeCloseTo(1.9, 5);
  });
});

describe('counters', () => {
  it('records every answer and its time', () => {
    let card = createCard('name:0-5');
    card = rate(card, 'good', T0, 3_000);
    card = rate(card, 'again', T0 + MINUTE, 7_000);
    expect(card.seen).toBe(2);
    expect(card.correct).toBe(1);
    expect(card.totalMs).toBe(10_000);
    expect(card.lastMs).toBe(7_000);
    expect(card.firstReviewedAt).toBe(T0);
    expect(card.lastReviewedAt).toBe(T0 + MINUTE);
  });
});

describe('buckets', () => {
  it('sorts cards by how well they are known', () => {
    expect(bucketOf(createCard('name:0-5'))).toBe('new');
    expect(bucketOf({ ...createCard('name:0-5'), status: 'learning' })).toBe('learning');
    expect(bucketOf(reviewCard({ intervalDays: SRS.matureIntervalDays - 1 }))).toBe('young');
    expect(bucketOf(reviewCard({ intervalDays: SRS.matureIntervalDays }))).toBe('mature');
  });

  it('counts a new card as due whenever there is room for it', () => {
    expect(isDue(createCard('name:0-5'), T0)).toBe(true);
    expect(isDue(reviewCard({ due: T0 + DAY }), T0)).toBe(false);
    expect(isDue(reviewCard({ due: T0 }), T0)).toBe(true);
  });
});
