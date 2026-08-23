import { describe, expect, it } from 'vitest';
import { fill, relativeTime, translations } from './translations';

describe('translations', () => {
  it('has the same keys in both locales', () => {
    // `Translation` is derived from `en`, so a key missing from `pl` is not a type error — it is a
    // silent fallback to English on one page, which is exactly the kind of thing nobody notices.
    expect(Object.keys(translations.pl).sort()).toEqual(Object.keys(translations.en).sort());
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
