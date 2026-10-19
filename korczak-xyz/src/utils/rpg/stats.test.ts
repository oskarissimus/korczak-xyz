import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addToday, loadToday, today } from './stats';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

describe('rpg day stats', () => {
  it('adds up within a day', () => {
    addToday({ launches: 1 });
    addToday({ usd: 0.02, generationMs: 1500 });
    addToday({ usd: 0.01, unpriced: true, playMs: 60000 });
    expect(loadToday()).toMatchObject({ launches: 1, generationMs: 1500, playMs: 60000, unpriced: true });
    expect(loadToday().usd).toBeCloseTo(0.03, 9);
  });

  it('starts a new day from zero', () => {
    store.set('rpg-stats', JSON.stringify({ day: '2020-01-01', launches: 9, usd: 3, generationMs: 1, playMs: 1 }));
    expect(loadToday()).toEqual({ day: today(), launches: 0, usd: 0, unpriced: false, generationMs: 0, playMs: 0 });
    expect(addToday({ launches: 1 }).launches).toBe(1);
  });

  it('survives garbage', () => {
    store.set('rpg-stats', '{not json');
    expect(loadToday().launches).toBe(0);
    store.set('rpg-stats', JSON.stringify({ day: today(), launches: -4, usd: 'x' }));
    expect(loadToday()).toMatchObject({ launches: 0, usd: 0 });
  });
});
