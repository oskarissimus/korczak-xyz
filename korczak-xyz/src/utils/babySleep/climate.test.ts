import { describe, expect, it } from 'vitest';

import {
  climateId,
  currentNightKey,
  normalizeClimate,
  parseClimateId,
  parseTemp,
  setEvening,
  setVerdict,
  tombstoneClimate,
  type ClimateRecord,
} from './climate';

const T0 = new Date(2026, 0, 15, 21, 0, 0, 0).getTime();

function eve(overrides: Partial<ClimateRecord> = {}): ClimateRecord {
  return {
    id: climateId('2026-01-15', 'eve'),
    night: '2026-01-15',
    part: 'eve',
    tempC: 11,
    window: 'open',
    verdict: null,
    rev: 0,
    updatedAt: T0,
    writerId: 'a',
    ...overrides,
  };
}

describe('climateId / parseClimateId', () => {
  it('round-trips both halves of a night', () => {
    for (const part of ['eve', 'am'] as const) {
      expect(parseClimateId(climateId('2026-01-15', part))).toEqual({
        night: '2026-01-15',
        part,
      });
    }
  });

  it('splits at the last hyphen, not the first — a day key carries two of its own', () => {
    expect(climateId('2026-01-15', 'am')).toBe('2026-01-15-am');
    expect(parseClimateId('2026-01-15-am')?.night).toBe('2026-01-15');
  });

  it('rejects an id that could never have been minted', () => {
    expect(parseClimateId('2026-01-15')).toBeNull();
    expect(parseClimateId('2026-01-15-noon')).toBeNull();
    expect(parseClimateId('tuesday-eve')).toBeNull();
    expect(parseClimateId('-eve')).toBeNull();
  });
});

describe('currentNightKey', () => {
  it('files an evening under today', () => {
    expect(currentNightKey(new Date(2026, 0, 15, 21, 30).getTime())).toBe('2026-01-15');
  });

  it('files a morning under the night that started yesterday', () => {
    expect(currentNightKey(new Date(2026, 0, 16, 7, 0).getTime())).toBe('2026-01-15');
  });

  it('turns over at noon', () => {
    expect(currentNightKey(new Date(2026, 0, 16, 11, 59).getTime())).toBe('2026-01-15');
    expect(currentNightKey(new Date(2026, 0, 16, 12, 0).getTime())).toBe('2026-01-16');
  });

  it('crosses a month and a year boundary backwards', () => {
    expect(currentNightKey(new Date(2026, 0, 1, 8, 0).getTime())).toBe('2025-12-31');
  });
});

describe('parseTemp', () => {
  it('reads an empty field as "not filled in", not as an error', () => {
    expect(parseTemp('')).toEqual({ ok: true, tempC: null });
    expect(parseTemp('   ')).toEqual({ ok: true, tempC: null });
  });

  it('accepts a comma as a decimal point', () => {
    expect(parseTemp('11,5')).toEqual({ ok: true, tempC: 11.5 });
  });

  it('accepts a negative', () => {
    expect(parseTemp('-3')).toEqual({ ok: true, tempC: -3 });
  });

  it('rounds to one decimal', () => {
    expect(parseTemp('11.44')).toEqual({ ok: true, tempC: 11.4 });
  });

  it('rejects nonsense and a fat-fingered magnitude', () => {
    expect(parseTemp('warm')).toEqual({ ok: false, error: 'not-a-number' });
    expect(parseTemp('112')).toEqual({ ok: false, error: 'out-of-range' });
    expect(parseTemp('-99')).toEqual({ ok: false, error: 'out-of-range' });
  });
});

describe('setEvening / setVerdict', () => {
  it('starts a fresh half at rev 0 and stamps the author', () => {
    const record = setEvening('2026-01-15', { tempC: 11, window: 'open' }, T0, undefined, 'a@b.c');
    expect(record.rev).toBe(0);
    expect(record.id).toBe('2026-01-15-eve');
    expect(record.authorEmail).toBe('a@b.c');
  });

  it('moves the revision on for an edit and keeps the original author', () => {
    const first = setEvening('2026-01-15', { tempC: 11, window: 'open' }, T0, undefined, 'a@b.c');
    const second = setEvening(
      '2026-01-15',
      { tempC: 9, window: 'closed' },
      T0 + 1000,
      first,
      'other@b.c'
    );
    expect(second.rev).toBe(1);
    expect(second.tempC).toBe(9);
    expect(second.authorEmail).toBe('a@b.c');
  });

  it('does not put a verdict on an evening record or a temperature on a morning one', () => {
    const evening = setEvening('2026-01-15', { tempC: 11, window: 'open' }, T0);
    const morning = setVerdict('2026-01-15', 'cold', T0);
    expect(evening.verdict).toBeNull();
    expect(morning.tempC).toBeNull();
    expect(morning.window).toBeNull();
  });

  it('revives a tombstone rather than writing an undefined Firestore rejects', () => {
    const gone = tombstoneClimate(eve(), T0 + 1000);
    const again = setEvening('2026-01-15', { tempC: 8, window: 'closed' }, T0 + 2000, gone);
    expect('deleted' in again).toBe(false);
    expect(again.rev).toBe(2);
  });

  it('clears a verdict without deleting the record', () => {
    const set = setVerdict('2026-01-15', 'cold', T0);
    const cleared = setVerdict('2026-01-15', null, T0 + 1000, set);
    expect(cleared.verdict).toBeNull();
    expect(cleared.rev).toBe(1);
  });
});

describe('normalizeClimate', () => {
  it('accepts a well-formed record', () => {
    expect(normalizeClimate(eve())).toEqual(eve());
  });

  it('rejects a row with no usable id', () => {
    expect(normalizeClimate(null)).toBeNull();
    expect(normalizeClimate({})).toBeNull();
    expect(normalizeClimate({ ...eve(), id: 'nonsense' })).toBeNull();
  });

  it('takes the id as the truth when the fields disagree with it', () => {
    const crossed = normalizeClimate({ ...eve(), night: '1999-01-01', part: 'am' });
    expect(crossed?.night).toBe('2026-01-15');
    expect(crossed?.part).toBe('eve');
  });

  it('drops a verdict smuggled onto an evening record', () => {
    expect(normalizeClimate({ ...eve(), verdict: 'cold' })?.verdict).toBeNull();
  });

  it('drops a temperature smuggled onto a morning record', () => {
    const morning = normalizeClimate({
      ...eve(),
      id: '2026-01-15-am',
      part: 'am',
      verdict: 'ok',
    });
    expect(morning?.tempC).toBeNull();
    expect(morning?.verdict).toBe('ok');
  });

  it('rejects a value outside the vocabulary rather than keeping it', () => {
    expect(normalizeClimate({ ...eve(), window: 'ajar' })?.window).toBeNull();
    expect(normalizeClimate({ ...eve(), tempC: 'cold' })?.tempC).toBeNull();
  });

  it('omits authorEmail entirely rather than writing an undefined', () => {
    const record = normalizeClimate(eve());
    expect('authorEmail' in (record as object)).toBe(false);
  });

  it('keeps a tombstone', () => {
    expect(normalizeClimate({ ...eve(), deleted: true })?.deleted).toBe(true);
  });
});
