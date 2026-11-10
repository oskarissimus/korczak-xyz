import { describe, expect, it } from 'vitest';
import { drawFour, fromTranslation, mergePool, poolUrl, readPool, translationEntries, withTranslation, type PoolItem } from './proposalPool';

const item = (id: string, kind: number, name = `World ${id}`): PoolItem => ({
  id,
  kind,
  at: 1,
  name,
  idea: '',
  pitch: `Pitch of ${id}.`,
  genre: 'dark fantasy',
  colors: ['#112233', '#445566'],
  picture: null,
  image: null,
});

describe('drawFour', () => {
  const pool = [item('a', 0), item('b', 0), item('c', 1), item('d', 2), item('e', 3), item('f', 3)];

  it('takes one of each kind', () => {
    const four = drawFour(pool, new Set(), () => 0);
    expect(four.map((p) => p.kind)).toEqual([0, 1, 2, 3]);
  });

  it('skips the ones asked to, and fills from the rest when a kind runs out', () => {
    const four = drawFour(pool, new Set(['c', 'd']), () => 0);
    expect(four.map((p) => p.id).sort()).toEqual(['a', 'b', 'e', 'f']);
  });

  it('brings the skipped back rather than show fewer than four', () => {
    expect(drawFour(pool, new Set(['a', 'b', 'c', 'd', 'e']))).toHaveLength(4);
    expect(drawFour(pool.slice(0, 2))).toHaveLength(2);
  });
});

describe('mergePool', () => {
  it('puts the new first, drops repeated ids and names, keeps the newest', () => {
    const merged = mergePool([item('a', 0), item('b', 1)], [item('c', 2), item('a', 0), item('d', 3, 'world b')], 3);
    expect(merged.map((p) => p.id)).toEqual(['c', 'a', 'd']);
  });
});

describe('translation', () => {
  it('round-trips through the flat entries, English where a field did not come back', () => {
    const source = [item('a', 0), item('b', 1)];
    const entries = translationEntries(source);
    expect(entries['a.n']).toBe('World a');
    const answer = { 'a.n': 'Świat a', 'a.p': 'Opis a.', 'a.g': 'mroczne fantasy', 'b.n': 'Świat b' };
    const translated = fromTranslation(source, answer);
    expect(translated.map((p) => p.id)).toEqual(['a']);
    const pool = withTranslation(source, translated);
    expect(pool[0].name).toBe('Świat a');
    expect(pool[1].name).toBe('World b');
  });

  it('carries the idea through, and keeps it out of an item that has none', () => {
    const source = [{ ...item('a', 0), idea: 'pirates on a sea of sand' }, item('b', 1)];
    const entries = translationEntries(source);
    expect(entries['a.s']).toBe('pirates on a sea of sand');
    expect(entries['b.s']).toBeUndefined();
    const answer = { 'a.n': 'Świat a', 'a.s': 'piraci na pustyni', 'a.p': 'Opis a.', 'b.n': 'Świat b', 'b.p': 'Opis b.' };
    const pool = withTranslation(source, fromTranslation(source, answer));
    expect(pool.map((p) => p.idea)).toEqual(['piraci na pustyni', '']);
    expect(readPool({ items: [{ ...source[0] }] })?.items[0].idea).toBe('pirates on a sea of sand');
  });
});

describe('files', () => {
  it('reads a file and drops what is not an item', () => {
    const pool = readPool({ lang: 'pl', at: 5, items: [item('a', 0), { id: 'x' }, null] });
    expect(pool?.items.map((p) => p.id)).toEqual(['a']);
    expect(readPool({})).toBeNull();
  });

  it('builds the public URL from the project', () => {
    expect(poolUrl('korczak-rpg', 'pl')).toBe('https://firebasestorage.googleapis.com/v0/b/korczak-rpg-rpg/o/proposals%2Fpl.json?alt=media&token=every-rpg-proposal-pool');
  });
});
