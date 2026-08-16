import { describe, expect, it } from 'vitest';
import {
  emptyCache,
  foldEvents,
  mergeEvents,
  newestAt,
  rebuildDeck,
  reconcileDeck,
  recordLocal,
} from './replay';
import { DAY, MINUTE } from './scheduler';
import type { ReviewEvent } from './types';

const T0 = 1_700_000_000_000;

function event(id: string, at: number, overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    id,
    sessionId: id.split('-')[0],
    cardId: 'name:0-5',
    at,
    ms: 1_500,
    correct: true,
    rating: 'good',
    answered: 'A',
    ...overrides,
  };
}

/** A device's sitting: three answers on two cards. */
function sitting(prefix: string, at: number): ReviewEvent[] {
  return [
    event(`${prefix}-1`, at, { cardId: 'name:0-5' }),
    event(`${prefix}-2`, at + MINUTE, { cardId: 'find:2-7' }),
    event(`${prefix}-3`, at + 2 * MINUTE, { cardId: 'name:0-5', rating: 'again', correct: false }),
  ];
}

describe('folding', () => {
  it('does not depend on the order events arrive in', () => {
    const events = sitting('a', T0);
    const forwards = foldEvents({}, events);
    const backwards = foldEvents({}, [...events].reverse());
    expect(backwards).toEqual(forwards);
  });

  it('builds the same deck whether folded at once or in instalments', () => {
    const first = sitting('a', T0);
    const second = sitting('b', T0 + DAY);
    expect(foldEvents(foldEvents({}, first), second)).toEqual(rebuildDeck([...first, ...second]));
  });

  it('counts every answer exactly once', () => {
    const deck = rebuildDeck(sitting('a', T0));
    expect(deck['name:0-5'].seen).toBe(2);
    expect(deck['find:2-7'].seen).toBe(1);
    expect(deck['name:0-5'].correct).toBe(1);
  });

  it('creates cards it has never seen before', () => {
    const deck = rebuildDeck([event('x-1', T0, { cardId: 'find:5-11' })]);
    expect(deck['find:5-11'].reps).toBe(1);
  });
});

describe('mergeEvents', () => {
  it('unions by id and keeps time order', () => {
    const mine = sitting('a', T0);
    const theirs = sitting('b', T0 - DAY);
    const merged = mergeEvents(mine, theirs);
    expect(merged).toHaveLength(6);
    expect(merged.map((e) => e.at)).toEqual([...merged.map((e) => e.at)].sort((x, y) => x - y));
  });

  it('drops a re-delivered event rather than counting it twice', () => {
    // A device's own sitting comes back down on the next pull; folding it again would
    // double every answer in it.
    const mine = sitting('a', T0);
    expect(mergeEvents(mine, [...mine])).toHaveLength(3);
  });

  it('reports the high-water mark', () => {
    expect(newestAt(sitting('a', T0))).toBe(T0 + 2 * MINUTE);
    expect(newestAt([])).toBe(0);
  });
});

describe('reconcileDeck', () => {
  const local = sitting('a', T0);
  const cache = recordLocal(emptyCache(), local);

  it('does nothing when the other side has nothing new', () => {
    const result = reconcileDeck(cache, local, local);
    expect(result.mode).toBe('unchanged');
    expect(result.cache).toBe(cache);
  });

  it('folds a later sitting straight on top', () => {
    const theirs = sitting('b', T0 + DAY);
    const result = reconcileDeck(cache, local, theirs);
    expect(result.mode).toBe('append');
    expect(result.cache.deck).toEqual(rebuildDeck([...local, ...theirs]));
    expect(result.cache.foldedThrough).toBe(newestAt(theirs));
  });

  it('refolds from scratch when the two sittings interleave', () => {
    // Both devices drilled while offline. Neither one's answers are stale, so the answer is
    // the deck a single device doing both sittings in that order would have produced.
    const theirs = sitting('b', T0 - DAY);
    const result = reconcileDeck(cache, local, theirs);
    expect(result.mode).toBe('rebuild');
    expect(result.cache.deck).toEqual(rebuildDeck([...theirs, ...local]));
    expect(result.events).toHaveLength(6);
  });

  it('folds late events on top when the local log has been pruned', () => {
    const pruned = { ...cache, logComplete: false };
    const theirs = sitting('b', T0 - DAY);
    const result = reconcileDeck(pruned, local, theirs);
    expect(result.mode).toBe('append-late');
    // Nothing is lost - every answer is still counted, only the due dates are computed from
    // an older clock than they would have been.
    expect(result.cache.deck['name:0-5'].seen).toBe(4);
  });

  it('rebuilds anyway when the caller holds a complete log it did not store', () => {
    const pruned = { ...cache, logComplete: false };
    const theirs = sitting('b', T0 - DAY);
    const result = reconcileDeck(pruned, local, theirs, { completeLog: true });
    expect(result.mode).toBe('rebuild');
    expect(result.cache.logComplete).toBe(true);
  });

  it('reports which events were new, so the caller can store just those', () => {
    const theirs = sitting('b', T0 + DAY);
    const result = reconcileDeck(cache, local, [...local, ...theirs]);
    expect(result.novel.map((e) => e.id)).toEqual(theirs.map((e) => e.id));
  });
});

describe('recordLocal', () => {
  it('advances the high-water mark with this device own answers', () => {
    const cache = recordLocal(emptyCache(), sitting('a', T0));
    expect(cache.foldedThrough).toBe(T0 + 2 * MINUTE);
    expect(cache.logComplete).toBe(true);
  });

  it('is a no-op for an empty sitting', () => {
    const cache = emptyCache();
    expect(recordLocal(cache, [])).toBe(cache);
  });
});
