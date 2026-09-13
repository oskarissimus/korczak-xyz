import { describe, expect, it } from 'vitest';

import {
  cleanName,
  editItem,
  matchName,
  MAX_NAME_LENGTH,
  newItem,
  normalizeItem,
  readd,
  setDone,
  tombstoneItem,
  type ShoppingItem,
} from './item';

const T = 1_700_000_000_000;

function make(over: Partial<ShoppingItem> = {}): ShoppingItem {
  return { ...newItem({ name: 'milk', note: '' }, T), ...over };
}

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  two   words  ', MAX_NAME_LENGTH)).toBe('two words');
  });

  it('leaves the spelling alone — it is shown, not compared', () => {
    expect(cleanName('Mleko UHT', MAX_NAME_LENGTH)).toBe('Mleko UHT');
  });

  it('truncates rather than refuses, so a paste cannot fill the store', () => {
    expect(cleanName('x'.repeat(500), MAX_NAME_LENGTH)).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('matchName', () => {
  it('folds case, so an autocapitalising phone does not make a second line', () => {
    expect(matchName('Mleko')).toBe(matchName('mleko'));
  });

  it('folds Polish diacritics, which is where the typo actually comes from', () => {
    expect(matchName('mąka')).toBe(matchName('maka'));
    expect(matchName('żółty ser')).toBe(matchName('zolty ser'));
    // `ł` has no Unicode decomposition, so it is folded by name rather than by stripping marks.
    expect(matchName('masło')).toBe(matchName('maslo'));
  });

  it('does not guess at plurals — merging two things somebody wanted is worse than two lines', () => {
    expect(matchName('jabłko')).not.toBe(matchName('jabłka'));
  });
});

describe('writes', () => {
  it('caps a name the input never had a chance to cap', () => {
    expect(newItem({ name: 'x'.repeat(500), note: '' }, T).name).toHaveLength(MAX_NAME_LENGTH);
  });

  it('starts a line to buy, with the author attached only when there is one', () => {
    const anon = newItem({ name: ' milk ', note: ' 2 l ' }, T);
    expect(anon.name).toBe('milk');
    expect(anon.note).toBe('2 l');
    expect(anon.done).toBe(false);
    expect(anon.doneAt).toBeNull();
    expect('authorEmail' in anon).toBe(false);

    const mine = newItem({ name: 'milk', note: '' }, T, 'a@example.com');
    expect(mine.authorEmail).toBe('a@example.com');
  });

  it('moves rev forward on every write, which is what orders a merge', () => {
    const first = make();
    const ticked = setDone(first, true, T + 1);
    expect(ticked.rev).toBe(first.rev + 1);
    expect(ticked.doneAt).toBe(T + 1);
    const back = setDone(ticked, false, T + 2);
    expect(back.rev).toBe(ticked.rev + 1);
    // Cleared, so a line put back and picked up again sorts by when it was *last* taken.
    expect(back.doneAt).toBeNull();
  });

  it('keeps the author across an edit — it says who asked, not who last touched it', () => {
    const first = make({ authorEmail: 'a@example.com' });
    expect(editItem(first, { name: 'bread' }, T + 1).authorEmail).toBe('a@example.com');
    expect(setDone(first, true, T + 1).authorEmail).toBe('a@example.com');
  });

  it('revives a cleared line at a higher rev, so the tombstone cannot absorb it', () => {
    const gone = tombstoneItem(make(), T + 1);
    const back = readd(gone, { name: 'milk', note: '3' }, T + 2);
    expect(back.deleted).toBe(false);
    expect(back.done).toBe(false);
    expect(back.rev).toBeGreaterThan(gone.rev);
    expect(back.createdAt).toBe(T + 2);
    expect(back.note).toBe('3');
  });

  it('leaves the note alone when the re-add typed none — an empty box is not "clear it"', () => {
    const gone = tombstoneItem(make({ note: '2 l' }), T + 1);
    expect(readd(gone, { name: 'milk', note: '' }, T + 2).note).toBe('2 l');
  });
});

describe('normalizeItem', () => {
  it('rejects what cannot be a line, rather than storing a row nobody can act on', () => {
    expect(normalizeItem(null)).toBeNull();
    expect(normalizeItem({ name: 'milk' })).toBeNull();
    expect(normalizeItem({ id: 'a', name: '   ' })).toBeNull();
  });

  it('fills in what an older build may not have written', () => {
    const item = normalizeItem({ id: 'a', name: 'milk' })!;
    expect(item.note).toBe('');
    expect(item.done).toBe(false);
    expect(item.rev).toBe(0);
    expect(item.writerId).toBe('');
    expect('authorEmail' in item).toBe(false);
    expect('deleted' in item).toBe(false);
  });

  it('keeps a tick that arrived with no time, losing only its place in the bought order', () => {
    const item = normalizeItem({ id: 'a', name: 'milk', done: true })!;
    expect(item.done).toBe(true);
    expect(item.doneAt).toBeNull();
  });

  it('round-trips a record it wrote itself', () => {
    const first = newItem({ name: 'milk', note: '2 l' }, T, 'a@example.com');
    expect(normalizeItem(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });
});
