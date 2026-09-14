import { describe, expect, it } from 'vitest';
import { CITY_ALIASES, cityKey } from './cities';
import { foldText } from './normalize';

describe('cityKey', () => {
  it('folds the spellings of one name', () => {
    expect(cityKey('Kraków')).toBe(cityKey('KRAKOW'));
    expect(cityKey('Łódź')).toBe(cityKey('Lodz'));
    expect(cityKey(' Gdańsk ')).toBe('gdansk');
  });

  it('maps an exonym onto the city itself', () => {
    // The half `foldText` structurally cannot do: these are two words, not two spellings, and
    // Ticketmaster's English and Polish catalogues list the same hall under both.
    expect(cityKey('Warsaw')).toBe('warszawa');
    expect(cityKey('WARSCHAU')).toBe('warszawa');
    expect(cityKey('Cracow')).toBe(cityKey('Kraków'));
    expect(cityKey('Vienna')).toBe(cityKey('Wien'));
  });

  it('leaves a name it has never heard of alone', () => {
    // A wrong merge is worse than a missing one: two options for one city costs a tap, where two
    // cities filed as one is a filter that lies.
    expect(cityKey('Rzeszów')).toBe('rzeszow');
    expect(cityKey('Bielsko-Biała')).toBe('bielsko-biala');
  });

  it('has no city as its own answer, not as a place', () => {
    expect(cityKey(undefined)).toBe('');
    expect(cityKey('   ')).toBe('');
  });

  it('is idempotent, so a stored key survives a second pass', () => {
    // A stored interest is keyed on every read; a table whose target was itself an alias would
    // move the answer on the second call.
    for (const name of Object.keys(CITY_ALIASES)) {
      expect(cityKey(cityKey(name))).toBe(cityKey(name));
    }
  });

  it('canonicalises onto the city’s own name', () => {
    // An alias whose target is itself an alias is a key that means two different places depending
    // on how many times it has been through here.
    for (const target of Object.values(CITY_ALIASES)) {
      expect(foldText(target)).toBe(target);
      expect(CITY_ALIASES[target]).toBeUndefined();
    }
  });
});

