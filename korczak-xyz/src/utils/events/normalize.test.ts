import { describe, expect, it } from 'vitest';
import {
  dayKeyOf,
  daysUntil,
  eventIdFor,
  fingerprintOf,
  foldText,
  haystackOf,
  noticeIdFor,
  parseNoticeId,
  slugKey,
  synthKey,
} from './normalize';

describe('foldText', () => {
  it('strips the diacritics NFD decomposes', () => {
    expect(foldText('Ągnieszka Ćma Śródmieście')).toBe('agnieszka cma srodmiescie');
    expect(foldText('ŻÓŁW')).toBe('zolw');
  });

  it('handles the Polish letters NFD does NOT decompose', () => {
    // U+0142 is its own code point, not l + a combining mark, so the NFD strip never sees it.
    // Getting this wrong loses Wrocław, Białystok, Łódź and Michał — most of the country.
    expect(foldText('Wrocław')).toBe('wroclaw');
    expect(foldText('ŁÓDŹ')).toBe('lodz');
    expect(foldText('Białystok')).toBe('bialystok');
    expect(foldText('Michał Łuczak')).toBe('michal luczak');
  });

  it('folds the non-Polish atomics a German or Nordic listing brings', () => {
    expect(foldText('Straße')).toBe('strasse');
    expect(foldText('Malmö Ø')).toBe('malmo o');
  });

  it('collapses whitespace and trims', () => {
    expect(foldText('  Pink   Floyd\n Tribute ')).toBe('pink floyd tribute');
  });

  it('survives an empty input', () => {
    expect(foldText('')).toBe('');
  });
});

describe('slugKey', () => {
  it('keeps a Firestore id legal', () => {
    expect(slugKey('a/b/c')).toBe('a-b-c');
    expect(slugKey('...')).toBe('x');
    expect(slugKey('')).toBe('x');
    expect(slugKey('__proto__')).toBe('x__proto__');
  });

  it('collapses runs and trims separators', () => {
    expect(slugKey('  a???b  ')).toBe('a-b');
  });

  it('caps the length well under the 1500-byte id limit', () => {
    expect(slugKey('x'.repeat(500))).toHaveLength(200);
  });
});

describe('eventIdFor', () => {
  it('is deterministic', () => {
    expect(eventIdFor('ticketmaster', 'G5vYZbFvY1')).toBe(eventIdFor('ticketmaster', 'G5vYZbFvY1'));
  });

  it('separates the source from the key', () => {
    expect(eventIdFor('teatr-wielki', '2026-2027/salome')).toBe('teatr-wielki_2026-2027-salome');
  });
});

describe('synthKey', () => {
  it('is stable across runs for the same performance', () => {
    const a = synthKey('WESELE FIGARA', '2027-01-14', 'Teatr Wielki');
    const b = synthKey('Wesele Figara', '2027-01-14', 'teatr wielki');
    expect(a).toBe(b);
  });

  it('separates two nights of one production', () => {
    expect(synthKey('Salome', '2026-11-22')).not.toBe(synthKey('Salome', '2026-11-23'));
  });
});

describe('fingerprintOf', () => {
  it('collapses the same concert arriving from two sources', () => {
    const tm = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14', city: 'Warszawa' });
    const tw = fingerprintOf({ title: 'WESELE  FIGARA —', day: '2027-01-14', city: 'warszawa' });
    expect(tm).toBe(tw);
  });

  it('keeps two different nights apart', () => {
    const a = fingerprintOf({ title: 'Salome', day: '2026-11-22' });
    const b = fingerprintOf({ title: 'Salome', day: '2026-11-23' });
    expect(a).not.toBe(b);
  });
});

describe('noticeIdFor', () => {
  it('round-trips through a separator the slug charset excludes', () => {
    // The event id half contains hyphens, which is why the separator cannot be one.
    const id = noticeIdFor('weselefigara|2027-01-14|warszawa', 'announced');
    expect(parseNoticeId(id)?.kind).toBe('announced');
  });

  it('rejects an id with no separator', () => {
    expect(parseNoticeId('nothing')).toBeNull();
  });
});

describe('dayKeyOf', () => {
  it('uses the Warsaw calendar day, not UTC', () => {
    // 22:30 UTC on a summer evening is already the next day in Warsaw (UTC+2).
    expect(dayKeyOf(Date.parse('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
    // ...but in winter (UTC+1) 22:30 UTC is still the 14th.
    expect(dayKeyOf(Date.parse('2026-01-14T22:30:00Z'))).toBe('2026-01-14');
  });
});

describe('daysUntil', () => {
  it('counts calendar days, not elapsed hours', () => {
    const now = Date.parse('2026-08-23T10:00:00Z');
    // Still the 23rd in UTC, but 00:30 on the 24th in Warsaw — so it is "tomorrow", which is what
    // a lead time of one day has to mean to someone reading it in Warsaw.
    expect(daysUntil(Date.parse('2026-08-23T22:30:00Z'), now)).toBe(1);
    // ...and an hour earlier is still today.
    expect(daysUntil(Date.parse('2026-08-23T21:30:00Z'), now)).toBe(0);
  });

  it('is zero for today and negative for the past', () => {
    const now = Date.parse('2026-08-23T10:00:00Z');
    expect(daysUntil(Date.parse('2026-08-23T20:00:00Z'), now)).toBe(0);
    expect(daysUntil(Date.parse('2026-08-21T20:00:00Z'), now)).toBe(-2);
  });
});

describe('haystackOf', () => {
  it('folds everything the matcher will read into one string', () => {
    const hay = haystackOf({
      title: 'Jarmark Średniowieczny',
      venue: 'Zamek Chudów',
      city: 'Gliwice',
    });
    expect(hay).toContain('jarmark sredniowieczny');
    expect(hay).toContain('zamek chudow');
  });

  it('caps a source that pastes a whole press release', () => {
    const hay = haystackOf({ title: 'X', description: 'word '.repeat(500) });
    expect(hay.length).toBeLessThan(700);
  });

  it('does NOT read tags — they are matched structurally, not as keywords', () => {
    /*
     * Regression. Tags used to be folded in here, which made any tag a source applies feed-wide a
     * blanket keyword hit for every row it produced: tagging the Jewish Culture Festival's feed
     * `klezmer` made the Klezmer interest match all 67 of its articles, one of which was about
     * Ted Kaczynski. Keywords ask what an event says; tags ask what it is.
     */
    const hay = haystackOf({ title: 'Ted Kaczynski, the Unabomber' });
    expect(hay).not.toContain('klezmer');
    expect(haystackOf({ title: 'X' })).toBe('x');
  });
});
