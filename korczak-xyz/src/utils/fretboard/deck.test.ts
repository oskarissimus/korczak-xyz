import { describe, expect, it } from 'vitest';
import {
  buildQueue,
  cardsInScope,
  countDeck,
  ensureCards,
  interleave,
  nextDueAt,
  requeue,
  scopeIds,
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

  it('leads with cards that are mid-acquisition', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 - DAY),
      { ...createCard('name:0-1'), status: 'learning', due: T0 - MINUTE },
      createCard('name:0-2'),
    ]);
    expect(buildQueue(deck, scope, T0)[0]).toBe('name:0-1');
  });

  it('leaves cards that are not due yet alone', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 + DAY),
      scheduled('name:0-1', T0 - DAY),
      scheduled('name:0-2', T0 + 2 * DAY),
    ]);
    expect(buildQueue(deck, scope, T0)).toEqual(['name:0-1']);
  });

  it('takes the most overdue reviews first', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 - DAY),
      scheduled('name:0-1', T0 - 3 * DAY),
      scheduled('name:0-2', T0 - 2 * DAY),
    ]);
    expect(buildQueue(deck, scope, T0)).toEqual(['name:0-1', 'name:0-2', 'name:0-0']);
  });

  it('caps how many unseen cards one sitting introduces', () => {
    const deck = ensureCards({}, scopeIds(settings({ maxFret: 12, strings: [0], directions: ['name'] })));
    const queue = buildQueue(deck, settings({ ...scope, maxFret: 12, newPerSession: 3 }), T0);
    expect(queue).toHaveLength(3);
  });

  it('caps the sitting itself', () => {
    const deck = deckOf(
      Array.from({ length: 30 }, (_, i) => scheduled(`name:0-${i % 13}`, T0 - i * MINUTE))
    );
    const queue = buildQueue(deck, settings({ maxFret: 12, strings: [0], sessionLength: 5 }), T0);
    expect(queue).toHaveLength(5);
  });

  it('is empty when nothing is due', () => {
    const deck = deckOf([scheduled('name:0-0', T0 + DAY)]);
    expect(buildQueue(deck, scope, T0)).toEqual([]);
  });

  it('draws the nearest cards when asked to practise ahead of schedule', () => {
    const deck = deckOf([
      scheduled('name:0-0', T0 + 3 * DAY),
      scheduled('name:0-1', T0 + DAY),
      scheduled('name:0-2', T0 + 2 * DAY),
    ]);
    expect(buildQueue(deck, scope, T0, { ahead: true })).toEqual([
      'name:0-1',
      'name:0-2',
      'name:0-0',
    ]);
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
