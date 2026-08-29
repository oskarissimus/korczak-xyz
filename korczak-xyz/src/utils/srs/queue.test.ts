/*
 * The draw itself, tested here rather than through either deck.
 *
 * `queue.ts` had no test of its own — `buildQueue` was reached only through the fretboard's and
 * the transposition trainer's, which is fine for "does this deck's scope go in" and wrong for
 * this. What a *sample* does is a statement about a distribution, so the assertions below run
 * hundreds of seeds and count outcomes, and dragging that into a deck's test file would bury it
 * under scope fixtures that have nothing to do with it.
 */

import { describe, expect, it } from 'vitest';
import { DAY, MINUTE, createCard } from './scheduler';
import type { Card } from './scheduler';
import { BACKLOG_DEADLINE_MS, buildQueue, sampleDue } from './queue';
import type { QueueShape } from './queue';

const T0 = 1_700_000_000_000;

/** mulberry32 — a seeded generator, so a sampled sitting is something a test can pin down. */
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
  return { sessionLength: 10, newPerSession: 0, ...overrides };
}

function scheduled(id: string, due: number): Card {
  return { ...createCard(id), status: 'review', intervalDays: 5, due };
}

/** The case this whole design is about: sixty due, a sitting of ten. */
function sixtyDue(overdueMs = MINUTE): Card[] {
  return Array.from({ length: 60 }, (_, i) => scheduled(`c${i}`, T0 - overdueMs));
}

const drawn = (cards: Card[], seed: number, limit = 10, now = T0) => {
  const draw = sampleDue(cards, limit, now, seeded(seed));
  return [...draw.forced, ...draw.sampled];
};

describe('sampleDue', () => {
  it('draws a sample of what is due, not the same slice every time', () => {
    const cards = sixtyDue();
    const sets = new Set<string>();
    const everSeen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const ids = drawn(cards, seed);
      expect(ids).toHaveLength(10);
      sets.add([...ids].sort().join(','));
      for (const id of ids) everSeen.add(id);
    }
    // The complaint this answers: sixty due and a sitting of ten used to be the same ten forever.
    expect(sets.size).toBeGreaterThan(190);
    expect(everSeen.size).toBe(60);
  });

  it('never draws a card twice in one sitting', () => {
    const cards = sixtyDue();
    for (let seed = 1; seed <= 50; seed++) {
      const ids = drawn(cards, seed);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  /*
   * The bias is meant to be felt and not obeyed. Three days overdue against just-due is a weight
   * of 1.75 against 1 — so the older card should win noticeably more often, and nowhere near
   * always. A pool of two drawn one at a time makes the ratio directly readable.
   */
  it('tilts towards the older card, and only slightly', () => {
    const old = scheduled('old', T0 - 3 * DAY);
    const fresh = scheduled('fresh', T0 - MINUTE);
    let oldWins = 0;
    const runs = 600;
    for (let seed = 1; seed <= runs; seed++) {
      if (drawn([old, fresh], seed, 1)[0] === 'old') oldWins++;
    }
    const share = oldWins / runs;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.75);
  });

  it('is uniform when everything fell due at the same moment', () => {
    const cards = sixtyDue();
    const counts = new Map<string, number>();
    const runs = 600;
    for (let seed = 1; seed <= runs; seed++) {
      for (const id of drawn(cards, seed)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const expected = (runs * 10) / 60;
    for (const card of cards) {
      expect(counts.get(card.id) ?? 0).toBeGreaterThan(expected * 0.6);
      expect(counts.get(card.id) ?? 0).toBeLessThan(expected * 1.4);
    }
  });

  /*
   * The guarantee, and the reason a weight alone was not enough. A soft bias moves the average
   * and leaves the tail: drawn uniformly, one card in twelve waits over a fortnight.
   */
  it('always takes a card that is past the deadline', () => {
    const cards = [
      scheduled('rotting', T0 - BACKLOG_DEADLINE_MS - MINUTE),
      ...Array.from({ length: 59 }, (_, i) => scheduled(`c${i}`, T0 - MINUTE)),
    ];
    for (let seed = 1; seed <= 300; seed++) {
      expect(drawn(cards, seed)).toContain('rotting');
    }
  });

  it('reports which rule put each card in the sitting', () => {
    const draw = sampleDue(
      [
        scheduled('rotting', T0 - 9 * DAY),
        ...Array.from({ length: 20 }, (_, i) => scheduled(`c${i}`, T0 - MINUTE)),
      ],
      5,
      T0,
      seeded(3)
    );
    expect(draw.forced).toEqual(['rotting']);
    expect(draw.sampled).toHaveLength(4);
  });

  it('fills the sitting oldest-first when more cards are past the deadline than fit', () => {
    // Being this far behind is not a case for a lottery: the oldest go first, which is what this
    // function did unconditionally before there was a sample at all.
    const cards = Array.from({ length: 20 }, (_, i) =>
      scheduled(`c${i}`, T0 - BACKLOG_DEADLINE_MS - (20 - i) * DAY)
    );
    for (let seed = 1; seed <= 20; seed++) {
      const draw = sampleDue(cards, 3, T0, seeded(seed));
      expect(draw.forced).toEqual(['c0', 'c1', 'c2']);
      expect(draw.sampled).toEqual([]);
    }
  });

  it('takes everything when the sitting is bigger than the pool', () => {
    const ids = drawn(sixtyDue(), 1, 100);
    expect(new Set(ids).size).toBe(60);
  });

  it('draws nothing when the sitting has no room', () => {
    expect(sampleDue(sixtyDue(), 0, T0, seeded(1))).toEqual({ forced: [], sampled: [] });
  });
});

describe('buildQueue', () => {
  /*
   * The one that states the request. A card past the deadline has to survive everything that
   * happens *after* the draw — the new-card ration interleaved through the reviews, and the slice
   * that cuts the queue back to `sessionLength`. That slice eats the tail of the review list, so
   * this fails the moment the rescued cards are merged into the sample rather than kept in front
   * of it.
   */
  it('keeps a rescued card even when new cards are competing for the sitting', () => {
    const cards = [
      scheduled('rotting', T0 - BACKLOG_DEADLINE_MS - DAY),
      ...Array.from({ length: 59 }, (_, i) => scheduled(`r${i}`, T0 - MINUTE)),
      ...Array.from({ length: 30 }, (_, i) => createCard(`n${i}`)),
    ];
    for (let seed = 1; seed <= 200; seed++) {
      const queue = buildQueue(cards, shape({ sessionLength: 10, newPerSession: 6 }), T0, {
        rng: seeded(seed),
      });
      expect(queue).toHaveLength(10);
      expect(queue).toContain('rotting');
    }
  });

  /*
   * The acceptance test for the whole change. Practise once a day against a deck whose due pool
   * is consistently larger than one sitting, and measure how long each card actually waited
   * between falling due and being asked. Nothing may wait longer than the deadline plus the gap
   * between two sittings — the grace being the day a card spends crossing the deadline before the
   * next sitting can act on it.
   *
   * The first twenty days are not measured, and the reason is a real limit worth stating rather
   * than a fudge: while more cards are past the deadline than one sitting holds, the bound is
   * *capacity* and not the deadline. A hundred and twenty cards at ten a day take twelve sittings
   * to work through however they are chosen, and no selection rule can make that shorter. The
   * deadline is a promise about steady state.
   */
  it('lets nothing wait past the deadline once the backlog is worked off', () => {
    const WARMUP_DAYS = 20;
    const byId = new Map<string, Card>(
      Array.from({ length: 120 }, (_, i) => [`c${i}`, scheduled(`c${i}`, T0 - i * MINUTE)])
    );
    const rng = seeded(11);
    let worstWait = 0;
    let rescued = 0;

    for (let day = 0; day < 150; day++) {
      const now = T0 + day * DAY;
      const queue = buildQueue([...byId.values()], shape(), now, { rng });
      for (const id of queue) {
        const card = byId.get(id)!;
        if (day >= WARMUP_DAYS) {
          worstWait = Math.max(worstWait, now - card.due);
          if (now - card.due >= BACKLOG_DEADLINE_MS) rescued++;
        }
        // Answered, and back in anything from a week to a fortnight — a pool that keeps the
        // sitting full without growing without bound, which is where the deadline has to hold.
        byId.set(id, { ...card, due: now + (6 + Math.floor(rng() * 13)) * DAY });
      }
    }

    expect(worstWait).toBeLessThanOrEqual(BACKLOG_DEADLINE_MS + DAY);
    // And the deadline is what held it there: without the rescue tier these draws never happen,
    // so a run that rescued nothing would be asserting the bound against a deck that never
    // pressed on it.
    expect(rescued).toBeGreaterThan(0);
  });

  it('leaves cards that are not due yet alone', () => {
    const cards = [scheduled('a', T0 + DAY), scheduled('b', T0 - DAY), scheduled('c', T0 + 2 * DAY)];
    expect(buildQueue(cards, shape(), T0, { rng: seeded(4) })).toEqual(['b']);
  });

  it('draws the nearest cards when asked to practise ahead of schedule', () => {
    // Not a lottery: "nothing is due, give me something anyway" has one sensible answer.
    const cards = [
      scheduled('a', T0 + 3 * DAY),
      scheduled('b', T0 + DAY),
      scheduled('c', T0 + 2 * DAY),
      scheduled('d', T0 + 9 * DAY),
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const queue = buildQueue(cards, shape({ sessionLength: 3 }), T0, {
        ahead: true,
        rng: seeded(seed),
      });
      expect([...queue].sort()).toEqual(['a', 'b', 'c']);
    }
  });
});
