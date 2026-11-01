import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/logger', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { log } from '../../lib/logger';
import { rpgSet, storageFull } from './storage';

/** A localStorage that holds at most `limit` characters, as a browser's does. */
function ceiling(limit: number) {
  const store = new Map<string, string>();
  const size = () => [...store].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const ls = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = store.get(k);
      store.set(k, v);
      if (size() > limit) {
        if (before === undefined) store.delete(k);
        else store.set(k, before);
        throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      }
    },
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as { localStorage?: unknown }).localStorage = ls;
  (globalThis as { window?: unknown }).window = globalThis;
  return store;
}

describe('a full store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives back the transcripts and the trash the account holds, then keeps the write', () => {
    const store = ceiling(20_000);
    store.set('rpg-saves', JSON.stringify({ w1: { beats: [], transcript: ['x'.repeat(9000)] }, w2: { beats: [], transcript: [] } }));
    store.set('rpg-atlas', JSON.stringify({ w2: { places: [], people: [], note: 'y'.repeat(6000) } }));
    store.set('rpg-worlds', JSON.stringify({ library: { w2: { deleted: 1 } } }));
    store.set('rpg-sync', JSON.stringify({ 'world:w2': { local: 5, pushed: 5 } }));
    expect(rpgSet('rpg-worlds', 'z'.repeat(12_000))).toBe(true);
    expect(JSON.parse(store.get('rpg-saves')!).w1.transcript).toEqual([]);
    expect(JSON.parse(store.get('rpg-atlas')!).w2).toBeUndefined();
    expect(storageFull()).toBe(false);
  });

  it("says so when the room is someone else's, once per key", () => {
    const store = ceiling(10_000);
    store.set('typing-sessions', 'x'.repeat(9_900));
    expect(rpgSet('rpg-worlds', '{}'.repeat(200))).toBe(false);
    expect(rpgSet('rpg-worlds', '{}'.repeat(200))).toBe(false);
    expect(storageFull()).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.error).mock.calls[0][1]).toMatchObject({ key: 'rpg-worlds', quota: true, biggestKb: { 'typing-sessions': 10 } });
  });
});
