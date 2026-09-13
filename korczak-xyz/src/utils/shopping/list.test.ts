import { describe, expect, it } from 'vitest';

import type { ShoppingItem } from './item';
import { findByName, mergeItems, splitList, suggest } from './list';

const T = 1_700_000_000_000;

function item(over: Partial<ShoppingItem> & { id: string; name: string }): ShoppingItem {
  return {
    note: '',
    done: false,
    doneAt: null,
    createdAt: T,
    rev: 0,
    updatedAt: T,
    writerId: 'w1',
    ...over,
  };
}

describe('splitList', () => {
  it('reads to-buy oldest first, so a new line cannot push the next one off the top', () => {
    const view = splitList([
      item({ id: 'b', name: 'bread', createdAt: T + 2 }),
      item({ id: 'a', name: 'milk', createdAt: T + 1 }),
    ]);
    expect(view.todo.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('reads the basket most recently picked up first', () => {
    const view = splitList([
      item({ id: 'a', name: 'milk', done: true, doneAt: T + 1 }),
      item({ id: 'b', name: 'bread', done: true, doneAt: T + 9 }),
    ]);
    expect(view.done.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('hides tombstones from both halves', () => {
    const view = splitList([item({ id: 'a', name: 'milk', deleted: true })]);
    expect(view.todo).toEqual([]);
    expect(view.done).toEqual([]);
  });
});

describe('mergeItems', () => {
  it('takes the later tick, whichever device it came from', () => {
    const mine = item({ id: 'a', name: 'milk' });
    const theirs = item({ id: 'a', name: 'milk', done: true, doneAt: T + 5, rev: 1, writerId: 'w2' });
    expect(mergeItems([mine], [theirs]).items[0].done).toBe(true);
  });

  it('is commutative, so two phones converge on the same list', () => {
    const a = [item({ id: 'a', name: 'milk', createdAt: T + 1 })];
    const b = [item({ id: 'b', name: 'bread', createdAt: T + 1 })];
    expect(mergeItems(a, b).items.map((i) => i.id)).toEqual(
      mergeItems(b, a).items.map((i) => i.id)
    );
  });

  it('re-uploads nothing the cloud already holds an identical copy of', () => {
    const same = item({ id: 'a', name: 'milk' });
    expect(mergeItems([same], [{ ...same }]).localWins).toEqual([]);
  });

  it('pushes a line the cloud has never seen', () => {
    expect(mergeItems([item({ id: 'a', name: 'milk' })], []).localWins).toEqual(['a']);
  });

  it('pushes a note edited here over an older copy there', () => {
    const mine = item({ id: 'a', name: 'milk', note: '3', rev: 1, updatedAt: T + 5 });
    const theirs = item({ id: 'a', name: 'milk' });
    const merged = mergeItems([mine], [theirs]);
    expect(merged.items[0].note).toBe('3');
    expect(merged.localWins).toEqual(['a']);
  });

  it('lets a clear stand against a stale edit, and a deliberate re-add stand against the clear', () => {
    const cleared = item({ id: 'a', name: 'milk', deleted: true, rev: 2 });
    const stale = item({ id: 'a', name: 'milk', rev: 1, updatedAt: T + 999, writerId: 'w2' });
    expect(mergeItems([cleared], [stale]).items[0].deleted).toBe(true);

    // Written on top of a copy that had already seen the delete: the higher rev is the writer
    // saying they mean it, which is what keeps a re-added line from being swallowed forever.
    const readded = item({ id: 'a', name: 'milk', rev: 3, writerId: 'w2' });
    expect(mergeItems([cleared], [readded]).items[0].deleted).toBeUndefined();
  });
});

describe('findByName', () => {
  const items = [
    item({ id: 'gone', name: 'Mleko', deleted: true }),
    item({ id: 'bought', name: 'mleko', done: true, doneAt: T }),
    item({ id: 'todo', name: 'MLEKO' }),
  ];

  it('prefers the line still waiting to be bought', () => {
    expect(findByName(items, 'mleko')?.id).toBe('todo');
  });

  it('falls back to the bought line, then to the cleared one', () => {
    expect(findByName(items.slice(0, 2), 'mleko')?.id).toBe('bought');
    expect(findByName(items.slice(0, 1), 'mleko')?.id).toBe('gone');
  });

  it('finds nothing for a name nobody has written', () => {
    expect(findByName(items, 'chleb')).toBeNull();
    expect(findByName(items, '  ')).toBeNull();
  });
});

describe('suggest', () => {
  it('offers most-bought first', () => {
    const items = [
      item({ id: '1', name: 'milk', deleted: true }),
      item({ id: '2', name: 'milk', deleted: true }),
      item({ id: '3', name: 'bread', deleted: true }),
    ];
    expect(suggest(items)).toEqual(['milk', 'bread']);
  });

  it('leaves out what is already waiting to be bought', () => {
    const items = [
      item({ id: '1', name: 'milk', deleted: true }),
      item({ id: '2', name: 'Milk' }),
    ];
    expect(suggest(items)).toEqual([]);
  });

  it('leaves out what is in the basket too — a chip above a ticked line is a lie', () => {
    expect(suggest([item({ id: '1', name: 'milk', done: true, doneAt: T })])).toEqual([]);
  });

  it('groups spellings into one chip, labelled with the most recent one', () => {
    const items = [
      item({ id: '1', name: 'mleko', deleted: true, updatedAt: T }),
      item({ id: '2', name: 'mleko', deleted: true, updatedAt: T + 5 }),
      // The correction. It has to win the label, or a year of the old spelling outvotes it.
      item({ id: '3', name: 'Mleko', deleted: true, updatedAt: T + 9 }),
      item({ id: '4', name: 'chleb', deleted: true, updatedAt: T + 9 }),
    ];
    expect(suggest(items)).toEqual(['Mleko', 'chleb']);
  });

  it('honours the cap, so the chip row stays one row', () => {
    const items = Array.from({ length: 20 }, (_, n) =>
      item({ id: `x${n}`, name: `thing ${n}`, deleted: true })
    );
    expect(suggest(items, 5)).toHaveLength(5);
  });
});
