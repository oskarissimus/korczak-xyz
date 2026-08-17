import { describe, expect, it } from 'vitest';
import { DAY, MINUTE, createCard } from '../srs/scheduler';
import type { Card } from '../srs/scheduler';
import type { QueueShape } from '../srs/queue';
import { buildQueue as fretboardQueue, positionSubject, scopeIds as fretboardScope } from '../fretboard/deck';
import { DEFAULT_SETTINGS as FRETBOARD_DEFAULTS } from '../fretboard/types';
import { cardSubject, scopeIds as transposeScope } from '../transpose/deck';
import { DEFAULT_SETTINGS as TRANSPOSE_DEFAULTS } from '../transpose/types';
import { MIN_MIXED_GAP, buildMixedQueue } from './mix';
import type { MixSource } from './mix';
import { unqualify } from './trainers';

const T0 = 1_700_000_000_000;

/** mulberry32, so a sitting's order is something a test can pin. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shape(overrides: Partial<QueueShape> = {}): QueueShape {
  return { sessionLength: 20, newPerSession: 6, ...overrides };
}

function scheduled(id: string, due: number): Card {
  return { ...createCard(id), status: 'review', intervalDays: 5, due };
}

const NECK = fretboardScope({
  ...FRETBOARD_DEFAULTS,
  maxFret: 5,
  strings: [0, 1],
  directions: ['name', 'find'],
});
const CHORDS = transposeScope(
  { ...TRANSPOSE_DEFAULTS, directions: ['degrees', 'key'], patterns: ['145'], notations: ['polish'] },
  {}
);

function neck(cards: Card[]): MixSource {
  return { trainer: 'fretboard', cards, subjectOf: positionSubject };
}
function chords(cards: Card[]): MixSource {
  return { trainer: 'transpose', cards, subjectOf: cardSubject };
}

const trainers = (queue: string[]) => queue.map((id) => unqualify(id)?.trainer);

describe('buildMixedQueue', () => {
  it('returns qualified ids and nothing else', () => {
    const queue = buildMixedQueue(
      [neck(NECK.map(createCard)), chords(CHORDS.map(createCard))],
      shape(),
      T0,
      { rng: seeded(1) }
    );
    expect(queue.length).toBeGreaterThan(0);
    for (const id of queue) expect(unqualify(id)).not.toBeNull();
  });

  it('draws from both decks in one sitting', () => {
    const queue = buildMixedQueue(
      [neck(NECK.map(createCard)), chords(CHORDS.map(createCard))],
      shape({ sessionLength: 20, newPerSession: 20 }),
      T0,
      { rng: seeded(4) }
    );
    expect(new Set(trainers(queue))).toEqual(new Set(['fretboard', 'transpose']));
  });

  /*
   * The reason this is one `buildQueue` call rather than two queues interleaved. Selection is by due
   * date across the whole sitting, so a deck left alone fills it and a deck that is caught up
   * contributes nothing — which is the scheduler being obeyed, not overruled.
   */
  it('gives the sitting to whichever deck has waited longest', () => {
    const stale = NECK.map((id) => scheduled(id, T0 - 30 * DAY));
    const fresh = CHORDS.map((id) => scheduled(id, T0 - MINUTE));
    const queue = buildMixedQueue(
      [neck(stale), chords(fresh)],
      shape({ sessionLength: 8, newPerSession: 0 }),
      T0,
      { rng: seeded(9) }
    );
    expect(queue).toHaveLength(8);
    expect(new Set(trainers(queue))).toEqual(new Set(['fretboard']));
  });

  it('leaves out a deck with nothing due, without leaving the sitting short', () => {
    const due = NECK.map((id) => scheduled(id, T0 - DAY));
    const later = CHORDS.map((id) => scheduled(id, T0 + 30 * DAY));
    const queue = buildMixedQueue(
      [neck(due), chords(later)],
      shape({ sessionLength: 6, newPerSession: 0 }),
      T0,
      { rng: seeded(2) }
    );
    expect(queue).toHaveLength(6);
    expect(trainers(queue).every((t) => t === 'fretboard')).toBe(true);
  });

  it('holds apart cards about the same place, within a trainer', () => {
    // `name:0-3` and `find:0-3` are the case `spreadPositions` exists for, and mixing must not
    // lose it — a subject arriving from the other deck is not an excuse to put them side by side.
    const queue = buildMixedQueue(
      [neck(NECK.map(createCard)), chords(CHORDS.map(createCard))],
      shape({ sessionLength: 40, newPerSession: 40 }),
      T0,
      { rng: seeded(11) }
    );
    const subjects = queue.map((id) => {
      const split = unqualify(id)!;
      const own = split.trainer === 'fretboard' ? positionSubject : cardSubject;
      return `${split.trainer}|${own(split.cardId)}`;
    });
    for (let i = 1; i < subjects.length; i++) {
      expect(subjects[i]).not.toBe(subjects[i - 1]);
    }
    expect(MIN_MIXED_GAP).toBe(3);
  });

  /*
   * The other half of that: a neck card and a chord card cannot give each other away, so they are
   * not spread against each other. Two decks that shared a subject namespace would push apart
   * cards that were already fine, and the clumping it bought would land on the ones that were not.
   */
  it('does not hold a neck card apart from a chord card', () => {
    const both = buildMixedQueue(
      [neck([createCard('name:0-3')]), chords([createCard('degrees:0:145')])],
      shape(),
      T0,
      { rng: seeded(1) }
    );
    expect(both).toHaveLength(2);
  });

  it('is a permutation of what a single deck would have drawn on its own', () => {
    const deck = Object.fromEntries(NECK.map((id) => [id, scheduled(id, T0 - DAY)]));
    const settings = {
      ...FRETBOARD_DEFAULTS,
      maxFret: 5,
      strings: [0, 1],
      directions: ['name' as const, 'find' as const],
    };
    const alone = fretboardQueue(deck, settings, shape({ newPerSession: 0 }), T0, {
      rng: seeded(6),
    });
    const mixed = buildMixedQueue([neck(Object.values(deck))], shape({ newPerSession: 0 }), T0, {
      rng: seeded(6),
    });
    expect(mixed.map((id) => unqualify(id)!.cardId).sort()).toEqual([...alone].sort());
  });

  it('is shuffled, and reproducible from its generator', () => {
    const sources = () => [neck(NECK.map(createCard)), chords(CHORDS.map(createCard))];
    const a = buildMixedQueue(sources(), shape({ newPerSession: 20 }), T0, { rng: seeded(1) });
    const b = buildMixedQueue(sources(), shape({ newPerSession: 20 }), T0, { rng: seeded(77) });
    expect(a).not.toEqual(b);
    expect(buildMixedQueue(sources(), shape({ newPerSession: 20 }), T0, { rng: seeded(1) })).toEqual(a);
  });

  it('draws the nearest cards from both decks when asked to practise ahead', () => {
    const queue = buildMixedQueue(
      [
        neck(NECK.map((id) => scheduled(id, T0 + 10 * DAY))),
        chords(CHORDS.map((id) => scheduled(id, T0 + DAY))),
      ],
      shape({ sessionLength: 5, newPerSession: 0 }),
      T0,
      { ahead: true, rng: seeded(3) }
    );
    expect(queue).toHaveLength(5);
    // The chord cards fall due first, so practising ahead reaches for those.
    expect(trainers(queue).every((t) => t === 'transpose')).toBe(true);
  });

  it('is empty when neither deck has anything to ask', () => {
    const queue = buildMixedQueue(
      [
        neck(NECK.map((id) => scheduled(id, T0 + DAY))),
        chords(CHORDS.map((id) => scheduled(id, T0 + DAY))),
      ],
      shape({ newPerSession: 0 }),
      T0,
      { rng: seeded(1) }
    );
    expect(queue).toEqual([]);
  });

  it('leaves the cards it was handed untouched', () => {
    // The qualified ids are made on copies: the deck the caller holds is the one the trainer's own
    // storage and stats read, and an id rewritten in place there would reach localStorage.
    const cards = NECK.map(createCard);
    buildMixedQueue([neck(cards)], shape(), T0, { rng: seeded(1) });
    expect(cards.map((c) => c.id)).toEqual(NECK);
  });
});
