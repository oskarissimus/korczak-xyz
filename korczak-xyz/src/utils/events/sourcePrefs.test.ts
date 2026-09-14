import { describe, expect, it } from 'vitest';
import {
  ALL_SOURCES_ON,
  announceFloor,
  disabledSourceIds,
  mergeSourcePrefs,
  normalizeSourcePrefs,
  setSourceEnabled,
  sourceEnabled,
  type SourcePrefs,
} from './sourcePrefs';

const NOW = Date.parse('2026-09-14T10:00:00Z');

describe('sourceEnabled', () => {
  it('is on for a source nobody has touched', () => {
    expect(sourceEnabled(ALL_SOURCES_ON, 'feed')).toBe(true);
  });

  it('is on for a source added by a later build', () => {
    // The absence of an entry is the default, which is what makes a new catalogue row need no
    // migration on an account that has opinions about the others.
    const prefs = setSourceEnabled({}, 'feed', false, NOW);
    expect(sourceEnabled(prefs, 'some-new-source')).toBe(true);
  });

  it('is off once switched off, and on again once switched back', () => {
    const off = setSourceEnabled({}, 'feed', false, NOW);
    expect(sourceEnabled(off, 'feed')).toBe(false);
    expect(sourceEnabled(setSourceEnabled(off, 'feed', true, NOW + 1000), 'feed')).toBe(true);
  });

  it('leaves the other switches alone', () => {
    const prefs = setSourceEnabled(setSourceEnabled({}, 'feed', false, NOW), 'ticketmaster', false, NOW);
    expect(sourceEnabled(prefs, 'feed')).toBe(false);
    expect(sourceEnabled(prefs, 'ticketmaster')).toBe(false);
    expect(sourceEnabled(prefs, 'python-org')).toBe(true);
  });
});

describe('disabledSourceIds', () => {
  it('lists only what is off, sorted', () => {
    let prefs: SourcePrefs = setSourceEnabled({}, 'ticketmaster', false, NOW);
    prefs = setSourceEnabled(prefs, 'feed', false, NOW);
    prefs = setSourceEnabled(prefs, 'python-org', true, NOW);
    expect(disabledSourceIds(prefs)).toEqual(['feed', 'ticketmaster']);
  });

  it('is empty when nothing is off', () => {
    expect(disabledSourceIds(setSourceEnabled({}, 'feed', true, NOW))).toEqual([]);
  });
});

describe('announceFloor', () => {
  it('constrains nothing for a source nobody has touched', () => {
    expect(announceFloor(ALL_SOURCES_ON, 'feed')).toBe(0);
  });

  it('is the moment a source was switched back on', () => {
    // The whole point: the rows collected while it was off are history, not news.
    const back = setSourceEnabled(setSourceEnabled({}, 'feed', false, NOW), 'feed', true, NOW + 60_000);
    expect(announceFloor(back, 'feed')).toBe(NOW + 60_000);
  });

  it('is unreachable while the source is off', () => {
    expect(announceFloor(setSourceEnabled({}, 'feed', false, NOW), 'feed')).toBe(Infinity);
  });
});

describe('mergeSourcePrefs', () => {
  it('keeps both devices’ switches when they are about different sources', () => {
    const phone = setSourceEnabled({}, 'feed', false, NOW);
    const laptop = setSourceEnabled({}, 'ticketmaster', false, NOW);
    expect(disabledSourceIds(mergeSourcePrefs(phone, laptop))).toEqual(['feed', 'ticketmaster']);
  });

  it('takes the later flip of one switch, whichever side it is on', () => {
    const off = setSourceEnabled({}, 'feed', false, NOW);
    const on = setSourceEnabled({}, 'feed', true, NOW + 1000);
    expect(sourceEnabled(mergeSourcePrefs(off, on), 'feed')).toBe(true);
    expect(sourceEnabled(mergeSourcePrefs(on, off), 'feed')).toBe(true);
  });

  it('gives a dead heat to off', () => {
    const off = setSourceEnabled({}, 'feed', false, NOW);
    const on = setSourceEnabled({}, 'feed', true, NOW);
    expect(sourceEnabled(mergeSourcePrefs(off, on), 'feed')).toBe(false);
    expect(sourceEnabled(mergeSourcePrefs(on, off), 'feed')).toBe(false);
  });

  it('is unchanged by merging with nothing', () => {
    const prefs = setSourceEnabled({}, 'feed', false, NOW);
    expect(mergeSourcePrefs(prefs, {})).toEqual(prefs);
    expect(mergeSourcePrefs({}, prefs)).toEqual(prefs);
  });
});

describe('normalizeSourcePrefs', () => {
  it('reads back what was written', () => {
    const prefs = setSourceEnabled({}, 'feed', false, NOW);
    expect(normalizeSourcePrefs(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs);
  });

  it('drops a malformed switch rather than reading it as off', () => {
    expect(
      normalizeSourcePrefs({
        feed: { enabled: 'no', at: NOW },
        ticketmaster: { enabled: false },
        'python-org': { enabled: false, at: NOW },
      }),
    ).toEqual({ 'python-org': { enabled: false, at: NOW } });
  });

  it('keeps a switch for an id this build does not know', () => {
    expect(normalizeSourcePrefs({ 'gone-source': { enabled: false, at: NOW } })).toEqual({
      'gone-source': { enabled: false, at: NOW },
    });
  });

  it('survives anything that is not an object', () => {
    for (const raw of [null, undefined, 3, 'x', []]) expect(normalizeSourcePrefs(raw)).toEqual({});
  });
});
