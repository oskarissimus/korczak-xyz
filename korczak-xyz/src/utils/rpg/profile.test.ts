import { beforeEach, describe, expect, it } from 'vitest';

import { adoptGuestGame } from './profile';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("the guest's game going into a new account", () => {
  it('copies the guest world and quest once, to the first account with nothing here', () => {
    store.set('rpg-worlds', 'W');
    store.set('rpg-saves', 'S');
    expect(adoptGuestGame('u1')).toBe(true);
    expect(store.get('rpg-worlds@u1')).toBe('W');
    expect(store.get('rpg-saves@u1')).toBe('S');
    // The guest keeps its own copy, and a second account gets nothing.
    expect(store.get('rpg-worlds')).toBe('W');
    expect(adoptGuestGame('u2')).toBe(false);
    expect(store.has('rpg-worlds@u2')).toBe(false);
  });

  it('never writes over an account that already has a game in this browser, nor adopts nothing', () => {
    expect(adoptGuestGame('u1')).toBe(false);
    store.set('rpg-worlds', 'W');
    store.set('rpg-atlas@u1', 'mine');
    expect(adoptGuestGame('u1')).toBe(false);
    expect(store.has('rpg-worlds@u1')).toBe(false);
  });
});
