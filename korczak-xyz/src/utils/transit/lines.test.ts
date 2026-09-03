import { describe, expect, it } from 'vitest';
import {
  canonicalStation,
  linesInTitle,
  M1_STATIONS,
  M2_STATIONS,
  metroLinesInTitle,
  normalizeStationKey,
  stationIndex,
  stationsBetween,
  STATIONS,
} from './lines';
import { METRO_LINES, type MetroLine } from './types';

describe('the station tables', () => {
  it('lists both lines end to end', () => {
    expect(M1_STATIONS[0]).toBe('Kabaty');
    expect(M1_STATIONS[M1_STATIONS.length - 1]).toBe('Młociny');
    expect(M2_STATIONS[0]).toBe('Bemowo');
    expect(M2_STATIONS[M2_STATIONS.length - 1]).toBe('Bródno');
  });

  /*
   * The property that keeps the alias table honest, and the one `cities.test.ts` keeps for the
   * events app: every canonical name resolves to itself. A station whose own spelling does not
   * survive normalisation is one no communiqué can ever match either.
   */
  it.each(METRO_LINES)('%s: every station resolves to itself', (line) => {
    for (const station of STATIONS[line]) {
      expect(canonicalStation(line, station)).toBe(station);
    }
  });

  it.each(METRO_LINES)('%s: no two stations share a comparison key', (line) => {
    const keys = STATIONS[line].map(normalizeStationKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('knows Świętokrzyska is the interchange and nothing else is', () => {
    const shared = M1_STATIONS.filter((station) => M2_STATIONS.includes(station));
    expect(shared).toEqual(['Świętokrzyska']);
  });
});

describe('resolving a name written in prose', () => {
  it.each([
    ['swietokrzyska', 'Świętokrzyska'],
    ['ŚWIĘTOKRZYSKA', 'Świętokrzyska'],
    ['stacji Świętokrzyska', 'Świętokrzyska'],
    ['stacja metro Świętokrzyska', 'Świętokrzyska'],
  ])('reads %s as %s', (written, expected) => {
    expect(canonicalStation('M1', written)).toBe(expected);
  });

  it('reads the abbreviations WTP actually writes', () => {
    expect(canonicalStation('M1', 'pl. Wilsona')).toBe('Plac Wilsona');
    expect(canonicalStation('M2', 'rondo ONZ')).toBe('Rondo ONZ');
    expect(canonicalStation('M2', 'Nowy Świat - Uniwersytet')).toBe('Nowy Świat-Uniwersytet');
    expect(canonicalStation('M1', 'Ratusz-Arsenał')).toBe('Ratusz Arsenał');
  });

  /*
   * The failure this app must never turn into silence. An unknown name is null, and `impactOf`
   * escalates on null rather than clearing the item — see the header there.
   */
  it('returns null rather than guessing at a station it does not know', () => {
    expect(canonicalStation('M1', 'Chrzanów')).toBeNull();
    expect(canonicalStation('M1', '')).toBeNull();
  });

  it('does not find an M2 station on M1', () => {
    expect(canonicalStation('M1', 'Rondo Daszyńskiego')).toBeNull();
    expect(canonicalStation('M2', 'Imielin')).toBeNull();
  });
});

describe('stationsBetween', () => {
  it('includes both endpoints and everything between', () => {
    expect(stationsBetween('M2', 'Rondo Daszyńskiego', 'Świętokrzyska')).toEqual([
      'Rondo Daszyńskiego',
      'Rondo ONZ',
      'Świętokrzyska',
    ]);
  });

  it('does not care which way round the endpoints are given', () => {
    expect(stationsBetween('M2', 'Świętokrzyska', 'Rondo Daszyńskiego')).toEqual(
      stationsBetween('M2', 'Rondo Daszyńskiego', 'Świętokrzyska'),
    );
  });

  it('is one station for a segment that does not move', () => {
    expect(stationsBetween('M1', 'Centrum', 'Centrum')).toEqual(['Centrum']);
  });

  it('is empty for an endpoint that is not on the line', () => {
    expect(stationsBetween('M1', 'Bemowo', 'Centrum')).toEqual([]);
  });

  it('places stations in line order', () => {
    expect(stationIndex('M1', 'Kabaty')).toBe(0);
    expect(stationIndex('M1', 'Imielin')).toBeLessThan(stationIndex('M1', 'Świętokrzyska'));
    expect(stationIndex('M2', 'Bemowo')).toBeLessThan(stationIndex('M2', 'Bródno'));
  });
});

describe('reading the line list out of a WTP headline', () => {
  /* Real headlines, taken verbatim from the feed's own items. */
  it('reads a bus list', () => {
    expect(linesInTitle('Utrudnienia w komunikacji: 189, 401, 402')).toEqual(['189', '401', '402']);
  });

  it('reads a metro line', () => {
    expect(metroLinesInTitle('Utrudnienia w komunikacji: M1')).toEqual(['M1']);
  });

  it('reads a metro line mixed in with buses', () => {
    expect(linesInTitle('Utrudnienia w komunikacji: 742, M1')).toEqual(['742', 'M1']);
    expect(metroLinesInTitle('Utrudnienia w komunikacji: 742, M1')).toEqual(['M1']);
  });

  it('reads a long change list without inventing lines', () => {
    const title =
      'Zmiany w komunikacji: 7, 9, 22, 24, 26, 102, 111, 117, 123, 125, 135, 138, 146, 147, 157, 158, 166, 202, 507, 509, 517, 521, E-1, N22, N24, N72';
    const lines = linesInTitle(title);
    expect(lines).toContain('E-1');
    expect(lines).toContain('N72');
    expect(lines).toHaveLength(26);
    expect(metroLinesInTitle(title)).toEqual([]);
  });

  it('finds nothing in a headline with no line list', () => {
    expect(linesInTitle('Nowy rozkład jazdy')).toEqual([]);
  });

  /*
   * The guard that stops prose after the colon from reading as a fleet of lines. Without it any
   * item whose headline is a sentence would match every watched line at once.
   */
  it('ignores words that follow a colon but are not line numbers', () => {
    expect(linesInTitle('Komunikat: zmiana organizacji ruchu na Woli')).toEqual([]);
  });

  it('never reports a metro line the headline did not name', () => {
    const lines: MetroLine[] = metroLinesInTitle('Zmiany w komunikacji: 100, 131, 160, 504, 520, 525');
    expect(lines).toEqual([]);
  });
});
