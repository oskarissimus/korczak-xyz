import { describe, expect, it } from 'vitest';

import { climateId, type ClimateRecord, type NightVerdict, type WindowState } from './climate';
import {
  groupByNight,
  isComplete,
  mergeClimate,
  recordsFor,
  visibleClimate,
  windowThreshold,
  type NightObservation,
} from './climateStats';

const T0 = new Date(2026, 0, 15, 21, 0, 0, 0).getTime();

function evening(
  night: string,
  tempC: number | null,
  window: WindowState | null,
  overrides: Partial<ClimateRecord> = {}
): ClimateRecord {
  return {
    id: climateId(night, 'eve'),
    night,
    part: 'eve',
    tempC,
    window,
    verdict: null,
    rev: 0,
    updatedAt: T0,
    writerId: 'a',
    ...overrides,
  };
}

function morning(
  night: string,
  verdict: NightVerdict | null,
  overrides: Partial<ClimateRecord> = {}
): ClimateRecord {
  return {
    id: climateId(night, 'am'),
    night,
    part: 'am',
    tempC: null,
    window: null,
    verdict,
    rev: 0,
    updatedAt: T0,
    writerId: 'a',
    ...overrides,
  };
}

/** A complete night, as the threshold wants it. */
function night(n: string, tempC: number, window: WindowState, verdict: NightVerdict): NightObservation {
  return { night: n, at: 0, tempC, window, verdict };
}

describe('mergeClimate', () => {
  it('keeps both halves of a night written on two devices', () => {
    const local = [evening('2026-01-15', 11, 'open')];
    const remote = [morning('2026-01-15', 'ok')];
    const merged = mergeClimate(local, remote);
    expect(merged.records).toHaveLength(2);
    // This is the whole reason a night is two records: neither half can overwrite the other.
    expect(groupByNight(merged.records)[0]).toMatchObject({ tempC: 11, verdict: 'ok' });
  });

  it('prefers the higher revision over a fast clock', () => {
    const mine = evening('2026-01-15', 9, 'closed', { rev: 2, updatedAt: T0 });
    const theirs = evening('2026-01-15', 20, 'open', { rev: 1, updatedAt: T0 + 600_000 });
    expect(mergeClimate([mine], [theirs]).records[0].tempC).toBe(9);
  });

  it('lets a delete absorb a concurrent edit', () => {
    const gone = evening('2026-01-15', 11, 'open', { rev: 1, deleted: true });
    const edited = evening('2026-01-15', 12, 'open', { rev: 2 });
    expect(mergeClimate([gone], [edited]).records[0].deleted).toBe(true);
  });

  it('does not re-push a record the cloud already holds identically', () => {
    const record = evening('2026-01-15', 11, 'open');
    expect(mergeClimate([record], [{ ...record }]).localWins).toEqual([]);
  });

  it('pushes a record the cloud has never seen', () => {
    expect(mergeClimate([evening('2026-01-15', 11, 'open')], []).localWins).toEqual([
      '2026-01-15-eve',
    ]);
  });

  it('is commutative', () => {
    const a = [evening('2026-01-15', 11, 'open'), morning('2026-01-14', 'cold')];
    const b = [morning('2026-01-15', 'ok'), evening('2026-01-14', 8, 'open')];
    expect(mergeClimate(a, b).records).toEqual(mergeClimate(b, a).records);
  });

  it('sorts newest night first', () => {
    const merged = mergeClimate(
      [evening('2026-01-14', 8, 'open'), evening('2026-01-16', 12, 'open')],
      []
    );
    expect(merged.records.map((r) => r.night)).toEqual(['2026-01-16', '2026-01-14']);
  });
});

describe('visibleClimate', () => {
  it('drops tombstones', () => {
    const records = [evening('2026-01-15', 11, 'open', { deleted: true }), morning('2026-01-15', 'ok')];
    expect(visibleClimate(records)).toHaveLength(1);
  });
});

describe('groupByNight', () => {
  it('joins the two halves into one row', () => {
    const rows = groupByNight([evening('2026-01-15', 11, 'open'), morning('2026-01-15', 'cold')]);
    expect(rows).toEqual([
      {
        night: '2026-01-15',
        at: new Date(2026, 0, 15).getTime(),
        tempC: 11,
        window: 'open',
        verdict: 'cold',
      },
    ]);
  });

  it('keeps a night that has only been half logged', () => {
    const rows = groupByNight([evening('2026-01-15', 11, 'open')]);
    expect(rows[0]).toMatchObject({ tempC: 11, verdict: null });
  });

  it('leaves the other half standing when one is cleared', () => {
    const rows = groupByNight([
      evening('2026-01-15', 11, 'open'),
      morning('2026-01-15', 'cold', { deleted: true }),
    ]);
    expect(rows[0]).toMatchObject({ tempC: 11, verdict: null });
  });

  it('drops a night whose halves are both gone rather than showing an empty row', () => {
    const rows = groupByNight([
      evening('2026-01-15', 11, 'open', { deleted: true }),
      morning('2026-01-15', 'cold', { deleted: true }),
    ]);
    expect(rows).toEqual([]);
  });

  it('drops a night that was written and then blanked', () => {
    expect(groupByNight([evening('2026-01-15', null, null), morning('2026-01-15', null)])).toEqual([]);
  });

  it('names whoever logged either half', () => {
    const rows = groupByNight([morning('2026-01-15', 'ok', { authorEmail: 'her@b.c' })]);
    expect(rows[0].authorEmail).toBe('her@b.c');
  });

  it('sorts newest night first', () => {
    const rows = groupByNight([evening('2026-01-14', 8, 'open'), evening('2026-01-16', 12, 'open')]);
    expect(rows.map((r) => r.night)).toEqual(['2026-01-16', '2026-01-14']);
  });
});

describe('recordsFor', () => {
  it('finds each half by its derived id', () => {
    const records = [evening('2026-01-15', 11, 'open'), morning('2026-01-15', 'ok')];
    const found = recordsFor(records, '2026-01-15');
    expect(found.eve?.tempC).toBe(11);
    expect(found.am?.verdict).toBe('ok');
    expect(recordsFor(records, '2026-01-14').eve).toBeUndefined();
  });
});

describe('isComplete', () => {
  it('needs all three facts', () => {
    expect(isComplete(night('2026-01-15', 11, 'open', 'ok'))).toBe(true);
    expect(isComplete({ night: '2026-01-15', at: 0, tempC: 11, window: 'open', verdict: null })).toBe(
      false
    );
    expect(isComplete({ night: '2026-01-15', at: 0, tempC: null, window: 'open', verdict: 'ok' })).toBe(
      false
    );
  });
});

describe('windowThreshold', () => {
  it('reports nothing rather than zero when nothing is logged', () => {
    expect(windowThreshold([], 'open')).toEqual({
      okFloor: null,
      coldCeiling: null,
      n: 0,
      nCold: 0,
      settled: false,
    });
  });

  it('finds the coldest night that was fine and the warmest that was not', () => {
    const nights = [
      night('2026-01-15', 14, 'open', 'ok'),
      night('2026-01-14', 12, 'open', 'ok'),
      night('2026-01-13', 9, 'open', 'cold'),
      night('2026-01-12', 8, 'open', 'cold'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({
      okFloor: 12,
      coldCeiling: 9,
      n: 4,
      nCold: 2,
      settled: true,
    });
  });

  it('counts "too warm" as not cold — the question is only about the bottom end', () => {
    const nights = [
      night('2026-01-15', 18, 'open', 'warm'),
      night('2026-01-14', 12, 'open', 'warm'),
      night('2026-01-13', 9, 'open', 'cold'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({ okFloor: 12, coldCeiling: 9, settled: true });
  });

  it('is unsettled while the two populations overlap', () => {
    const nights = [
      night('2026-01-15', 14, 'open', 'ok'),
      night('2026-01-14', 10, 'open', 'ok'),
      night('2026-01-13', 12, 'open', 'cold'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({
      okFloor: 10,
      coldCeiling: 12,
      settled: false,
    });
  });

  it('is settled with no cold night at all — the floor simply has not been found', () => {
    const nights = [
      night('2026-01-15', 14, 'open', 'ok'),
      night('2026-01-14', 13, 'open', 'ok'),
      night('2026-01-13', 12, 'open', 'ok'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({
      okFloor: 12,
      coldCeiling: null,
      settled: true,
    });
  });

  it('will not call two clean nights settled', () => {
    const nights = [night('2026-01-15', 14, 'open', 'ok'), night('2026-01-14', 9, 'open', 'cold')];
    expect(windowThreshold(nights, 'open').settled).toBe(false);
  });

  it('keeps the two window states apart', () => {
    const nights = [
      night('2026-01-15', 14, 'open', 'ok'),
      night('2026-01-14', 4, 'closed', 'ok'),
      night('2026-01-13', 3, 'closed', 'ok'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({ n: 1, okFloor: 14 });
    expect(windowThreshold(nights, 'closed')).toMatchObject({ n: 2, okFloor: 3 });
  });

  it('ignores a half-logged night', () => {
    const nights: NightObservation[] = [
      { night: '2026-01-15', at: 0, tempC: 6, window: 'open', verdict: null },
      night('2026-01-14', 14, 'open', 'ok'),
    ];
    expect(windowThreshold(nights, 'open')).toMatchObject({ n: 1, okFloor: 14 });
  });
});
