import { describe, expect, it } from 'vitest';
import { decodeEntities, parsePolishDate, stripTags, warsawEpoch } from './html';

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
