import { describe, expect, it } from 'vitest';
import { NO_IGNORES, ignoreEvent, ignoreIdFor, ignoredFingerprints, liftIgnore } from './ignores';
import { fingerprintOf, slugKey } from './normalize';
import { pickVersioned, type Versioned } from '../babySleep/versioned';
import type { Ignore } from './types';

const CTX = { writerId: 'w', now: 1_700_000_000_000 };
const EVENT = { fingerprint: fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14' }), title: 'Wesele Figara' };

describe('ignoreIdFor', () => {
  it('is the fingerprint, slugged — so two devices write one document', () => {
    expect(ignoreIdFor(EVENT.fingerprint)).toBe(slugKey(EVENT.fingerprint));
    expect(ignoreIdFor(EVENT.fingerprint)).toBe(ignoreIdFor(EVENT.fingerprint));
  });

  it('survives a fingerprint made only of the characters Firestore rejects', () => {
    // `fingerprintOf` emits `|` separators, and an undated event with no city is nearly all
    // separator. An id of '' or '..' is refused outright by Firestore.
    expect(ignoreIdFor('|undated|')).toBe('undated');
    expect(ignoreIdFor('||')).toBe('x');
  });
});

describe('ignoreEvent', () => {
  it('starts a fresh row at rev 0', () => {
    const ignore = ignoreEvent(EVENT, undefined, CTX);
    expect(ignore).toMatchObject({ rev: 0, fingerprint: EVENT.fingerprint, title: 'Wesele Figara' });
    expect(ignore.deleted).toBeUndefined();
  });

  it('re-ignoring beats its own tombstone', () => {
    /*
     * The case a derived id makes ordinary rather than theoretical: ignore, un-ignore, ignore
     * again is three writes to one document. Minting a fresh row at rev 0 would land underneath
     * the tombstone, the other device would keep the delete, and the card would silently refuse to
     * stay hidden — with the local copy insisting it was.
     */
    const first = ignoreEvent(EVENT, undefined, CTX);
    const lifted = liftIgnore(first, { ...CTX, now: CTX.now + 1000 });
    const again = ignoreEvent(EVENT, lifted, { ...CTX, now: CTX.now + 2000 });
    expect(again.rev).toBeGreaterThan(lifted.rev);
    expect(pickVersioned(lifted, again).deleted).toBeUndefined();
  });
});

describe('liftIgnore', () => {
  it('is a tombstone, never a removal — the delete has to reach the other device', () => {
    const lifted = liftIgnore(ignoreEvent(EVENT, undefined, CTX), CTX);
    expect(lifted.deleted).toBe(true);
    expect(lifted.fingerprint).toBe(EVENT.fingerprint);
  });

  it('absorbs a concurrent write at or below its rev', () => {
    const first = ignoreEvent(EVENT, undefined, CTX);
    const lifted = liftIgnore(first, CTX);
    const stale: Ignore = { ...first, rev: 1, updatedAt: CTX.now + 5000 };
    expect(pickVersioned(lifted, stale).deleted).toBe(true);
  });
});

describe('ignoredFingerprints', () => {
  it('is the live rows only, so a lifted ignore stops hiding anything', () => {
    const a = ignoreEvent(EVENT, undefined, CTX);
    const b = ignoreEvent({ fingerprint: 'other|2027-02-01|', title: 'Other' }, undefined, CTX);
    expect([...ignoredFingerprints([a, b])].sort()).toEqual([EVENT.fingerprint, 'other|2027-02-01|'].sort());
    expect([...ignoredFingerprints([liftIgnore(a, CTX), b])]).toEqual(['other|2027-02-01|']);
  });

  it('is empty for an empty list, not a constraint that matches everything', () => {
    expect(ignoredFingerprints([]).size).toBe(0);
    expect(NO_IGNORES.size).toBe(0);
  });
});

describe('compatibility with the sleep log reconciler', () => {
  it('an Ignore is structurally a Versioned, so mergeById handles it untold', () => {
    const asVersioned: Versioned = ignoreEvent(EVENT, undefined, CTX);
    expect(asVersioned.id).toBe(ignoreIdFor(EVENT.fingerprint));
  });
});
