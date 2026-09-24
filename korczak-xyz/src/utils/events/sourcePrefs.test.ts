import { describe, expect, it } from 'vitest';
import {
  ALL_SOURCES_ON,
  announceFloor,
  disabledSourceIds,
  mergeSourcePrefs,
  normalizeSourcePrefs,
  cityMatches,
  countriesOf,
  setSourceCity,
  setSourceCountry,
  setSourceEnabled,
  sourceAdmits,
  sourceCity,
  sourceCountry,
  sourceEnabled,
  townsOf,
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

describe('a source narrowed to one town', () => {
  const WAW = setSourceCity({}, 'elektroniczne-zapisy', 'Warszawa', NOW);
  const race = (city?: string) => ({ source: 'elektroniczne-zapisy', city });

  it('keeps the rows in that town and drops the others', () => {
    expect(sourceAdmits(WAW, race('Warszawa'))).toBe(true);
    expect(sourceAdmits(WAW, race('Gdańsk'))).toBe(false);
    expect(sourceAdmits(WAW, race('Kraków'))).toBe(false);
  });

  it('lets a row with no town through, because nothing says it is elsewhere', () => {
    expect(sourceAdmits(WAW, race(undefined))).toBe(true);
    expect(sourceAdmits(WAW, race(''))).toBe(true);
  });

  it('leaves the other sources alone', () => {
    expect(sourceAdmits(WAW, { source: 'ticketmaster', city: 'Kraków' })).toBe(true);
  });

  it('still obeys the switch', () => {
    const off = setSourceEnabled(WAW, 'elektroniczne-zapisy', false, NOW + 1000);
    expect(sourceAdmits(off, race('Warszawa'))).toBe(false);
    // Flipping keeps the town, so switching back on does not widen the filter behind the reader.
    expect(sourceCity(off, 'elektroniczne-zapisy')).toBe('Warszawa');
  });

  it('widens again, and re-arms from the moment it did', () => {
    const all = setSourceCity(WAW, 'elektroniczne-zapisy', undefined, NOW + 5000);
    expect(sourceAdmits(all, race('Gdańsk'))).toBe(true);
    expect(sourceCity(all, 'elektroniczne-zapisy')).toBeUndefined();
    expect(announceFloor(all, 'elektroniczne-zapisy')).toBe(NOW + 5000);
  });

  it('keeps an off switch off when a town is chosen', () => {
    const off = setSourceEnabled({}, 'elektroniczne-zapisy', false, NOW);
    expect(sourceEnabled(setSourceCity(off, 'elektroniczne-zapisy', 'Warszawa', NOW + 1), 'elektroniczne-zapisy')).toBe(false);
  });

  it('survives the round trip through a store', () => {
    expect(normalizeSourcePrefs(JSON.parse(JSON.stringify(WAW)))).toEqual(WAW);
    expect(normalizeSourcePrefs({ feed: { enabled: true, at: NOW, city: 3 } })).toEqual({
      feed: { enabled: true, at: NOW },
    });
  });
});

describe('a source narrowed to one country', () => {
  const PL = setSourceCountry({}, 'python-org', 'PL', NOW);
  const conf = (country?: string) => ({ source: 'python-org', city: 'Somewhere', country });

  it('keeps the rows in that country and drops the others', () => {
    expect(sourceAdmits(PL, conf('PL'))).toBe(true);
    expect(sourceAdmits(PL, conf('US'))).toBe(false);
    expect(sourceAdmits(PL, conf('ONLINE'))).toBe(false);
  });

  it('lets a row the classifier has not reached through', () => {
    expect(sourceAdmits(PL, conf(undefined))).toBe(true);
    expect(sourceAdmits(PL, conf(''))).toBe(true);
  });

  it('leaves the other sources alone', () => {
    expect(sourceAdmits(PL, { source: 'feed', country: 'DE' })).toBe(true);
  });

  it('keeps the country through a flip, and a town through a country', () => {
    const off = setSourceEnabled(PL, 'python-org', false, NOW + 1000);
    expect(sourceAdmits(off, conf('PL'))).toBe(false);
    const on = setSourceEnabled(off, 'python-org', true, NOW + 2000);
    expect(sourceCountry(on, 'python-org')).toBe('PL');

    const both = setSourceCountry(
      setSourceCity({}, 'python-org', 'Kraków', NOW),
      'python-org',
      'PL',
      NOW + 1,
    );
    expect(sourceCity(both, 'python-org')).toBe('Kraków');
    expect(sourceCity(setSourceCity(both, 'python-org', undefined, NOW + 2), 'python-org')).toBeUndefined();
    expect(sourceCountry(setSourceCity(both, 'python-org', undefined, NOW + 2), 'python-org')).toBe('PL');
  });

  it('widens again, and re-arms from the moment it did', () => {
    const all = setSourceCountry(PL, 'python-org', undefined, NOW + 5000);
    expect(sourceAdmits(all, conf('US'))).toBe(true);
    expect(sourceCountry(all, 'python-org')).toBeUndefined();
    expect(announceFloor(all, 'python-org')).toBe(NOW + 5000);
  });

  it('survives the round trip through a store', () => {
    expect(normalizeSourcePrefs(JSON.parse(JSON.stringify(PL)))).toEqual(PL);
    expect(normalizeSourcePrefs({ feed: { enabled: true, at: NOW, country: 3 } })).toEqual({
      feed: { enabled: true, at: NOW },
    });
  });
});

describe('countriesOf', () => {
  it('counts each country, busiest first, and skips rows with none', () => {
    const rows = [
      { country: 'US' },
      { country: 'PL' },
      { country: 'US' },
      { country: 'ONLINE' },
      { country: 'DE' },
      {},
    ];
    expect(countriesOf(rows)).toEqual([
      { country: 'US', count: 2 },
      { country: 'DE', count: 1 },
      { country: 'ONLINE', count: 1 },
      { country: 'PL', count: 1 },
    ]);
  });
});

describe('cityMatches', () => {
  it('ignores case, diacritics and spacing', () => {
    expect(cityMatches('Warszawa', 'WARSZAWA')).toBe(true);
    expect(cityMatches('Suchowola', 'SUCHOWOLA')).toBe(true);
    expect(cityMatches('Piekary Śląskie', 'Piekary śląskie')).toBe(true);
    expect(cityMatches('Łódź', 'lodz')).toBe(true);
  });

  it('takes a district written after the town', () => {
    expect(cityMatches('Warszawa', 'Warszawa, Bemowo')).toBe(true);
    expect(cityMatches('Warszawa', 'Warszawa-Wawer')).toBe(true);
    expect(cityMatches('Warszawa', 'Warszawa Białołęka')).toBe(true);
  });

  it('does not take a longer word that merely starts the same', () => {
    expect(cityMatches('Warszawa', 'Warszawianka')).toBe(false);
    expect(cityMatches('Hel', 'Helenów')).toBe(false);
  });
});

describe('townsOf', () => {
  it('groups spellings of one town under the commonest and sorts in Polish', () => {
    const rows = [
      { city: 'Suchowola' },
      { city: 'SUCHOWOLA' },
      { city: 'SUCHOWOLA' },
      { city: 'Łódź' },
      { city: 'Warszawa' },
      { city: 'Lublin' },
      {},
    ];
    expect(townsOf(rows)).toEqual([
      { city: 'Lublin', count: 1 },
      { city: 'Łódź', count: 1 },
      { city: 'SUCHOWOLA', count: 3 },
      { city: 'Warszawa', count: 1 },
    ]);
  });
});
