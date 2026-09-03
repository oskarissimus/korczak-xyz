import { describe, expect, it } from 'vitest';
import {
  defaultLabel,
  newSegment,
  normalizeSegment,
  reviseSegment,
  SEED_SEGMENTS,
  segmentLength,
  segmentStations,
  tombstoneSegment,
  withMissingSeeds,
} from './segments';
import type { WatchedSegment } from './types';

const NOW = Date.parse('2026-09-03T12:00:00Z');

describe('normalizeSegment', () => {
  it('stores the canonical spelling, whatever was typed', () => {
    const safe = normalizeSegment({ label: '', line: 'M2', from: 'rondo daszynskiego', to: 'SWIETOKRZYSKA' });
    expect(safe).toMatchObject({ from: 'Rondo Daszyńskiego', to: 'Świętokrzyska' });
  });

  it('names an unnamed segment after itself, in words neither locale has to translate', () => {
    const safe = normalizeSegment({ label: '  ', line: 'M1', from: 'Imielin', to: 'Centrum' });
    expect(safe?.label).toBe('M1 · Imielin → Centrum');
    expect(defaultLabel('M1', 'Imielin', 'Centrum')).toBe(safe?.label);
  });

  /*
   * The gate that stops a segment matching nothing forever. A stretch from Rondo Daszyńskiego to
   * Imielin is not a ride, it is a change at Świętokrzyska, and the app holds it as two rows.
   */
  it('refuses a pair that does not lie on one line', () => {
    expect(normalizeSegment({ label: 'home', line: 'M1', from: 'Rondo Daszyńskiego', to: 'Imielin' })).toBeNull();
    expect(normalizeSegment({ label: 'home', line: 'M2', from: 'Rondo Daszyńskiego', to: 'Imielin' })).toBeNull();
  });

  it('refuses a station nothing knows about', () => {
    expect(normalizeSegment({ label: 'x', line: 'M1', from: 'Atlantyda', to: 'Centrum' })).toBeNull();
  });
});

describe('a segment as an interval', () => {
  it('covers everything between its endpoints', () => {
    expect(segmentStations({ line: 'M2', from: 'Rondo Daszyńskiego', to: 'Świętokrzyska' })).toEqual([
      'Rondo Daszyńskiego',
      'Rondo ONZ',
      'Świętokrzyska',
    ]);
    expect(segmentLength({ line: 'M1', from: 'Świętokrzyska', to: 'Imielin' })).toBe(11);
  });
});

describe('the seeded way home', () => {
  it('is two legs, because it is two lines with a change at Świętokrzyska', () => {
    expect(SEED_SEGMENTS).toHaveLength(2);
    expect(SEED_SEGMENTS.map((s) => s.line)).toEqual(['M2', 'M1']);
  });

  /*
   * The one property that could fail silently as the network grows: a station renamed out from
   * under this build turns a seed into a row that matches nothing and says nothing about why.
   */
  it('still resolves against the station tables', () => {
    for (const seed of SEED_SEGMENTS) {
      expect(normalizeSegment(seed), `${seed.id} no longer resolves`).not.toBeNull();
      expect(segmentStations(seed).length).toBeGreaterThan(1);
    }
  });

  it('covers Rondo ONZ, which is the whole reason a segment is an interval', () => {
    expect(segmentStations(SEED_SEGMENTS[0])).toContain('Rondo ONZ');
  });

  it('adds only what an account is missing, and never edits what it has', () => {
    const mine = newSegment(
      { label: 'mine', line: 'M2', from: 'Bemowo', to: 'Płocka' },
      SEED_SEGMENTS[0].id,
      'w',
      NOW,
    )!;
    const merged = withMissingSeeds([mine], 'w', NOW);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.id === SEED_SEGMENTS[0].id)?.label).toBe('mine');
  });

  it('leaves a deleted seed deleted', () => {
    const seeded = withMissingSeeds([], 'w', NOW);
    const dead = seeded.map((s) => tombstoneSegment(s, 'w', NOW + 1));
    expect(withMissingSeeds(dead, 'w', NOW + 2)).toHaveLength(2);
  });
});

describe('revisions', () => {
  it('bumps the revision and clears a flag the draft dropped', () => {
    const first = newSegment({ label: 'a', line: 'M1', from: 'Kabaty', to: 'Centrum', muted: true }, 'i', 'w', NOW)!;
    expect(first.muted).toBe(true);
    const second = reviseSegment(first, { label: 'a', line: 'M1', from: 'Kabaty', to: 'Centrum' }, 'w', NOW + 1)!;
    expect(second.muted).toBe(false);
    expect(second.rev).toBe(first.rev + 1);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('refuses a revision that would make the segment unmatched', () => {
    const first = newSegment({ label: 'a', line: 'M1', from: 'Kabaty', to: 'Centrum' }, 'i', 'w', NOW)!;
    expect(reviseSegment(first, { label: 'a', line: 'M1', from: 'Bemowo', to: 'Centrum' }, 'w', NOW + 1)).toBeNull();
  });

  it('travels as a tombstone rather than a delete', () => {
    const first = newSegment({ label: 'a', line: 'M1', from: 'Kabaty', to: 'Centrum' }, 'i', 'w', NOW)! as WatchedSegment;
    expect(tombstoneSegment(first, 'w', NOW + 1)).toMatchObject({ deleted: true, rev: 2 });
  });
});
