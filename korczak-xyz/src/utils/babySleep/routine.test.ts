import { describe, expect, it } from 'vitest';

import { dayKeyOf } from './days';
import {
  MAX_ROUTINE_MS,
  isStaleRoutine,
  normalizeRoutine,
  parseRoutineId,
  routineKey,
  routineLength,
  routineNightKey,
  setRoutine,
  tombstoneRoutine,
  validateRoutine,
  type RoutineRecord,
} from './routine';
import type { SleepEntry } from './types';

const NIGHT = '2026-01-15';
const T0 = new Date(2026, 0, 15, 19, 0, 0, 0).getTime();
const CRIB = new Date(2026, 0, 15, 19, 25, 0, 0).getTime();
const NOW = new Date(2026, 0, 15, 20, 0, 0, 0).getTime();
const NIGHT_KEY = { id: NIGHT, night: NIGHT, kind: 'night' } as const;

function routine(overrides: Partial<RoutineRecord> = {}): RoutineRecord {
  return {
    id: NIGHT,
    night: NIGHT,
    kind: 'night',
    start: T0,
    end: CRIB,
    rev: 0,
    updatedAt: T0,
    writerId: 'a',
    ...overrides,
  };
}

function nightEntry(start: number): SleepEntry {
  return { id: 'e', kind: 'night', start, end: null, rev: 0, updatedAt: start, writerId: 'a' };
}

describe('routineNightKey', () => {
  it('files an evening routine under that evening', () => {
    expect(routineNightKey(T0)).toBe(NIGHT);
  });

  it('agrees with the night entry that follows it, across the 06:00 cutoff', () => {
    // A routine begun at 23:50 and the sleep that starts at 00:20 are one night.
    const late = new Date(2026, 0, 15, 23, 50, 0, 0).getTime();
    const asleep = new Date(2026, 0, 16, 0, 20, 0, 0).getTime();
    expect(routineNightKey(late)).toBe(dayKeyOf(nightEntry(asleep)));

    // And a routine that itself began after midnight belongs to the evening before.
    const afterMidnight = new Date(2026, 0, 16, 0, 10, 0, 0).getTime();
    expect(routineNightKey(afterMidnight)).toBe(NIGHT);
    expect(routineNightKey(afterMidnight)).toBe(dayKeyOf(nightEntry(asleep)));
  });

  it('is back on today once the cutoff has passed', () => {
    expect(routineNightKey(new Date(2026, 0, 16, 7, 0, 0, 0).getTime())).toBe('2026-01-16');
  });
});

describe('routineKey', () => {
  it('mints the bare night key for a night, unchanged since routines were night-only', () => {
    expect(routineKey('night', T0)).toEqual({ id: NIGHT, night: NIGHT, kind: 'night' });
  });

  it('mints a nap id carrying the day and the hh:mm it started', () => {
    const noon = new Date(2026, 0, 15, 12, 30, 0, 0).getTime();
    expect(routineKey('nap', noon)).toEqual({
      id: '2026-01-15-nap-1230',
      night: NIGHT,
      kind: 'nap',
    });
  });

  it('pads the time, so an id is one length and sorts by it', () => {
    expect(routineKey('nap', new Date(2026, 0, 15, 9, 5, 0, 0).getTime()).id).toBe(
      '2026-01-15-nap-0905'
    );
  });

  it('applies the 06:00 cutoff to a night and never to a nap', () => {
    // The cutoff is nights only — shifting a nap back six hours would file a 9am one under
    // yesterday, and the morning nap is the commonest kind.
    const small = new Date(2026, 0, 16, 5, 0, 0, 0).getTime();
    expect(routineKey('night', small).night).toBe(NIGHT);
    expect(routineKey('nap', small).night).toBe('2026-01-16');
  });

  it('gives two taps in the same minute the same id, and two a minute apart two', () => {
    // The convergence the derived id exists for, and the duplicate that is its accepted cost.
    const at = (h: number, m: number, sec: number) =>
      routineKey('nap', new Date(2026, 0, 15, h, m, sec, 0).getTime()).id;
    expect(at(12, 30, 5)).toBe(at(12, 30, 55));
    expect(at(12, 30, 5)).not.toBe(at(12, 31, 5));
  });
});

describe('parseRoutineId', () => {
  it('round-trips both grammars', () => {
    for (const key of [routineKey('night', T0), routineKey('nap', T0)]) {
      expect(parseRoutineId(key.id)).toEqual(key);
    }
  });

  it('refuses an id this app could never have minted', () => {
    for (const id of [
      '2026-01-15-nap-2500', // no such hour
      '2026-01-15-nap-1260', // no such minute
      '2026-01-15-nap-930', // unpadded, so not what `routineKey` writes
      '2026-01-15-nap',
      '2026-01-15-nap-1230-1',
      '2026-01-15-eve', // a climate id, which is a different collection
      'nope',
      '',
    ]) {
      expect(parseRoutineId(id)).toBeNull();
    }
  });
});

describe('validateRoutine', () => {
  it('accepts a routine that has not ended yet', () => {
    expect(validateRoutine({ start: T0, end: null }, NOW)).toBeNull();
  });

  it('accepts a five-minute routine — there is no minimum', () => {
    expect(validateRoutine({ start: T0, end: T0 + 5 * 60_000 }, NOW)).toBeNull();
  });

  it('rejects a crib time at or before the start', () => {
    expect(validateRoutine({ start: T0, end: T0 }, NOW)).toBe('end-before-start');
    expect(validateRoutine({ start: T0, end: T0 - 60_000 }, NOW)).toBe('end-before-start');
  });

  it('rejects the future on either field', () => {
    expect(validateRoutine({ start: NOW + 60_000, end: null }, NOW)).toBe('future');
    expect(validateRoutine({ start: T0, end: NOW + 60_000 }, NOW)).toBe('future');
  });

  it('rejects a routine longer than four hours', () => {
    const end = T0 + MAX_ROUTINE_MS + 60_000;
    expect(validateRoutine({ start: T0, end }, end + 1)).toBe('too-long');
  });

  it('rejects a start that is not a number at all', () => {
    expect(validateRoutine({ start: NaN, end: null }, NOW)).toBe('no-start');
  });
});

describe('isStaleRoutine / routineLength', () => {
  it('calls an open routine stale once it passes four hours', () => {
    const open = routine({ end: null });
    expect(isStaleRoutine(open, T0 + MAX_ROUTINE_MS - 1)).toBe(false);
    expect(isStaleRoutine(open, T0 + MAX_ROUTINE_MS + 1)).toBe(true);
  });

  it('never calls a closed one stale, however long ago it was', () => {
    expect(isStaleRoutine(routine(), T0 + 10 * MAX_ROUTINE_MS)).toBe(false);
  });

  it('has no length while it runs, and none when it is past believing', () => {
    expect(routineLength(routine({ end: null }))).toBeNull();
    expect(routineLength(routine())).toBe(25 * 60_000);
    expect(routineLength(routine({ end: T0 + MAX_ROUTINE_MS + 1 }))).toBeNull();
  });
});

describe('setRoutine', () => {
  it('starts a new record at rev 0 and keeps the author', () => {
    const first = setRoutine(NIGHT_KEY, { start: T0, end: null }, T0, undefined, 'a@b.c');
    expect(first).toMatchObject({ id: NIGHT, night: NIGHT, rev: 0, authorEmail: 'a@b.c' });
  });

  it('advances rev on an edit and leaves the author alone', () => {
    const first = setRoutine(NIGHT_KEY, { start: T0, end: null }, T0, undefined, 'a@b.c');
    const second = setRoutine(NIGHT_KEY, { start: T0, end: CRIB }, CRIB, first, 'other@b.c');
    expect(second.rev).toBe(1);
    expect(second.end).toBe(CRIB);
    expect(second.authorEmail).toBe('a@b.c');
  });

  it('revives a tombstone rather than carrying the flag forward', () => {
    const gone = tombstoneRoutine(routine(), NOW);
    const back = setRoutine(NIGHT_KEY, { start: T0, end: CRIB }, NOW, gone);
    expect(back.deleted).toBeUndefined();
    expect('deleted' in back).toBe(false);
    expect(back.rev).toBe(gone.rev + 1);
  });
});

describe('normalizeRoutine', () => {
  it('round-trips a record it made', () => {
    expect(normalizeRoutine(routine())).toEqual(routine());
  });

  it('rejects an id it could never have minted', () => {
    expect(normalizeRoutine({ ...routine(), id: '2026-01-15-eve' })).toBeNull();
    expect(normalizeRoutine({ ...routine(), id: 'nope' })).toBeNull();
    expect(normalizeRoutine({ ...routine(), id: '' })).toBeNull();
  });

  it('reads a nap id back into its day and its kind', () => {
    const nap = normalizeRoutine({ ...routine(), id: '2026-01-15-nap-1230' });
    expect(nap).toMatchObject({ id: '2026-01-15-nap-1230', night: NIGHT, kind: 'nap' });
  });

  it('takes the id as the truth when `kind` disagrees with it', () => {
    // A stray document claiming to be a nap under a bare night key is a night routine.
    expect(normalizeRoutine({ ...routine(), kind: 'nap' })?.kind).toBe('night');
  });

  it('takes the id as the truth when `night` disagrees with it', () => {
    expect(normalizeRoutine({ ...routine(), night: '1999-01-01' })?.night).toBe(NIGHT);
  });

  it('rejects a record with no usable start', () => {
    expect(normalizeRoutine({ ...routine(), start: 'soon' })).toBeNull();
    expect(normalizeRoutine({ ...routine(), end: 'later' })).toBeNull();
  });

  it('strips a field it does not know about', () => {
    const extra = normalizeRoutine({ ...routine(), wakes: [1, 2, 3] }) as unknown as Record<
      string,
      unknown
    >;
    expect('wakes' in extra).toBe(false);
  });

  it('leaves out an absent author entirely, rather than writing undefined', () => {
    const record = normalizeRoutine(routine()) as unknown as Record<string, unknown>;
    expect('authorEmail' in record).toBe(false);
  });

  it('keeps a tombstone', () => {
    expect(normalizeRoutine(tombstoneRoutine(routine(), NOW))?.deleted).toBe(true);
  });
});
