import { describe, expect, it } from 'vitest';
import { fill, relativeTime, translations } from './translations';

describe('translations', () => {
  it('has the same keys in both locales', () => {
    // `Translation` is derived from `en`, so a key missing from `pl` is not a type error — it is a
    // silent fallback to English on one page, which is exactly the kind of thing nobody notices.
    expect(Object.keys(translations.pl).sort()).toEqual(Object.keys(translations.en).sort());
  });

  /*
   * The key-parity test above passes when a key exists in both tables holding the *same* English
   * text, which is what a copy-paste into the wrong table produces — and that shipped once: four
   * source descriptions rendered in English on the Polish page, with every test green.
   *
   * A blanket "no value repeats" would be wrong: `RSS`, `API` and `korczak.xyz` are the same word
   * in both languages and should be. Length is what separates a label from a sentence, and a
   * sentence that is byte-identical in two languages has not been translated.
   */
  it('translates the prose, rather than repeating the English', () => {
    for (const [key, english] of Object.entries(translations.en)) {
      if (english.length < 60) continue;
      expect(
        (translations.pl as Record<string, string>)[key],
        `${key} is the same sentence in both locales — it looks untranslated`,
      ).not.toBe(english);
    }
  });

  it('leaves no placeholder unfilled in either locale', () => {
    for (const [lang, table] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(table)) {
        const placeholders = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const other = (translations as Record<string, Record<string, string>>)[
          lang === 'en' ? 'pl' : 'en'
        ][key];
        expect(
          [...other.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
          `${key} uses different placeholders in en and pl`,
        ).toEqual(placeholders.sort());
      }
    }
  });
});

describe('fill', () => {
  it('substitutes and leaves unknown placeholders alone', () => {
    expect(fill('{n} min ago', { n: 5 })).toBe('5 min ago');
    expect(fill('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });
});

describe('relativeTime', () => {
  const t = translations.en;
  const now = 1_700_000_000_000;
  it('picks the coarsest unit that is still true', () => {
    expect(relativeTime(now - 30_000, now, t)).toBe('just now');
    expect(relativeTime(now - 10 * 60_000, now, t)).toBe('10 min ago');
    expect(relativeTime(now - 5 * 3_600_000, now, t)).toBe('5 h ago');
    expect(relativeTime(now - 3 * 86_400_000, now, t)).toBe('3 d ago');
  });

  it('does not go negative on a clock that is slightly ahead', () => {
    expect(relativeTime(now + 5000, now, t)).toBe('just now');
  });
});
