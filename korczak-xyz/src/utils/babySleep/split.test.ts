import { describe, expect, it } from 'vitest';

import { canSplit, defaultSplit, splitEntry } from './split';
import type { SleepEntry, SleepKind } from './types';
import { MIN_SLEEP_MS } from './types';

const local = (d: number, h: number, mi = 0) => new Date(2026, 0, d, h, mi, 0, 0).getTime();
/** Morning after the night below, so a closed night is never in the future. */
const NOW = local(16, 9);
const MINUTE = 60_000;

let seq = 0;
function entry(
  kind: SleepKind,
  start: number,
  end: number | null,
  extra: Partial<SleepEntry> = {}
): SleepEntry {
  seq += 1;
  return { id: `e${seq}`, kind, start, end, rev: 3, updatedAt: start, writerId: 'w', ...extra };
}

/** 20:00 to 06:30 — the ordinary night everything here is cut out of. */
const night = () => entry('night', local(15, 20), local(16, 6, 30));

describe('splitEntry', () => {
  it('cuts a night into the two blocks it was slept in', () => {
    const outcome = splitEntry(night(), local(16, 3), local(16, 3, 25), NOW);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [first, second] = outcome.entries;
    expect([first.start, first.end]).toEqual([local(15, 20), local(16, 3)]);
    expect([second.start, second.end]).toEqual([local(16, 3, 25), local(16, 6, 30)]);
    expect(second.kind).toBe('night');
  });

  it('keeps the original id on the first half, so other devices see an edit and not a delete', () => {
    const original = night();
    const outcome = splitEntry(original, local(16, 3), local(16, 3, 25), NOW);
    if (!outcome.ok) throw new Error('expected a split');
    const [first, second] = outcome.entries;
    expect(first.id).toBe(original.id);
    expect(first.rev).toBe(original.rev + 1);
    expect(second.id).not.toBe(original.id);
    expect(second.rev).toBe(0);
  });

  it('carries the original author to the second half — who recorded it has not changed', () => {
    const original = night();
    original.authorEmail = 'ola@example.com';
    const outcome = splitEntry(original, local(16, 3), local(16, 3, 25), NOW);
    if (!outcome.ok) throw new Error('expected a split');
    expect(outcome.entries[1].authorEmail).toBe('ola@example.com');
  });

  it('leaves no author key at all when the sleep was logged signed out', () => {
    const outcome = splitEntry(night(), local(16, 3), local(16, 3, 25), NOW);
    if (!outcome.ok) throw new Error('expected a split');
    expect('authorEmail' in outcome.entries[1]).toBe(false);
  });

  it('splits a running sleep and leaves the second half running', () => {
    const outcome = splitEntry(entry('night', local(15, 20), null), local(16, 3), local(16, 3, 25), NOW);
    if (!outcome.ok) throw new Error('expected a split');
    const [first, second] = outcome.entries;
    expect(first.end).toBe(local(16, 3));
    expect(second.end).toBeNull();
    expect(second.start).toBe(local(16, 3, 25));
  });

  it('splits a nap as a nap', () => {
    const nap = entry('nap', local(16, 8), local(16, 8, 40));
    const outcome = splitEntry(nap, local(16, 8, 20), local(16, 8, 25), NOW);
    if (!outcome.ok) throw new Error('expected a split');
    expect(outcome.entries.map((e) => e.kind)).toEqual(['nap', 'nap']);
  });

  it('rejects a waking outside the sleep, on either side', () => {
    expect(splitEntry(night(), local(15, 19), local(15, 19, 30), NOW)).toEqual({
      ok: false,
      error: 'wake-outside',
    });
    expect(splitEntry(night(), local(16, 7), local(16, 7, 30), NOW)).toEqual({
      ok: false,
      error: 'wake-outside',
    });
  });

  it('rejects falling asleep again past the end of the sleep', () => {
    expect(splitEntry(night(), local(16, 3), local(16, 7), NOW)).toEqual({
      ok: false,
      error: 'wake-outside',
    });
  });

  it('rejects falling asleep again before, or at, the waking', () => {
    expect(splitEntry(night(), local(16, 3), local(16, 2), NOW)).toEqual({
      ok: false,
      error: 'wake-order',
    });
    expect(splitEntry(night(), local(16, 3), local(16, 3), NOW)).toEqual({
      ok: false,
      error: 'wake-order',
    });
  });

  it('rejects a cut that would leave a piece too short to believe', () => {
    // Two minutes after falling asleep.
    expect(splitEntry(night(), local(15, 20, 2), local(15, 20, 30), NOW)).toEqual({
      ok: false,
      error: 'too-short',
    });
    // Back to sleep two minutes before the morning.
    expect(splitEntry(night(), local(16, 3), local(16, 6, 28), NOW)).toEqual({
      ok: false,
      error: 'too-short',
    });
  });

  it('does not require a minimum second half of a sleep that is still running', () => {
    const running = entry('night', local(15, 20), null);
    const outcome = splitEntry(running, NOW - 3 * MINUTE, NOW - MINUTE, NOW);
    expect(outcome.ok).toBe(true);
  });

  it('rejects instants in the future and a tombstone', () => {
    expect(splitEntry(night(), NOW + MINUTE, NOW + 2 * MINUTE, NOW)).toEqual({
      ok: false,
      error: 'future',
    });
    const gone = entry('night', local(15, 20), local(16, 6, 30), { deleted: true });
    expect(splitEntry(gone, local(16, 3), local(16, 3, 25), NOW)).toEqual({
      ok: false,
      error: 'not-splittable',
    });
  });

  it('rejects a non-finite instant rather than writing NaN into the log', () => {
    expect(splitEntry(night(), Number.NaN, local(16, 3), NOW)).toEqual({
      ok: false,
      error: 'wake-outside',
    });
  });
});

describe('canSplit', () => {
  it('accepts a sleep with room for two halves and a waking between them', () => {
    expect(canSplit(night(), NOW)).toBe(true);
    const tight = entry('nap', local(16, 8), local(16, 8) + 2 * MIN_SLEEP_MS + MINUTE);
    expect(canSplit(tight, NOW)).toBe(true);
  });

  it('refuses one with no room, a tombstone, and a sleep that has barely started', () => {
    const short = entry('nap', local(16, 8), local(16, 8) + 2 * MIN_SLEEP_MS);
    expect(canSplit(short, NOW)).toBe(false);
    expect(canSplit(entry('night', local(15, 20), local(16, 6), { deleted: true }), NOW)).toBe(false);
    expect(canSplit(entry('nap', NOW - 2 * MINUTE, null), NOW)).toBe(false);
  });

  it('asks half as much of a running sleep, whose second half has no length yet', () => {
    const running = entry('nap', NOW - (MIN_SLEEP_MS + MINUTE), null);
    expect(canSplit(running, NOW)).toBe(true);
  });
});

describe('defaultSplit', () => {
  it('opens on a valid pair for any sleep the button is offered on', () => {
    const cases: SleepEntry[] = [
      night(),
      entry('night', local(15, 20), null),
      entry('nap', local(16, 8), local(16, 8) + 2 * MIN_SLEEP_MS + MINUTE),
      entry('nap', NOW - (MIN_SLEEP_MS + MINUTE), null),
      entry('nap', local(16, 7), local(16, 8, 30)),
    ];
    for (const e of cases) {
      expect(canSplit(e, NOW)).toBe(true);
      const { wakeAt, sleepAt } = defaultSplit(e, NOW);
      expect(splitEntry(e, wakeAt, sleepAt, NOW).ok).toBe(true);
    }
  });

  it('puts the waking in the middle of the night, on a five-minute mark', () => {
    const { wakeAt, sleepAt } = defaultSplit(night(), NOW);
    expect(wakeAt).toBe(local(16, 1, 15));
    expect(sleepAt).toBe(local(16, 1, 35));
  });
});
