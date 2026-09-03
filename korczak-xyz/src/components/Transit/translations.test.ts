import { describe, expect, it } from 'vitest';
import { translations } from './translations';

/*
 * The two tables have to hold the same keys. A missing one is not a type error at the call site —
 * `translations[lang]` is indexed by a variable — so the Polish page renders `undefined` where the
 * English one renders a sentence, and nothing anywhere says so.
 */
describe('the transport app is fully translated', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(translations.pl).sort()).toEqual(Object.keys(translations.en).sort());
  });

  it('has no empty strings', () => {
    for (const [lang, table] of Object.entries(translations)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.length, `${lang}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  /*
   * A placeholder present in one locale and absent in the other is a sentence that silently loses
   * its number. `{count} stops` reading `stacji` in Polish is worse than either language alone.
   */
  it('uses the same placeholders in both locales', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(translations.en) as Array<keyof typeof translations.en>) {
      expect(placeholders(translations.pl[key]), `mismatch in ${key}`).toEqual(
        placeholders(translations.en[key]),
      );
    }
  });
});
