/*
 * Spaced repetition — SM-2 with learning steps, the shape Anki uses.
 *
 * Plain SM-2 has one dial (ease) and one unit (days), which is wrong at both ends for this
 * deck. A position you have never seen must come back inside the same sitting, not tomorrow,
 * so new and lapsed cards walk a short ladder of minute-scale steps before they graduate to
 * day-scale intervals. And a position you have just failed must not be treated as merely
 * "slower": it goes back to the ladder, which is what makes the deck feel responsive when
 * one string keeps catching you out.
 *
 * Every function here is pure and takes `now`, because the whole module is about time and a
 * scheduler that reads the clock itself cannot be tested.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type CardStatus = 'new' | 'learning' | 'review' | 'relearning';

export interface Card {
  id: string;
  status: CardStatus;
  /** Position on the learning (or relearning) ladder. Meaningless for `review`. */
  step: number;
  /** SM-2 ease factor: the multiplier a `good` answer applies to the interval. */
  ease: number;
  /** Current review interval in days. Kept across a lapse so relearning can graduate near it. */
  intervalDays: number;
  /** When the card next wants to be asked, epoch ms. */
  due: number;
  reps: number;
  lapses: number;
  seen: number;
  correct: number;
  totalMs: number;
  lastMs: number | null;
  lastReviewedAt: number | null;
  firstReviewedAt: number | null;
}

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export const SRS = {
  /** Minutes between the rungs a new card climbs before it graduates. */
  learningSteps: [1, 10],
  /** The shorter ladder a lapsed card climbs. */
  relearningSteps: [10],
  /** Days until a freshly graduated card returns. */
  graduatingInterval: 1,
  /** Days for a card graduated by answering `easy` outright. */
  easyInterval: 4,
  startingEase: 2.5,
  minEase: 1.3,
  maxEase: 3.5,
  /** `easy` multiplies the interval by ease *and* this. */
  easyBonus: 1.3,
  /** `hard` grows the interval by this instead of by ease. */
  hardFactor: 1.2,
  /** What a lapsed card keeps of its interval when it graduates again. */
  lapseFactor: 0.5,
  maxIntervalDays: 365,
  /** At or above this, a card counts as mastered — Anki's "mature" line. */
  matureIntervalDays: 21,
  /** Answers at or under this many ms are `easy`: recalled, not worked out. */
  fastMs: 2_000,
  /** Past this, a correct answer was arithmetic. Anything slower is `hard`. */
  slowMs: 5_000,
} as const;

export function createCard(id: string): Card {
  return {
    id,
    status: 'new',
    step: 0,
    ease: SRS.startingEase,
    intervalDays: 0,
    due: 0, // a new card is due whenever the session has room for it
    reps: 0,
    lapses: 0,
    seen: 0,
    correct: 0,
    totalMs: 0,
    lastMs: null,
    lastReviewedAt: null,
    firstReviewedAt: null,
  };
}

/**
 * Turn an answer into a rating.
 *
 * The pad answers for you: correctness is objective, and among correct answers the only thing
 * left to grade on is how long it took. Under two seconds the note was known; past five it was
 * counted up from an open string, which is a real answer and a card that should come back soon.
 *
 * `targets` is how many places the card asked for, and the thresholds are **per place**: a
 * select-all card wanting six positions cannot be marked in two seconds by anyone, so measuring
 * it against the one-tap budget would grade every answer to it `hard` and hold the whole
 * direction at day one forever. A budget per position asks the same question of both — was each
 * one recalled or worked out — and leaves the ordinary card, which has one, exactly as it was.
 */
export function ratingFromAnswer(correct: boolean, elapsedMs: number, targets = 1): Rating {
  if (!correct) return 'again';
  const budget = Math.max(1, targets);
  if (elapsedMs <= SRS.fastMs * budget) return 'easy';
  if (elapsedMs <= SRS.slowMs * budget) return 'good';
  return 'hard';
}

function clampEase(ease: number): number {
  return Math.min(SRS.maxEase, Math.max(SRS.minEase, Math.round(ease * 100) / 100));
}

function clampInterval(days: number): number {
  return Math.min(SRS.maxIntervalDays, Math.max(1, Math.round(days)));
}

function stepsFor(status: CardStatus): readonly number[] {
  return status === 'relearning' ? SRS.relearningSteps : SRS.learningSteps;
}

function graduate(card: Card, rating: Rating, now: number): Card {
  // A lapsed card does not start over from one day: it keeps half of what it had earnt, which
  // is the difference between forgetting one position and losing a fortnight of the deck.
  const base =
    card.status === 'relearning'
      ? clampInterval(card.intervalDays * SRS.lapseFactor)
      : SRS.graduatingInterval;
  const intervalDays = rating === 'easy' ? Math.max(base, SRS.easyInterval) : base;
  return {
    ...card,
    status: 'review',
    step: 0,
    intervalDays,
    due: now + intervalDays * DAY,
  };
}

function rateLearning(card: Card, rating: Rating, now: number): Card {
  const steps = stepsFor(card.status);
  if (rating === 'easy') return graduate(card, rating, now);
  if (rating === 'again') {
    return { ...card, step: 0, due: now + steps[0] * MINUTE };
  }
  if (rating === 'hard') {
    // Stay on the rung. The card is not going backwards, but it has not earnt the next one.
    const step = Math.min(card.step, steps.length - 1);
    return { ...card, step, due: now + steps[step] * MINUTE };
  }
  const step = card.step + 1;
  if (step >= steps.length) return graduate(card, rating, now);
  return { ...card, step, due: now + steps[step] * MINUTE };
}

function rateReview(card: Card, rating: Rating, now: number): Card {
  if (rating === 'again') {
    return {
      ...card,
      status: 'relearning',
      step: 0,
      lapses: card.lapses + 1,
      ease: clampEase(card.ease - 0.2),
      // The interval is not applied now — it is what `graduate` will halve when the card
      // climbs back out. Keeping it is what stops a lapse erasing the card's whole history.
      due: now + SRS.relearningSteps[0] * MINUTE,
    };
  }

  const ease =
    rating === 'hard' ? clampEase(card.ease - 0.15) : rating === 'easy' ? clampEase(card.ease + 0.15) : card.ease;

  const grown =
    rating === 'hard'
      ? card.intervalDays * SRS.hardFactor
      : rating === 'easy'
        ? card.intervalDays * ease * SRS.easyBonus
        : card.intervalDays * ease;

  // Always at least a day longer than last time: a correct answer must never shorten the gap,
  // and rounding a 1-day interval by a 1.2 factor otherwise lands back on 1.
  const intervalDays = Math.min(SRS.maxIntervalDays, Math.max(card.intervalDays + 1, clampInterval(grown)));

  return { ...card, ease, intervalDays, due: now + intervalDays * DAY };
}

/**
 * Apply one answer to a card.
 *
 * `elapsedMs` is recorded on the card as well as consumed by the rating, because the answer
 * time is the second thing this game measures and the per-position averages come from here.
 */
export function rate(card: Card, rating: Rating, now: number, elapsedMs: number): Card {
  const counted: Card = {
    ...card,
    reps: card.reps + 1,
    seen: card.seen + 1,
    correct: card.correct + (rating === 'again' ? 0 : 1),
    totalMs: card.totalMs + Math.max(0, elapsedMs),
    lastMs: Math.max(0, elapsedMs),
    lastReviewedAt: now,
    firstReviewedAt: card.firstReviewedAt ?? now,
  };

  if (counted.status === 'review') return rateReview(counted, rating, now);
  // A new card becomes a learning card the moment it is answered.
  return rateLearning({ ...counted, status: counted.status === 'new' ? 'learning' : counted.status }, rating, now);
}

export type Bucket = 'new' | 'learning' | 'young' | 'mature';

export function bucketOf(card: Card): Bucket {
  if (card.status === 'new') return 'new';
  if (card.status === 'review') {
    return card.intervalDays >= SRS.matureIntervalDays ? 'mature' : 'young';
  }
  return 'learning';
}

export function isMastered(card: Card): boolean {
  return bucketOf(card) === 'mature';
}

export function isDue(card: Card, now: number): boolean {
  return card.status === 'new' || card.due <= now;
}

/** Whether the card wants to be seen again before this sitting is over. */
export function isDueWithin(card: Card, now: number, windowMs: number): boolean {
  return card.status !== 'new' && card.due <= now + windowMs;
}

export function accuracyOf(card: Card): number | null {
  return card.seen === 0 ? null : card.correct / card.seen;
}

export function averageMsOf(card: Card): number | null {
  return card.seen === 0 ? null : card.totalMs / card.seen;
}
