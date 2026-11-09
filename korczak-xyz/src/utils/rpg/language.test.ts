import { beforeEach, describe, expect, it } from 'vitest';
import { asLang, base, guessLang, languageName, LANGUAGES, localeOf, nativeName, normLang, startingLang, storeLangChoice } from './language';

describe('asLang', () => {
  it('takes the primary subtag of a language on the list', () => {
    expect(asLang('pt-BR')).toBe('pt');
    expect(asLang('DE')).toBe('de');
    expect(asLang('zh_Hant')).toBe('zh');
    expect(asLang('no')).toBe('nb');
    expect(asLang('iw')).toBe('he');
  });
  it('refuses what is not a language on the list', () => {
    expect(asLang('xx')).toBeNull();
    expect(asLang('')).toBeNull();
    expect(asLang(7)).toBeNull();
    expect(normLang('klingon')).toBe('en');
  });
});

describe('guessLang', () => {
  it("takes the browser's first language on the list", () => {
    expect(guessLang({ languages: ['xx-YY', 'de-AT', 'en-US'] })).toBe('de');
    expect(guessLang({ languages: [], language: 'pl-PL' })).toBe('pl');
  });
  it('falls back to English', () => {
    expect(guessLang({ languages: ['xx'] })).toBe('en');
    expect(guessLang(undefined)).toBe('en');
  });
});

describe('names', () => {
  it('names a language in English for the prompt and in itself for the menu', () => {
    expect(languageName('de')).toBe('German');
    expect(languageName('pl')).toBe('Polish');
    expect(nativeName('de')).toBe('Deutsch');
    expect(nativeName('pl')).toBe('Polski');
  });
  it('names every language on the list', () => {
    for (const l of LANGUAGES) expect(languageName(l)).not.toBe(l);
  });
  it('reads hand-written tables in English unless they are Polish', () => {
    expect(base('pl')).toBe('pl');
    expect(base('de')).toBe('en');
    expect(localeOf('en')).toBe('en-GB');
    expect(localeOf('fr')).toBe('fr');
  });
});

describe('startingLang', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  const nav = { languages: ['fr-FR'] };
  it('starts in what this browser chose', () => {
    storeLangChoice('it', 5);
    expect(startingLang('en', 'pl', nav)).toBe('it');
  });
  it('then in the language of a quest left half way, then the page when it is /pl/, then the browser', () => {
    expect(startingLang('en', 'pl', nav)).toBe('pl');
    expect(startingLang('pl', null, nav)).toBe('pl');
    expect(startingLang('en', null, nav)).toBe('fr');
    expect(startingLang('en', null, { languages: [] })).toBe('en');
  });
});
