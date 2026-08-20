import { describe, expect, it } from 'vitest';
import { createCard, rate } from '../srs/scheduler';
import { orderingsOf, parseCardId } from './cards';
import {
  asksMode,
  buildQueue,
  cardsInScope,
  countDeck,
  effectiveTonics,
  ensureCards,
  scopeIds,
  spreadSubjects,
  tonicsFor,
} from './deck';
import type { LibraryIndex } from './library';
import type { QueueShape } from '../srs/queue';
import type { Deck, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const NO_LIBRARY: LibraryIndex = {};

/** How many cards one (tonic, pattern, direction, notation) is worth, now that ordering is an axis. */
const ORDERS_145 = 6;

/** A library with I IV V in C, G and A only — enough to tell the two scopes apart. */
const LIBRARY: LibraryIndex = {
  '0:145': [{ title: 'Sto lat', author: 'trad.', slug: 'sto-lat' }],
  '7:145': [{ title: 'Wish You Were Here', author: 'Pink Floyd', slug: 'wish-you-were-here' }],
  '9:145': [{ title: 'Za daleko', author: 'Elektryczne Gitary', slug: 'za-daleko' }],
};

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** The sitting's shape, which is the merged app's rather than this deck's. */
function shape(overrides: Partial<QueueShape> = {}): QueueShape {
  return { sessionLength: 20, newPerSession: 6, ...overrides };
}

/** A seeded generator, so a sitting's order is something a test can pin. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('scopeIds', () => {
  it('mints every permutation of the directions in scope', () => {
    const ids = scopeIds(
      settings({ directions: ['transpose'], patterns: ['145'], notations: ['polish'] }),
      NO_LIBRARY
    );
    // 12 keys into the other 11, never into itself, and every ordering of each.
    expect(ids).toHaveLength(12 * 11 * ORDERS_145);
    expect(ids).not.toContain('transpose:3-3:145');
    expect(ids).not.toContain('transpose:3-3:145:o201');
  });

  it('mints one card per key for the other two directions', () => {
    const ids = scopeIds(
      settings({ directions: ['degrees', 'key'], patterns: ['145'], notations: ['polish'] }),
      NO_LIBRARY
    );
    expect(ids).toHaveLength(24 * ORDERS_145);
  });

  it('mints every ordering of a card, and only orderings of the right length', () => {
    const ids = scopeIds(
      settings({ directions: ['key'], patterns: ['145', '1456'], notations: ['polish'] }),
      NO_LIBRARY
    );
    const of145 = ids.filter((id) => parseCardId(id)!.pattern === '145');
    const of1456 = ids.filter((id) => parseCardId(id)!.pattern === '1456');
    expect(of145).toHaveLength(12 * 6);
    expect(of1456).toHaveLength(12 * 24);

    // The identity is in there unsuffixed — the card every stored deck already names.
    expect(of145).toContain('key:0:145');
    expect(of145).toContain('key:0:145:o201');
    expect(of145).not.toContain('key:0:145:o012');
  });

  it('leads with degree order, so the deck someone already has comes first', () => {
    expect(orderingsOf('145')[0]).toEqual([0, 1, 2]);
    const ids = scopeIds(
      settings({ directions: ['key'], patterns: ['145'], notations: ['polish'], keys: [0] }),
      NO_LIBRARY
    );
    expect(ids[0]).toBe('key:0:145');
  });

  it('is stable and free of duplicates', () => {
    const once = scopeIds(settings(), NO_LIBRARY);
    expect(scopeIds(settings(), NO_LIBRARY)).toEqual(once);
    expect(new Set(once).size).toBe(once.length);
  });

  it('grows only where a second notation disagrees, not everywhere', () => {
    const one = scopeIds(
      settings({ directions: ['degrees'], patterns: ['145'], notations: ['polish'] }),
      NO_LIBRARY
    );
    const two = scopeIds(
      settings({ directions: ['degrees'], patterns: ['145'], notations: ['polish', 'german'] }),
      NO_LIBRARY
    );
    // Twelve keys, and only the ones printing a black key gain a German card. `I IV V` in C, D, E,
    // F, G, A and B prints none, so those seven stay single.
    expect(one).toHaveLength(12 * ORDERS_145);
    expect(two.length).toBeGreaterThan(12 * ORDERS_145);
    expect(two.length).toBeLessThan(24 * ORDERS_145);
    expect(one.every((id) => two.includes(id))).toBe(true);
  });

  it('narrows to the songbook’s own keys when asked', () => {
    const all = scopeIds(
      settings({ directions: ['degrees'], patterns: ['145'], notations: ['polish'], keys: 'all' }),
      LIBRARY
    );
    const songbook = scopeIds(
      settings({
        directions: ['degrees'],
        patterns: ['145'],
        notations: ['polish'],
        keys: 'songbook',
      }),
      LIBRARY
    );
    expect(all).toHaveLength(12 * ORDERS_145);
    expect(songbook).toHaveLength(3 * ORDERS_145);
    expect(new Set(songbook.map((id) => id.split(':')[1]))).toEqual(new Set(['0', '7', '9']));
  });

  it('narrows to the keys picked, in every direction', () => {
    const picked = settings({
      directions: ['degrees', 'key', 'transpose'],
      patterns: ['145'],
      notations: ['polish'],
      keys: [0, 5, 7],
    });
    const ids = scopeIds(picked, NO_LIBRARY);
    // Three keys: three `degrees`, three `key`, and the six ordered pairs between them.
    expect(ids).toHaveLength((3 + 3 + 3 * 2) * ORDERS_145);
    for (const id of ids) {
      const key = parseCardId(id)!;
      const tonics = key.direction === 'transpose' ? [key.from, key.to] : [key.tonic];
      for (const tonic of tonics) expect([0, 5, 7], id).toContain(tonic);
    }
  });

  it('draws only the orderings asked for', () => {
    const base = { directions: ['key'] as const, patterns: ['145'] as const, notations: ['polish'] as const, keys: [9] as const };
    const both = scopeIds(settings({ ...base, orders: ['degree', 'shuffled'] }), NO_LIBRARY);
    const ordered = scopeIds(settings({ ...base, orders: ['degree'] }), NO_LIBRARY);
    const shuffled = scopeIds(settings({ ...base, orders: ['shuffled'] }), NO_LIBRARY);

    expect(both).toHaveLength(ORDERS_145);
    // `degree` alone is the deck as it was before the ordering axis: one card per question, and
    // the very card every stored schedule was earnt on.
    expect(ordered).toEqual(['key:9:145']);
    expect(shuffled).toHaveLength(ORDERS_145 - 1);
    expect(shuffled).not.toContain('key:9:145');
    expect([...ordered, ...shuffled].sort()).toEqual([...both].sort());
  });

  it('is a scope and not a deletion — the cards parked keep their ids', () => {
    // `ensureCards` never removes, so switching `shuffled` off and on again finds the work there.
    const wide = settings({
      directions: ['key'], patterns: ['145'], notations: ['polish'], keys: [9],
      orders: ['degree', 'shuffled'],
    });
    const narrow = settings({ ...wide, orders: ['degree'] });
    const deck = ensureCards({}, scopeIds(wide, NO_LIBRARY));
    expect(cardsInScope(deck, narrow, NO_LIBRARY)).toHaveLength(1);
    expect(Object.keys(ensureCards(deck, scopeIds(narrow, NO_LIBRARY)))).toHaveLength(ORDERS_145);
    expect(cardsInScope(deck, wide, NO_LIBRARY)).toHaveLength(ORDERS_145);
  });

  it('falls back rather than emptying the deck when the orderings are switched off entirely', () => {
    expect(scopeIds(settings({ orders: [] }), NO_LIBRARY).length).toBeGreaterThan(0);
  });

  it('never empties the deck on a key list that arrives empty', () => {
    // The panel refuses to empty it; a record from elsewhere might not have.
    expect(scopeIds(settings({ keys: [] }), NO_LIBRARY).length).toBeGreaterThan(0);
  });

  it('falls back rather than emptying the deck when a scope is switched off entirely', () => {
    expect(scopeIds(settings({ directions: [], patterns: [] }), NO_LIBRARY).length).toBeGreaterThan(0);
  });

  it('mints only ids it can read back', () => {
    for (const id of scopeIds(settings({ patterns: ['145', '1456', 'm145', 'm14V'] }), NO_LIBRARY)) {
      expect(parseCardId(id), id).not.toBeNull();
    }
  });
});

describe('ensureCards', () => {
  it('adds what is missing and keeps what is out of scope', () => {
    const narrow = settings({ directions: ['degrees'], patterns: ['145'], notations: ['polish'] });
    const deck = ensureCards({}, scopeIds(narrow, NO_LIBRARY));
    expect(Object.keys(deck)).toHaveLength(12 * ORDERS_145);

    const wider = settings({ directions: ['degrees', 'key'], patterns: ['145'], notations: ['polish'] });
    const grown = ensureCards(deck, scopeIds(wider, NO_LIBRARY));
    expect(Object.keys(grown)).toHaveLength(24 * ORDERS_145);

    // Narrowing again leaves the schedule earnt on the cards now out of scope.
    const narrowed = ensureCards(grown, scopeIds(narrow, NO_LIBRARY));
    expect(Object.keys(narrowed)).toHaveLength(24 * ORDERS_145);
    expect(cardsInScope(narrowed, narrow, NO_LIBRARY)).toHaveLength(12 * ORDERS_145);
  });
});

describe('buildQueue', () => {
  const scope = settings({
    directions: ['degrees', 'key'],
    patterns: ['145'],
    notations: ['polish'],
  });
  const sitting = shape({ sessionLength: 10, newPerSession: 4 });

  it('introduces no more new cards than the sitting allows', () => {
    const deck = ensureCards({}, scopeIds(scope, NO_LIBRARY));
    const queue = buildQueue(deck, scope, NO_LIBRARY, sitting, 1000, { rng: seeded(7) });
    expect(queue).toHaveLength(4);
  });

  it('takes the most overdue reviews, not a random handful', () => {
    const now = 10_000_000_000;
    const ids = scopeIds(scope, NO_LIBRARY);
    const deck: Deck = {};
    // Every card in review, each one a day staler than the last.
    ids.forEach((id, i) => {
      deck[id] = { ...createCard(id), status: 'review', intervalDays: 1, due: now - i * 86_400_000 };
    });
    const queue = buildQueue(
      deck,
      scope,
      NO_LIBRARY,
      shape({ sessionLength: 10, newPerSession: 0 }),
      now,
      { rng: seeded(3) }
    );
    // The ten most overdue are the last ten in that list, whatever order they come in.
    expect(new Set(queue)).toEqual(new Set(ids.slice(-10)));
  });

  it('is shuffled — a fixed order is a sequence you learn instead of the keys', () => {
    const deck = ensureCards({}, scopeIds(scope, NO_LIBRARY));
    const a = buildQueue(deck, scope, NO_LIBRARY, sitting, 1000, { rng: seeded(1) });
    const b = buildQueue(deck, scope, NO_LIBRARY, sitting, 1000, { rng: seeded(99) });
    expect(a).not.toEqual(b);
    // Same generator, same order: the randomness is injected, never read from the clock.
    expect(buildQueue(deck, scope, NO_LIBRARY, sitting, 1000, { rng: seeded(1) })).toEqual(a);
  });

  it('draws the cards closest to due when nothing is due and one is asked for anyway', () => {
    const now = 1_000_000;
    const deck: Deck = {};
    for (const id of scopeIds(scope, NO_LIBRARY)) {
      deck[id] = { ...createCard(id), status: 'review', intervalDays: 5, due: now + 86_400_000 };
    }
    expect(buildQueue(deck, scope, NO_LIBRARY, sitting, now, { rng: seeded(5) })).toHaveLength(0);
    expect(
      buildQueue(deck, scope, NO_LIBRARY, sitting, now, { ahead: true, rng: seeded(5) })
    ).toHaveLength(10);
  });
});

describe('spreadSubjects', () => {
  it('pulls apart the two ways round of one key', () => {
    // Back to back, `key:0:145` is answered off having just produced C F G for `degrees:0:145`.
    const queue = ['degrees:0:145', 'key:0:145', 'degrees:7:145', 'key:7:145'];
    const spread = spreadSubjects(queue, 1);
    expect(spread).toHaveLength(4);
    expect(new Set(spread)).toEqual(new Set(queue));
    for (let i = 1; i < spread.length; i++) {
      const before = parseCardId(spread[i - 1])!;
      const after = parseCardId(spread[i])!;
      expect(`${'tonic' in before ? before.tonic : ''}`).not.toBe(
        `${'tonic' in after ? after.tonic : ''}`
      );
    }
  });

  it('is total — a queue of nothing but one key still comes back whole', () => {
    const queue = ['degrees:0:145', 'key:0:145', 'degrees:0:145:in'];
    expect(spreadSubjects(queue).sort()).toEqual([...queue].sort());
  });

  it('leaves an unreadable id where it is rather than dropping it', () => {
    const queue = ['degrees:0:145', 'nonsense', 'key:7:145'];
    expect(spreadSubjects(queue).sort()).toEqual([...queue].sort());
  });
});

describe('asksMode', () => {
  it('asks for the mode only when a minor pattern is in scope', () => {
    expect(asksMode(settings({ patterns: ['145', '1456'] }))).toBe(false);
    expect(asksMode(settings({ patterns: ['145', 'm14V'] }))).toBe(true);
  });
});

describe('countDeck', () => {
  it('counts what is due, what is fresh and what is mastered', () => {
    const now = 5_000_000;
    const scope = settings({ directions: ['degrees'], patterns: ['145'], notations: ['polish'] });
    const deck = ensureCards({}, scopeIds(scope, NO_LIBRARY));
    const cards = cardsInScope(deck, scope, NO_LIBRARY);
    expect(countDeck(cards, now)).toMatchObject({
      total: 12 * ORDERS_145,
      fresh: 12 * ORDERS_145,
      due: 0,
    });

    // One card answered `easy` four times running is a mature card and no longer due.
    let card = deck['degrees:0:145'];
    for (let i = 0; i < 8; i++) card = rate(card, 'easy', now, 800);
    const answered = { ...deck, 'degrees:0:145': card };
    const counts = countDeck(cardsInScope(answered, scope, NO_LIBRARY), now);
    expect(counts.fresh).toBe(12 * ORDERS_145 - 1);
    expect(counts.buckets.mature).toBe(1);
  });
});

describe('which keys the deck draws from', () => {
  it('reads the songbook per pattern, which is why it is not a list of tonics', () => {
    const scope = settings({ patterns: ['145', 'm14V'], keys: 'songbook' });
    expect(tonicsFor(scope, '145', LIBRARY)).toEqual([0, 7, 9]);
    expect(tonicsFor(scope, 'm14V', LIBRARY)).toEqual([]);
  });

  it('takes an explicit list as written', () => {
    expect(tonicsFor(settings({ keys: [2, 9] }), '145', LIBRARY)).toEqual([2, 9]);
  });

  it('unions the patterns for the settings panel to draw', () => {
    const scope = settings({ patterns: ['145', 'm14V'], keys: 'songbook' });
    expect(effectiveTonics(scope, LIBRARY)).toEqual([0, 7, 9]);
    expect(effectiveTonics(settings({ keys: [9, 2] }), LIBRARY)).toEqual([2, 9]);
    expect(effectiveTonics(settings({ keys: 'all' }), LIBRARY)).toHaveLength(12);
  });
});
