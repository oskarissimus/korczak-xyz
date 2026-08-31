import { describe, expect, it } from 'vitest';
import { CITY_ALIASES, cityKey, isEndonym } from './cities';
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
    // The picker stores what was chosen and keys it on every read; a table whose target was itself
    // an alias would move the answer on the second call.
    for (const name of Object.keys(CITY_ALIASES)) {
      expect(cityKey(cityKey(name))).toBe(cityKey(name));
    }
  });

  it('canonicalises onto the city’s own name', () => {
    // Which is what the picker prefers to print. An alias whose target folds to another alias
    // would print an exonym as though it were the endonym.
    for (const target of Object.values(CITY_ALIASES)) {
      expect(foldText(target)).toBe(target);
      expect(CITY_ALIASES[target]).toBeUndefined();
    }
  });
});

describe('isEndonym', () => {
  it('separates the city’s own name from a name for it', () => {
    expect(isEndonym('Warszawa')).toBe(true);
    expect(isEndonym('Warsaw')).toBe(false);
    // Anything the table says nothing about is its own name, which is what makes the tie-break
    // reduce to "commonest spelling" everywhere else.
    expect(isEndonym('Rzeszów')).toBe(true);
  });
});
