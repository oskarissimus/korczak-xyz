import { describe, expect, it } from 'vitest';
import {
  newInterest,
  parseKeywords,
  reviseInterest,
  seedInterests,
  SEED_INTERESTS,
  tombstoneInterest,
  withMissingSeeds,
} from './interests';
import { pickVersioned, type Versioned } from '../babySleep/versioned';
import type { Interest } from './types';

const CTX = { writerId: 'w', now: 1_700_000_000_000 };

describe('the seeded interests', () => {
  it('covers the five things he asked for', () => {
    expect(SEED_INTERESTS.map((s) => s.label)).toEqual([
      'Klezmer',
      'Pink Floyd',
      'Castles & medieval fairs',
      'Python & dev',
      'Opera Narodowa',
    ]);
  });

  it('gives the opera interest NO keywords, which is the point of it', () => {
    // "Tell me when new repertoire is announced" is not a keyword search; it is "everything this
    // house puts on". matchesInterest reads an empty keyword list as no constraint for this.
    const opera = SEED_INTERESTS.find((s) => s.id === 'events-seed-opera')!;
    expect(opera.keywords).toEqual([]);
    expect(opera.tags).toEqual(['opera']);
  });

  it('gives every seed a stable id, so re-seeding is idempotent', () => {
    const ids = SEED_INTERESTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('events-seed-'))).toBe(true);
  });
});

describe('withMissingSeeds', () => {
  it('seeds an empty account', () => {
    expect(withMissingSeeds([], CTX)).toHaveLength(SEED_INTERESTS.length);
  });

  it('is idempotent', () => {
    const once = withMissingSeeds([], CTX);
    expect(withMissingSeeds(once, CTX)).toHaveLength(once.length);
  });

  it('does NOT resurrect a seed the owner deleted', () => {
    // The whole reason this is not "seed when the list is empty": a deleted seed that comes back
    // on the next page load is the app arguing with you.
    const seeded = seedInterests(CTX);
    const withTombstone = seeded.map((i) =>
      i.id === 'events-seed-dev' ? tombstoneInterest(i, CTX) : i,
    );
    const after = withMissingSeeds(withTombstone, CTX);
    expect(after).toHaveLength(seeded.length);
    expect(after.find((i) => i.id === 'events-seed-dev')?.deleted).toBe(true);
  });

  it('adds a seed introduced by a later build without touching the rest', () => {
    const partial = seedInterests(CTX).filter((i) => i.id !== 'events-seed-opera');
    const after = withMissingSeeds(partial, CTX);
    expect(after).toHaveLength(SEED_INTERESTS.length);
    expect(after.find((i) => i.id === 'events-seed-opera')).toBeDefined();
  });
});

describe('editing', () => {
  const base = newInterest(
    { label: 'Jazz', keywords: ['jazz'], leadDays: 10 },
    { ...CTX, id: 'i1' },
  );

  it('bumps rev and leaves createdAt alone', () => {
    // createdAt is what stops an edit from re-arming the interest's whole backlog as fresh
    // announcements. If an edit moved it, changing one keyword would flood the phone.
    const later = { writerId: 'w', now: CTX.now + 90_000_000 };
    const edited = reviseInterest(base, { label: 'Jazz', keywords: ['jazz', 'bebop'], leadDays: 10 }, later);
    expect(edited.rev).toBe(1);
    expect(edited.createdAt).toBe(base.createdAt);
    expect(edited.updatedAt).toBe(later.now);
  });

  it('drops empty and duplicate keywords, case-insensitively', () => {
    const i = newInterest(
      { label: 'X', keywords: ['jazz', '  ', 'JAZZ', 'blues'], leadDays: 5 },
      { ...CTX, id: 'i' },
    );
    expect(i.keywords).toEqual(['jazz', 'blues']);
  });

  it('stores an absent optional list rather than an empty one', () => {
    // An empty array in Firestore is a field that means nothing and still costs a read.
    const i = newInterest({ label: 'X', keywords: ['a'], tags: [], leadDays: 5 }, { ...CTX, id: 'i' });
    expect(i.tags).toBeUndefined();
  });

  it('clamps a nonsense lead time', () => {
    const mk = (leadDays: number) =>
      newInterest({ label: 'X', keywords: ['a'], leadDays }, { ...CTX, id: 'i' }).leadDays;
    expect(mk(-5)).toBe(0);
    expect(mk(99999)).toBe(365);
    expect(mk(Number.NaN)).toBe(14);
  });
});

describe('compatibility with the sleep log reconciler', () => {
  it('an Interest is structurally a Versioned, so mergeById handles it untold', () => {
    const i = newInterest({ label: 'X', keywords: ['a'], leadDays: 5 }, { ...CTX, id: 'i' });
    const asVersioned: Versioned = i;
    expect(asVersioned.id).toBe('i');
  });

  it('a delete absorbs a concurrent edit at or below its rev', () => {
    const i = newInterest({ label: 'X', keywords: ['a'], leadDays: 5 }, { ...CTX, id: 'i' });
    const gone = tombstoneInterest(i, CTX);
    const edited: Interest = { ...i, rev: 1, updatedAt: CTX.now + 1000 };
    expect(pickVersioned(gone, edited).deleted).toBe(true);
  });

  it('...but a later re-creation beats the tombstone', () => {
    const i = newInterest({ label: 'X', keywords: ['a'], leadDays: 5 }, { ...CTX, id: 'i' });
    const gone = tombstoneInterest(i, CTX);
    const relogged: Interest = { ...i, rev: gone.rev + 1, updatedAt: CTX.now + 2000 };
    expect(pickVersioned(gone, relogged).deleted).toBeUndefined();
  });
});

describe('parseKeywords', () => {
  it('splits on commas and newlines and tidies up', () => {
    expect(parseKeywords('klezmer*, yiddish\n  jewish music ,, klezmer*')).toEqual([
      'klezmer*',
      'yiddish',
      'jewish music',
    ]);
  });

  it('is empty for empty input, which is a valid interest', () => {
    expect(parseKeywords('   ')).toEqual([]);
  });
});
