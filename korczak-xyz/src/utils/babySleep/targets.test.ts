import { describe, expect, it } from 'vitest';

import { minutesFromTimeInput } from './format';
import type { SleepTargets } from './targets';
import {
  TARGETS_ID,
  isClockMinutes,
  mergeTargets,
  normalizeTargets,
  sameTargets,
  setCribTarget,
} from './targets';

const NOW = new Date(2026, 7, 18, 20, 30, 0, 0).getTime();

function targets(overrides: Partial<SleepTargets> = {}): SleepTargets {
  return {
    id: TARGETS_ID,
    cribMinutes: 19 * 60 + 15,
    rev: 0,
    updatedAt: NOW,
    writerId: 'a',
    ...overrides,
  };
}

describe('isClockMinutes', () => {
  it('accepts a whole minute inside one day', () => {
    expect(isClockMinutes(0)).toBe(true);
    expect(isClockMinutes(1439)).toBe(true);
  });

  it('rejects anything that is not one', () => {
    expect(isClockMinutes(1440)).toBe(false);
    expect(isClockMinutes(-1)).toBe(false);
    expect(isClockMinutes(19.5)).toBe(false);
    expect(isClockMinutes('19:15')).toBe(false);
    expect(isClockMinutes(null)).toBe(false);
    expect(isClockMinutes(NaN)).toBe(false);
  });
});

describe('minutesFromTimeInput', () => {
  it('reads a time field', () => {
    expect(minutesFromTimeInput('19:15')).toBe(19 * 60 + 15);
    expect(minutesFromTimeInput('00:00')).toBe(0);
    expect(minutesFromTimeInput('23:59')).toBe(1439);
  });

  it('is null for an empty or impossible field', () => {
    // The empty field is what the Save button has to reject rather than read as midnight.
    expect(minutesFromTimeInput('')).toBeNull();
    expect(minutesFromTimeInput('19')).toBeNull();
    expect(minutesFromTimeInput('24:00')).toBeNull();
    expect(minutesFromTimeInput('19:75')).toBeNull();
    expect(minutesFromTimeInput('bedtime')).toBeNull();
  });
});

describe('setCribTarget', () => {
  it('starts a first target at rev 0', () => {
    const first = setCribTarget(1155, NOW);
    expect(first).toMatchObject({ id: TARGETS_ID, cribMinutes: 1155, rev: 0, updatedAt: NOW });
  });

  it('moves rev forward over what the log already holds', () => {
    const next = setCribTarget(1140, NOW + 1000, targets({ rev: 3 }));
    expect(next.rev).toBe(4);
    expect(next.cribMinutes).toBe(1140);
  });

  it('clears to null without a tombstone, so the same id stays writable', () => {
    const cleared = setCribTarget(null, NOW + 1000, targets({ rev: 1 }));
    expect(cleared.cribMinutes).toBeNull();
    expect(cleared.deleted).toBeUndefined();

    // The whole reason clearing is a value: setting one again afterwards is an ordinary edit, not a
    // write that has to get past a delete.
    const again = setCribTarget(1200, NOW + 2000, cleared);
    expect(again.cribMinutes).toBe(1200);
    expect(again.rev).toBe(cleared.rev + 1);
  });
});

describe('mergeTargets', () => {
  it('takes whichever side has one when the other has none', () => {
    const mine = targets();
    expect(mergeTargets(mine, null)).toBe(mine);
    expect(mergeTargets(null, mine)).toBe(mine);
    expect(mergeTargets(null, null)).toBeNull();
  });

  it('prefers the higher revision over the later clock', () => {
    const mine = targets({ rev: 2, cribMinutes: 1140, updatedAt: NOW });
    const theirs = targets({ rev: 1, cribMinutes: 1200, updatedAt: NOW + 60_000, writerId: 'b' });
    expect(mergeTargets(mine, theirs)).toBe(mine);
  });

  it('falls back to the clock at an equal revision', () => {
    const mine = targets({ rev: 1, updatedAt: NOW });
    const theirs = targets({ rev: 1, updatedAt: NOW + 1, writerId: 'b' });
    expect(mergeTargets(mine, theirs)).toBe(theirs);
  });

  it('is commutative, so the two devices land on the same target', () => {
    const mine = targets({ rev: 2, cribMinutes: 1140 });
    const theirs = targets({ rev: 3, cribMinutes: 1200, writerId: 'b' });
    expect(mergeTargets(mine, theirs)).toEqual(mergeTargets(theirs, mine));
  });
});

describe('sameTargets', () => {
  it('separates an identical copy from one that merely ties on version', () => {
    expect(sameTargets(targets(), targets())).toBe(true);
    expect(sameTargets(targets(), targets({ cribMinutes: 1200 }))).toBe(false);
    expect(sameTargets(targets(), targets({ rev: 1 }))).toBe(false);
  });
});

describe('normalizeTargets', () => {
  it('reads back what it wrote', () => {
    const record = setCribTarget(1155, NOW);
    expect(normalizeTargets(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it('rejects anything that is not this document', () => {
    expect(normalizeTargets(null)).toBeNull();
    expect(normalizeTargets('targets')).toBeNull();
    // What `adoptOwner` writes into every per-owner key when the account changes.
    expect(normalizeTargets([])).toBeNull();
    expect(normalizeTargets({ ...targets(), id: '2026-08-18' })).toBeNull();
  });

  it('takes an unreadable target as no target, keeping the revision to move on from', () => {
    const record = normalizeTargets({ ...targets({ rev: 4 }), cribMinutes: '19:15' });
    expect(record).not.toBeNull();
    expect(record?.cribMinutes).toBeNull();
    expect(record?.rev).toBe(4);
  });

  it('strips fields it does not know about', () => {
    const record = normalizeTargets({ ...targets(), wakeMinutes: 420 });
    expect(record).not.toHaveProperty('wakeMinutes');
  });
});
