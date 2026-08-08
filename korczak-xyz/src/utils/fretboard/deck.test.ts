import { describe, expect, it } from 'vitest';
import {
  MIN_POSITION_GAP,
  buildQueue,
  cardsInScope,
  countDeck,
  ensureCards,
  interleave,
  nextDueAt,
  requeue,
  scopeIds,
  shuffle,
  spreadPositions,
} from './deck';
import { DAY, MINUTE, createCard } from './srs';
import type { Card } from './srs';
import type { Deck, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const T0 = 1_700_000_000_000;

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function deckOf(cards: Card[]): Deck {
  return Object.fromEntries(cards.map((c) => [c.id, c]));
}

function scheduled(id: string, due: number, overrides: Partial<Card> = {}): Card {
  return { ...createCard(id), status: 'review', intervalDays: 5, due, ...overrides };
}

/** mulberry32 — a seeded generator, so a shuffled sitting is something a test can pin down. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const sorted = (ids: string[]) => [...ids].sort();

describe('scopeIds', () => {
  it('introduces the open strings before anything above them', () => {
    const ids = scopeIds(settings({ maxFret: 1, strings: [0, 1], directions: ['name'] }));
    expect(ids).toEqual(['name:0-0', 'name:1-0', 'name:0-1', 'name:1-1']);
  });

  it('pairs both directions of a position', () => {
    const ids = scopeIds(settings({ maxFret: 0, strings: [0], directions: ['name', 'find'] }));
    expect(ids).toEqual(['name:0-0', 'find:0-0']);
  });

  it('covers the whole neck in both directions', () => {
    expect(scopeIds(settings({ maxFret: 12 }))).toHaveLength(6 * 13 * 2);
  });

  it('ignores strings that are not on the instrument', () => {
    expect(scopeIds(settings({ maxFret: 0, strings: [0, 9], directions: ['name'] }))).toEqual([
      'name:0-0',
    ]);
  });
});

describe('ensureCards', () => {
  it('adds the missing cards and leaves the rest alone', () => {
    const existing = scheduled('name:0-0', T0);
    const deck = ensureCards(deckOf([existing]), ['name:0-0', 'name:0-1']);
    expect(deck['name:0-0']).toBe(existing);
    expect(deck['name:0-1'].status).toBe('new');
  });

  it('is a no-op when nothing is missing', () => {
    const deck = deckOf([createCard('name:0-0')]);
    expect(ensureCards(deck, ['name:0-0'])).toBe(deck);
  });

  it('keeps cards that have fallen out of scope', () => {
    // Narrowing the fret range must not throw away a schedule you spent weeks building.
    const deck = ensureCards(deckOf([scheduled('name:0-9', T0)]), ['name:0-0']);
    expect(deck['name:0-9']).toBeDefined();
    expect(cardsInScope(deck, settings({ maxFret: 0, strings: [0], directions: ['name'] })))
      .toHaveLength(1);
  });
});

describe('interleave', () => {
  it('spreads the shorter list through the longer one', () => {
    expect(interleave(['r1', 'r2', 'r3', 'r4'], ['n1', 'n2'])).toEqual([
      'n1',
      'r1',
      'r2',
      'n2',
      'r3',
      'r4',
    ]);
  });

  it('keeps every element exactly once', () => {
    const merged = interleave(['a', 'b', 'c'], ['x', 'y', 'z', 'w']);
    expect([...merged].sort()).toEqual(['a', 'b', 'c', 'w', 'x', 'y', 'z']);
  });

  it('handles an empty side', () => {
    expect(interleave([], ['n'])).toEqual(['n']);
    expect(interleave(['r'], [])).toEqual(['r']);
  });
});

describe('buildQueue', () => {
  const scope = settings({ maxFret: 2, strings: [0], directions: ['name'], newPerSession: 2 });
  const rng = () => seeded(7);

  it('leads with cards that are mid-acquisition', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 - DAY),
      { ...createCard('name:0-1'), status: 'learning', due: T0 - MINUTE },
      createCard('name:0-2'),
    ]);
    expect(buildQueue(deck, scope, T0, { rng: rng() })[0]).toBe('name:0-1');
  });

  it('leaves cards that are not due yet alone', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 + DAY),
      scheduled('name:0-1', T0 - DAY),
      scheduled('name:0-2', T0 + 2 * DAY),
    ]);
    expect(buildQueue(deck, scope, T0, { rng: rng() })).toEqual(['name:0-1']);
  });

  it('takes the most overdue reviews when it cannot take them all', () => {
    // Which cards a capped sitting draws is still decided by due date - the order it asks them
    // in is the only thing the shuffle touches.
    const deck = deckOf([
      scheduled('name:0-0', T0 - DAY),
      scheduled('name:0-1', T0 - 3 * DAY),
      scheduled('name:0-2', T0 - 2 * DAY),
    ]);
    const queue = buildQueue(deck, { ...scope, sessionLength: 2 }, T0, { rng: rng() });
    expect(sorted(queue)).toEqual(['name:0-1', 'name:0-2']);
  });

  it('asks the same cards in a different order from one sitting to the next', () => {
    // The complaint this exists to answer: every sitting used to walk the strings in turn.
    const deck = deckOf(
      Array.from({ length: 12 }, (_, i) => scheduled(`name:${i % 6}-${i % 3}`, T0 - i * MINUTE))
    );
    const scopeAll = settings({ maxFret: 2, sessionLength: 12 });
    const orders = new Set<string>();
    const contents = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const queue = buildQueue(deck, scopeAll, T0, { rng: seeded(seed) });
      orders.add(queue.join(','));
      contents.add(sorted(queue).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
    // Same sitting, different running order - nothing is added or dropped by shuffling.
    expect(contents.size).toBe(1);
  });

  it('draws new cards from the whole range, not the first few on the neck', () => {
    const wide = settings({ maxFret: 12, directions: ['name'], newPerSession: 3 });
    const deck = ensureCards({}, scopeIds(wide));
    const introduced = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const id of buildQueue(deck, wide, T0, { rng: seeded(seed) })) introduced.add(id);
    }
    // Scope order would introduce the same three every time; the range holds 78.
    expect(introduced.size).toBeGreaterThan(20);
  });

  it('caps how many unseen cards one sitting introduces', () => {
    const wide = settings({ maxFret: 12, strings: [0], directions: ['name'], newPerSession: 3 });
    expect(buildQueue(ensureCards({}, scopeIds(wide)), wide, T0, { rng: rng() })).toHaveLength(3);
  });

  it('caps the sitting itself', () => {
    const deck = deckOf(
      Array.from({ length: 30 }, (_, i) => scheduled(`name:0-${i % 13}`, T0 - i * MINUTE))
    );
    const queue = buildQueue(deck, settings({ maxFret: 12, strings: [0], sessionLength: 5 }), T0, {
      rng: rng(),
    });
    expect(queue).toHaveLength(5);
  });

  it('is empty when nothing is due', () => {
    const deck = deckOf([scheduled('name:0-0', T0 + DAY)]);
    expect(buildQueue(deck, scope, T0, { rng: rng() })).toEqual([]);
  });

  it('draws the nearest cards when asked to practise ahead of schedule', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 + 3 * DAY),
      scheduled('name:0-1', T0 + DAY),
      scheduled('name:0-2', T0 + 2 * DAY),
      scheduled('name:0-3', T0 + 9 * DAY),
    ]);
    const queue = buildQueue(deck, { ...scope, maxFret: 3, sessionLength: 3 }, T0, {
      ahead: true,
      rng: rng(),
    });
    expect(sorted(queue)).toEqual(['name:0-0', 'name:0-1', 'name:0-2']);
  });

  it('keeps the two directions of a position apart', () => {
    const wide = settings({ maxFret: 5, newPerSession: 12, sessionLength: 12 });
    const deck = ensureCards({}, scopeIds(wide));
    for (let seed = 1; seed <= 20; seed++) {
      const queue = buildQueue(deck, wide, T0, { rng: seeded(seed) });
      const positions = queue.map((id) => id.split(':')[1]);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).not.toBe(positions[i - 1]);
      }
    }
  });
});

describe('shuffle', () => {
  it('keeps every element', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(sorted(shuffle(items, seeded(3)))).toEqual(sorted(items));
  });

  it('leaves the input alone', () => {
    const items = ['a', 'b', 'c'];
    shuffle(items, seeded(3));
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('is reproducible from a seed and varies between seeds', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(shuffle(items, seeded(11))).toEqual(shuffle(items, seeded(11)));
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) => shuffle(items, seeded(i + 1)).join(''))
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('handles nothing and one thing', () => {
    expect(shuffle([], seeded(1))).toEqual([]);
    expect(shuffle(['a'], seeded(1))).toEqual(['a']);
  });
});

describe('spreadPositions', () => {
  it('separates the two directions of one position', () => {
    // Back to back, the second is answered off the first - and lands in the log as a fast,
    // correct answer that was never really demonstrated.
    const queue = ['name:0-0', 'find:0-0', 'name:2-7', 'find:2-7'];
    const spread = spreadPositions(queue);
    const positions = spread.map((id) => id.split(':')[1]);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).not.toBe(positions[i - 1]);
    }
  });

  it('keeps every card', () => {
    const queue = ['name:0-0', 'find:0-0', 'name:2-7', 'find:2-7', 'name:1-3'];
    expect(sorted(spreadPositions(queue))).toEqual(sorted(queue));
  });

  it('leaves a queue that is already spread out alone', () => {
    const queue = ['name:0-0', 'name:1-1', 'name:2-2', 'name:3-3'];
    expect(spreadPositions(queue)).toEqual(queue);
  });

  it('terminates when no arrangement can satisfy the gap', () => {
    // Two cards, one position: there is nowhere for the second to go.
    const queue = ['name:0-0', 'find:0-0'];
    expect(sorted(spreadPositions(queue, MIN_POSITION_GAP))).toEqual(sorted(queue));
  });

  it('handles an empty queue', () => {
    expect(spreadPositions([])).toEqual([]);
  });
});

describe('requeue', () => {
  // Cards not yet attempted this sitting have nothing scheduled and report 0.
  const dueOf = (dues: Record<string, number>) => (id: string) => dues[id] ?? 0;

  it('puts the card behind everything that wants asking sooner', () => {
    const queue = ['a', 'b', 'c', 'd'];
    expect(requeue(queue, 0, 'a', T0 + MINUTE, dueOf({}))).toEqual(['a', 'b', 'c', 'd', 'a']);
  });

  it('puts it in front of cards scheduled later than it', () => {
    const queue = ['a', 'b', 'c', 'd'];
    const dues = { b: 0, c: T0 + 10 * MINUTE, d: T0 + 10 * MINUTE };
    expect(requeue(queue, 0, 'a', T0 + MINUTE, dueOf(dues))).toEqual(['a', 'b', 'a', 'c', 'd']);
  });

  it('never asks the same card twice in a row', () => {
    // The answer is still on the screen you just read.
    const queue = ['a', 'b', 'c'];
    const dues = { b: T0 + 10 * MINUTE, c: T0 + 10 * MINUTE };
    expect(requeue(queue, 0, 'a', T0 + MINUTE, dueOf(dues))).toEqual(['a', 'b', 'a', 'c']);
  });

  it('lands at the end when there is nowhere later to go', () => {
    expect(requeue(['a', 'b'], 1, 'b', T0 + MINUTE, dueOf({}))).toEqual(['a', 'b', 'b']);
  });

  it('keeps the sitting moving when every card is being missed', () => {
    // A fixed gap deadlocks here: each missed card re-inserts itself the same few places
    // ahead, the same handful cycle forever, and the rest of the queue is never reached. This
    // is that run — six cards, all missed, each miss scheduled a minute out.
    let queue = ['a', 'b', 'c', 'd', 'e', 'f'];
    const dues: Record<string, number> = {};
    const seen = new Set<string>();
    for (let i = 0; i < 12 && i < queue.length; i++) {
      const id = queue[i];
      seen.add(id);
      const due = T0 + (i + 1) * MINUTE; // each miss is scheduled after the previous one
      dues[id] = due;
      queue = requeue(queue, i, id, due, dueOf(dues));
    }
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('counting', () => {
  it('splits the deck by how well each card is known', () => {
    const deck = deckOf([
      createCard('name:0-0'),
      { ...createCard('name:0-1'), status: 'learning', due: T0 - MINUTE },
      scheduled('name:0-2', T0 + DAY, { intervalDays: 30 }),
    ]);
    const counts = countDeck(cardsInScope(deck, settings({ maxFret: 2, strings: [0], directions: ['name'] })), T0);
    expect(counts).toEqual({
      total: 3,
      due: 1,
      fresh: 1,
      buckets: { new: 1, learning: 1, young: 0, mature: 1 },
    });
  });

  it('reports when the next card comes round', () => {
    const cards = [scheduled('name:0-0', T0 + 2 * DAY), scheduled('name:0-1', T0 + DAY)];
    expect(nextDueAt(cards, T0)).toBe(T0 + DAY);
    expect(nextDueAt([...cards, scheduled('name:0-2', T0 - DAY)], T0)).toBe(T0);
    expect(nextDueAt([createCard('name:0-0')], T0)).toBeNull();
  });
});
