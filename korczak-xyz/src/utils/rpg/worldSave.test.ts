import { beforeEach, describe, expect, it } from 'vitest';

import { ATLAS_PLACES, addToAtlas, loadAtlas } from './worldSave';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

const place = (name: string) => ({ name, direction: 'north', distance: 'far', biome: 'meadow' });
const person = (name: string, at: string | null = null) => ({
  character: { name, gender: 'female' as const, color: '#7a5230' },
  at,
  line: `${name} again`,
});

describe('the atlas', () => {
  it('grows across quests, replacing what it already has', () => {
    addToAtlas('w1', { places: [parsed('Mill')], people: [person('Wita'), person('Sambor', 'Mill')] });
    addToAtlas('w1', { places: [parsed('Tower'), parsed('Mill')], people: [person('Wita', 'Tower')] });
    const atlas = loadAtlas('w1');
    expect(atlas.places.map((p) => p.name)).toEqual(['Tower', 'Mill']);
    expect(atlas.people.map((p) => [p.character.name, p.at])).toEqual([
      ['Sambor', 'Mill'],
      ['Wita', 'Tower'],
    ]);
  });

  it('keeps the newest places, re-parses what is stored, and drops worlds no longer played', () => {
    const many = Array.from({ length: ATLAS_PLACES + 4 }, (_, i) => parsed(`P${i}`));
    addToAtlas('pl', { places: many, people: [] });
    expect(loadAtlas('pl').places).toHaveLength(ATLAS_PLACES);
    store.set('rpg-atlas', JSON.stringify({ pl: { places: [{ name: 'Bad' }, place('Good')], people: [{}] } }));
    expect(loadAtlas('pl').places.map((p) => p.name)).toEqual(['Good']);
    expect(loadAtlas('pl').people).toEqual([]);
    addToAtlas('w-old', { places: [parsed('X')], people: [] });
    addToAtlas('pl', { places: [], people: [] });
    expect(loadAtlas('w-old').places).toEqual([]);
  });
});

function parsed(name: string) {
  return { ...place(name), direction: 'north' as const, distance: 'far' as const, biome: 'meadow' as const, features: [], groundColor: '#7c9a48' };
}
