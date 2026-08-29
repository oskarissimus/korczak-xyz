import { describe, expect, it } from 'vitest';
import { ONLINE, countryLabel, toCountryCode, toCountryCodes } from './countries';

describe('toCountryCode', () => {
  it('reads a code, a name, and an abbreviation as the same country', () => {
    for (const written of ['PL', 'pl', 'Poland', 'Polska', ' polska ']) {
      expect(toCountryCode(written)).toBe('PL');
    }
    for (const written of ['NL', 'Netherlands', 'The Netherlands', 'Holandia', 'Holland']) {
      expect(toCountryCode(written)).toBe('NL');
    }
    for (const written of ['US', 'USA', 'United States', 'Stany Zjednoczone']) {
      expect(toCountryCode(written)).toBe('US');
    }
  });

  it('folds the Polish names it is keyed by', () => {
    // Every one of these carries a letter foldText has to deal with — ł is the trap, since NFD
    // leaves it alone. A key written unfolded here would never be reachable.
    expect(toCountryCode('Włochy')).toBe('IT');
    expect(toCountryCode('Łotwa')).toBe('LV');
    expect(toCountryCode('Białoruś')).toBe('BY');
    expect(toCountryCode('Węgry')).toBe('HU');
    expect(toCountryCode('Słowacja')).toBe('SK');
    expect(toCountryCode('Korea Południowa')).toBe('KR');
  });

  it('reads the countries in the screenshot that started this', () => {
    expect(toCountryCode('Cameroon')).toBe('CM');
    expect(toCountryCode('Uganda')).toBe('UG');
    expect(toCountryCode('Greece')).toBe('GR');
  });

  it('gives an event that happens nowhere a token of its own', () => {
    for (const written of ['Online', 'online', 'virtual', 'zdalnie', ONLINE]) {
      expect(toCountryCode(written)).toBe(ONLINE);
    }
    // Not an ISO code: it must never be mistaken for one of the real entries in a list.
    expect(ONLINE).not.toMatch(/^[A-Z]{2}$/);
  });

  it('returns undefined rather than guessing', () => {
    // A wrong country filters silently; an unknown one shows as `?` on the card.
    for (const written of ['', '   ', 'somewhere', 'Convention Center', undefined, null]) {
      expect(toCountryCode(written)).toBeUndefined();
    }
  });
});

describe('toCountryCodes', () => {
  it('dedupes and sorts, so two interests meaning one scope do not differ', () => {
    expect(toCountryCodes(['Polska', 'PL', 'Germany', 'DE', 'Czechy'])).toEqual([
      'CZ',
      'DE',
      'PL',
    ]);
  });

  it('drops what it cannot read instead of storing it', () => {
    expect(toCountryCodes(['Poland', 'nonsense', ''])).toEqual(['PL']);
  });

  it('is empty for an absent list, which means no constraint', () => {
    expect(toCountryCodes(undefined)).toEqual([]);
  });
});

describe('countryLabel', () => {
  it('prints the code, and says so when there is none', () => {
    expect(countryLabel('PL')).toBe('PL');
    expect(countryLabel(ONLINE)).toBe('online');
    expect(countryLabel(undefined)).toBe('?');
  });
});
