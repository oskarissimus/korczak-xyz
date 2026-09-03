import { describe, expect, it } from 'vitest';
import { SALE_DEFAULT_HOUR, decodeEntities, parsePolishDate, parseSaleAnnouncement, stripTags, warsawEpoch } from './html';

describe('stripTags', () => {
  it('drops markup and collapses whitespace', () => {
    expect(stripTags('<h2>COPP<span>É</span>LIA</h2>')).toBe('COPPÉLIA');
    expect(stripTags('<p>a\n  b</p>')).toBe('a b');
  });
});

describe('decodeEntities', () => {
  it('handles named, decimal and hex', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&#243;')).toBe('ó');
    expect(decodeEntities('&#x142;')).toBe('ł');
  });

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeEntities('&notreal;')).toBe('&notreal;');
  });
});

describe('parsePolishDate', () => {
  it('reads the genitive month a real date uses', () => {
    expect(parsePolishDate('Premiera: 22 listopada 2026')).toBe('2026-11-22');
    expect(parsePolishDate('6 grudnia 2026')).toBe('2026-12-06');
  });

  it('folds diacritics, including the ł that NFD does not decompose', () => {
    expect(parsePolishDate('8 października 2026')).toBe('2026-10-08');
    expect(parsePolishDate('3 pazdziernika 2026')).toBe('2026-10-03');
  });

  it('returns null rather than guessing', () => {
    // An unparseable date becomes dateText and is printed as the theatre wrote it, which beats a
    // wrong day.
    expect(parsePolishDate('Premiera: jesień 2027')).toBeNull();
    expect(parsePolishDate('')).toBeNull();
    expect(parsePolishDate('40 listopada 2026')).toBeNull();
  });
});

describe('warsawEpoch', () => {
  it('uses the offset actually in force on that date', () => {
    // Poland observes DST; a fixed offset puts every summer curtain an hour out one way and every
    // winter one the other.
    expect(new Date(warsawEpoch('2026-11-22', 19)!).toISOString()).toBe('2026-11-22T18:00:00.000Z');
    expect(new Date(warsawEpoch('2026-07-22', 19)!).toISOString()).toBe('2026-07-22T17:00:00.000Z');
  });

  it('is null for a malformed day', () => {
    expect(warsawEpoch('nope')).toBeNull();
  });
});

/*
 * The sale sentence, which is the only place the theatre states the one date with a deadline on
 * it — and which is written in prose, in Polish, without a year.
 */
describe('parseSaleAnnouncement', () => {
  const on = (text: string, published: string | null = '2026-08-31') =>
    parseSaleAnnouncement(text, published);

  it('reads the sentence the theatre actually publishes', () => {
    expect(on('Sprzedaż biletów od 1 września, g. 11.00')).toEqual({
      day: '2026-09-01',
      hour: 11,
    });
  });

  it('resolves the missing year from the day the article was published', () => {
    // There is no year in the sentence. The publication date is the only thing that can settle it.
    expect(on('Sprzedaż biletów od 15 marca', '2027-02-20')!.day).toBe('2027-03-15');
  });

  it('rolls into the next year when the sale is announced across the turn of it', () => {
    // A December announcement of a January sale. The naive answer puts the deadline in the past.
    expect(on('Sprzedaż biletów od 7 stycznia, g. 10.00', '2026-12-15')!.day).toBe('2027-01-07');
  });

  it('prefers a year the sentence states over one it would have guessed', () => {
    expect(on('Sprzedaż biletów na sezon rozpocznie się od 1 września 2027')!.day).toBe(
      '2027-09-01',
    );
  });

  it('refuses a year-less date with no publication day to reason from', () => {
    // Guessing "this year" here would put a deadline on the calendar out of nothing.
    expect(on('Sprzedaż biletów od 1 września', null)).toBeNull();
  });

  it('ignores a date that is not about a sale at all', () => {
    /*
     * Straight off the same news list: "Od 12 czerwca 2026 roku nasi Widzowie mogą korzystać z 30%
     * zniżki na parking podziemny". A reader that took any date after "od" would put a car park
     * discount on the calendar as a ticket sale.
     */
    expect(
      on('Od 12 czerwca 2026 roku nasi Widzowie mogą korzystać z 30% zniżki na parking'),
    ).toBeNull();
    expect(on('Premiera 22 listopada 2026')).toBeNull();
  });

  it('reads the date that follows the sale wording, not the first one on the row', () => {
    expect(
      on('Premiera 22 listopada 2026. Sprzedaż biletów od 1 września 2026, g. 11.00')!.day,
    ).toBe('2026-09-01');
  });

  it('falls back to a morning hour when only a day is given', () => {
    expect(on('Sprzedaż biletów od 1 września 2026')!.hour).toBe(SALE_DEFAULT_HOUR);
  });

  it('reads the hour however the page abbreviates it', () => {
    expect(on('Sprzedaż biletów od 1 września 2026, godz. 9:30')!.hour).toBe(9);
    expect(on('Sprzedaż biletów od 1 września 2026 od godziny 18')!.hour).toBe(18);
  });

  it('refuses a day that does not exist rather than rolling it into the next month', () => {
    // `new Date(2026, 1, 31)` is the 3rd of March, which is a notification on the wrong morning.
    expect(on('Sprzedaż biletów od 31 lutego 2027')).toBeNull();
  });

  it('refuses a month it cannot read rather than guessing one', () => {
    expect(on('Sprzedaż biletów od 4 brumaire 2026')).toBeNull();
  });
});
