import { describe, expect, it } from 'vitest';

import {
  applyLocalEntries,
  mergeEntries,
  pickEntry,
  pruneEntries,
  resolveOpen,
  visibleEntries,
} from './merge';
import type { SleepEntry, SleepKind } from './types';
import { editEntry, newEntry, normalizeEntry, tombstone } from './types';

const T0 = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
const HOUR = 3_600_000;

function make(overrides: Partial<SleepEntry> & { id: string }): SleepEntry {
  return {
    kind: 'nap' as SleepKind,
    start: T0 - HOUR,
    end: T0,
    rev: 0,
    updatedAt: T0,
    writerId: 'a',
    ...overrides,
  };
}

describe('pickEntry', () => {
  it('prefers the higher revision', () => {
    const a = make({ id: 'x', rev: 2 });
    const b = make({ id: 'x', rev: 1 });
    expect(pickEntry(a, b)).toBe(a);
    expect(pickEntry(b, a)).toBe(a);
  });

  it('ignores a fast clock in favour of the revision', () => {
    // The whole reason rev is the primary comparator: a device an hour ahead would otherwise win
    // every merge forever, however stale its copy.
    const stale = make({ id: 'x', rev: 1, updatedAt: T0 + HOUR, writerId: 'fast-clock' });
    const fresh = make({ id: 'x', rev: 3, updatedAt: T0, writerId: 'correct-clock' });
    expect(pickEntry(stale, fresh)).toBe(fresh);
  });

  it('falls back to the clock at the same revision', () => {
    const older = make({ id: 'x', rev: 2, updatedAt: T0 });
    const newer = make({ id: 'x', rev: 2, updatedAt: T0 + 1000 });
    expect(pickEntry(older, newer)).toBe(newer);
  });

  it('breaks a dead tie the same way on both devices', () => {
    const a = make({ id: 'x', rev: 2, writerId: 'aaa' });
    const b = make({ id: 'x', rev: 2, writerId: 'bbb' });
    expect(pickEntry(a, b)).toBe(pickEntry(b, a));
  });

  it('lets a delete win against an edit made without seeing it', () => {
    // Absorbing at the same rev, or a phantom nap comes back and poisons every mean.
    const gone = make({ id: 'x', rev: 5, deleted: true });
    const edited = make({ id: 'x', rev: 5, start: T0 - 2 * HOUR });
    expect(pickEntry(gone, edited).deleted).toBe(true);
    expect(pickEntry(edited, gone).deleted).toBe(true);
  });

  it('lets a write made on top of the tombstone win', () => {
    // Past the tombstone's own rev the writer has seen the delete and is writing the row again.
    // Unreachable for a `uuid()` id, and the whole ballgame for one derived from a night.
    const gone = make({ id: 'x', rev: 5, deleted: true });
    const relogged = make({ id: 'x', rev: 6, start: T0 - 2 * HOUR });
    expect(pickEntry(gone, relogged)).toBe(relogged);
    expect(pickEntry(relogged, gone)).toBe(relogged);
  });

  it('keeps the further-along tombstone when both sides deleted it', () => {
    const a = make({ id: 'x', rev: 3, deleted: true });
    const b = make({ id: 'x', rev: 1, deleted: true });
    expect(pickEntry(a, b)).toBe(a);
  });
});

describe('mergeEntries', () => {
  it('unions two devices’ separate entries', () => {
    const result = mergeEntries([make({ id: 'a' })], [make({ id: 'b' })]);
    expect(result.entries.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(result.changed).toBe(true);
  });

  it('reports no change when the remote adds nothing', () => {
    const mine = [make({ id: 'a', rev: 2 })];
    const result = mergeEntries(mine, [make({ id: 'a', rev: 1 })]);
    expect(result.changed).toBe(false);
  });

  it('names exactly the ids worth pushing', () => {
    const local = [
      make({ id: 'only-here' }),
      make({ id: 'mine-is-newer', rev: 4 }),
      make({ id: 'theirs-is-newer', rev: 1 }),
      make({ id: 'identical', rev: 2 }),
    ];
    const remote = [
      make({ id: 'mine-is-newer', rev: 2 }),
      make({ id: 'theirs-is-newer', rev: 7 }),
      make({ id: 'identical', rev: 2 }),
    ];
    expect(mergeEntries(local, remote).localWins.sort()).toEqual(['mine-is-newer', 'only-here']);
  });

  it('does not re-push an entry the cloud already holds identically', () => {
    // Without an equal-version check every sync re-uploads the whole log, because pickEntry has to
    // return one side or the other for two identical copies.
    const same = [make({ id: 'a' }), make({ id: 'b' })];
    expect(mergeEntries(same, same.map((e) => ({ ...e }))).localWins).toEqual([]);
  });

  it('is idempotent', () => {
    const local = [make({ id: 'a', rev: 1 }), make({ id: 'b' })];
    const remote = [make({ id: 'a', rev: 2 }), make({ id: 'c' })];
    const once = mergeEntries(local, remote).entries;
    const twice = mergeEntries(once, remote).entries;
    expect(twice).toEqual(once);
  });

  it('is commutative', () => {
    const local = [make({ id: 'a', rev: 1 }), make({ id: 'b' })];
    const remote = [make({ id: 'a', rev: 2 }), make({ id: 'c' })];
    const forwards = mergeEntries(local, remote).entries;
    const backwards = mergeEntries(remote, local).entries;
    expect(backwards).toEqual(forwards);
  });

  it('keeps a delete deleted however the merge is ordered', () => {
    const local = [make({ id: 'a', rev: 9, deleted: true })];
    const remote = [make({ id: 'a', rev: 9 })];
    expect(mergeEntries(local, remote).entries[0].deleted).toBe(true);
    expect(mergeEntries(remote, local).entries[0].deleted).toBe(true);
  });

  it('returns entries newest first', () => {
    const result = mergeEntries(
      [make({ id: 'old', start: T0 - 5 * HOUR })],
      [make({ id: 'new', start: T0 - HOUR })]
    );
    expect(result.entries.map((e) => e.id)).toEqual(['new', 'old']);
  });
});

describe('visibleEntries', () => {
  it('hides tombstones and orders newest first', () => {
    const entries = [
      make({ id: 'a', start: T0 - 3 * HOUR }),
      make({ id: 'gone', deleted: true }),
      make({ id: 'b', start: T0 - HOUR }),
    ];
    expect(visibleEntries(entries).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('resolveOpen', () => {
  it('finds nothing running in a closed log', () => {
    expect(resolveOpen([make({ id: 'a' })], T0)).toMatchObject({ open: null, stale: false });
  });

  it('finds the one running sleep', () => {
    const running = make({ id: 'r', start: T0 - HOUR, end: null });
    expect(resolveOpen([make({ id: 'a' }), running], T0).open).toBe(running);
  });

  it('picks the latest start when two devices both started one', () => {
    const earlier = make({ id: 'e', start: T0 - 2 * HOUR, end: null });
    const later = make({ id: 'l', start: T0 - HOUR, end: null });
    const result = resolveOpen([earlier, later], T0);
    expect(result.open).toBe(later);
    expect(result.orphans).toEqual([earlier]);
  });

  it('surfaces the other timer rather than deleting it', () => {
    // Silently discarding somebody's record is worse than asking about it.
    const result = resolveOpen(
      [make({ id: 'e', start: T0 - 2 * HOUR, end: null }), make({ id: 'l', start: T0 - HOUR, end: null })],
      T0
    );
    expect(result.orphans.every((e) => !e.deleted)).toBe(true);
  });

  it('ignores a deleted running entry', () => {
    const result = resolveOpen([make({ id: 'r', end: null, deleted: true })], T0);
    expect(result.open).toBeNull();
  });

  it('flags a nap that has run far too long', () => {
    const forgotten = make({ id: 'r', kind: 'nap', start: T0 - 11 * HOUR, end: null });
    expect(resolveOpen([forgotten], T0).stale).toBe(true);
  });

  it('does not flag a night that has run a normal night', () => {
    const night = make({ id: 'r', kind: 'night', start: T0 - 9 * HOUR, end: null });
    expect(resolveOpen([night], T0).stale).toBe(false);
  });
});

describe('pruneEntries', () => {
  const old = make({ id: 'old', start: T0 - 500 * 86_400_000, end: T0 - 500 * 86_400_000 + HOUR });
  const recent = make({ id: 'recent' });

  it('drops entries past the retention horizon', () => {
    expect(pruneEntries([old, recent], T0, 400, new Set()).map((e) => e.id)).toEqual(['recent']);
  });

  it('never drops something not yet pushed', () => {
    expect(pruneEntries([old], T0, 400, new Set(['old'])).map((e) => e.id)).toEqual(['old']);
  });

  it('never drops a running sleep, however old it looks', () => {
    const running = make({ id: 'r', start: T0 - 500 * 86_400_000, end: null });
    expect(pruneEntries([running], T0, 400, new Set()).map((e) => e.id)).toEqual(['r']);
  });

  it('keeps a tombstone inside the horizon, so a delete is not undone by the next pull', () => {
    const gone = make({ id: 'gone', deleted: true });
    expect(pruneEntries([gone], T0, 400, new Set()).map((e) => e.id)).toEqual(['gone']);
  });
});

/*
 * Attribution rides along with the entry rather than being tracked separately, so what has to hold
 * is that it survives every path a record takes: an edit, a delete, a round trip through
 * `normalizeEntry`, and a merge between two devices.
 */
describe('authorEmail', () => {
  it('records who logged it, and is absent when nobody is signed in', () => {
    expect(newEntry({ kind: 'nap', start: T0, end: null }, T0, 'ola@example.com').authorEmail).toBe(
      'ola@example.com'
    );
    expect(newEntry({ kind: 'nap', start: T0, end: null }, T0).authorEmail).toBeUndefined();
  });

  it('has no key at all when there is no author, because setDoc rejects undefined', () => {
    expect('authorEmail' in newEntry({ kind: 'nap', start: T0, end: null }, T0)).toBe(false);
  });

  it('does not change when somebody else corrects the entry', () => {
    // "Logged by" answers who recorded the sleep. A later correction does not make it theirs.
    const logged = newEntry({ kind: 'nap', start: T0, end: null }, T0, 'ola@example.com');
    const corrected = editEntry(logged, { end: T0 + HOUR }, T0 + HOUR);
    expect(corrected.authorEmail).toBe('ola@example.com');
    expect(tombstone(corrected, T0 + 2 * HOUR).authorEmail).toBe('ola@example.com');
  });

  it('survives a round trip through normalizeEntry', () => {
    const entry = newEntry({ kind: 'night', start: T0, end: null }, T0, 'ola@example.com');
    expect(normalizeEntry(JSON.parse(JSON.stringify(entry)))?.authorEmail).toBe('ola@example.com');
  });

  it('rejects an author that is not a usable string, without losing the entry', () => {
    const base = make({ id: 'x' });
    expect(normalizeEntry({ ...base, authorEmail: 42 })?.authorEmail).toBeUndefined();
    expect(normalizeEntry({ ...base, authorEmail: '' })?.authorEmail).toBeUndefined();
    expect(normalizeEntry({ ...base, authorEmail: 42 })?.id).toBe('x');
  });

  it('follows the revision that wins the merge', () => {
    const mine = make({ id: 'x', rev: 1, authorEmail: 'me@example.com' });
    const theirs = make({ id: 'x', rev: 2, authorEmail: 'ola@example.com' });
    const merged = mergeEntries([mine], [theirs]);
    expect(merged.entries[0].authorEmail).toBe('ola@example.com');
  });

  it('does not resurrect an author the winning revision dropped', () => {
    // An entry logged before sharing existed has no author, and a merge must not invent one for it
    // from the losing side.
    const older = make({ id: 'x', rev: 1, authorEmail: 'me@example.com' });
    const newer = make({ id: 'x', rev: 2 });
    expect(mergeEntries([older], [newer]).entries[0].authorEmail).toBeUndefined();
  });
});

describe('applyLocalEntries', () => {
  /*
   * A local write is not a concurrent one. The human at the form is replacing what is on their own
   * screen, so `pickVersioned`'s tiebreaks — and above all its absorbing delete — have no conflict
   * to resolve here and must not be consulted. Sleep entries carry `uuid()` ids, so they can never
   * meet a tombstone of their own; the rule is stated here anyway because it is the same `commit`.
   */
  it('takes the local write whatever the stored copy says', () => {
    const gone = make({ id: 'x', deleted: true, rev: 5 });
    const back = make({ id: 'x', rev: 6, kind: 'night' });
    const [entry] = applyLocalEntries([gone], [back]);
    expect(entry.deleted).toBeUndefined();
    expect(entry.kind).toBe('night');
  });

  it('still lets a local delete through', () => {
    const live = make({ id: 'x' });
    expect(applyLocalEntries([live], [tombstone(live, T0)])[0].deleted).toBe(true);
  });

  it('keeps the newest-first order when a new entry arrives', () => {
    const older = make({ id: 'a', start: T0 - 2 * HOUR, end: T0 - HOUR });
    const newer = make({ id: 'b', start: T0 - HOUR, end: T0 });
    expect(applyLocalEntries([older], [newer]).map((e) => e.id)).toEqual(['b', 'a']);
  });
});
