import { describe, expect, it } from 'vitest';
import { distancesIn, distancesOf, formatDistance, formatDistances } from './distance';

const running = (title: string, subtitle?: string) =>
  distancesOf({ title, subtitle, tags: ['running'] });

describe('distancesIn', () => {
  it('reads a plain kilometre distance', () => {
    expect(distancesIn('XII Bieg Ziemi Puckiej na 10 km')).toEqual([10000]);
  });

  it('reads it written without a space, and in the English short form', () => {
    expect(distancesIn('Nocna 5km')).toEqual([5000]);
    expect(distancesIn('City Run 10K')).toEqual([10000]);
  });

  it('accepts a comma decimal, which is how Polish writes one', () => {
    expect(distancesIn('Bieg na 21,097 km')).toEqual([21097]);
  });

  it('reads metres, for the distances nobody writes in kilometres', () => {
    expect(distancesIn('Bieg dla dzieci - 800 m')).toEqual([800]);
  });

  it('lists every distance a race weekend offers, ascending', () => {
    expect(distancesIn('Sopocki Półmaraton, bieg na 5 km, biegi dzieci')).toEqual([5000, 21097]);
  });

  /*
   * The named distances. Polish titles a race after its length far more often than they state it,
   * and these words are the only thing standing between a marathon and a card that says nothing.
   */
  it('knows the marathons', () => {
    expect(distancesIn('48. Maraton Warszawski')).toEqual([42195]);
    expect(distancesIn('Garmin Półmaraton Gdańsk')).toEqual([21097]);
    expect(distancesIn('PKO Korona Śląskich Półmaratonów')).toEqual([21097]);
  });

  it('does not let półmaraton also read as a marathon', () => {
    expect(distancesIn('35. Półmaraton Piła')).toEqual([21097]);
  });

  it('does not read an ultra as a marathon, because an ultra has no one distance', () => {
    expect(distancesIn('Garmin Ultra Race Gdańsk')).toEqual([]);
    expect(distancesIn('Ultramaraton Bieszczadzki')).toEqual([]);
  });

  it('normalises the English half marathon rather than counting it twice', () => {
    expect(distancesIn('Warsaw Half Marathon')).toEqual([21097]);
    expect(distancesIn('Warsaw Marathon')).toEqual([42195]);
  });

  it('knows the colloquial Polish names, through their inflections', () => {
    expect(distancesIn('14. Stalowa Dycha im. Bogdana Dziuby')).toEqual([10000]);
    expect(distancesIn('IX Srebrna Dziesiątka')).toEqual([10000]);
    expect(distancesIn('XVII Hajnowska Dwunastka')).toEqual([12000]);
    expect(distancesIn('ZAMKOWA ENERGETYCZNA ÓSEMKA 2026')).toEqual([8000]);
    expect(distancesIn('Nocnej Piątki nie będzie')).toEqual([5000]);
  });

  /*
   * The whole of this module's safety. Every one of these is a real row from the four listings the
   * collector reads, and every number in them is an edition, a round, a year or a date.
   */
  it('never mints a distance from a bare number', () => {
    expect(distancesIn('44 Międzynarodowy Otwarty Bieg Przełajowy')).toEqual([]);
    expect(distancesIn('5. Pietrasze Cross Country 1/5')).toEqual([]);
    expect(distancesIn('Grand Prix Piekar Śląskich 2026 - 13.09.2026')).toEqual([]);
    expect(distancesIn('Redzka 10')).toEqual([]);
    expect(distancesIn('64. Bieg Westerplatte')).toEqual([]);
  });

  it('does not read Bieg 3 Króli as a 3 km race', () => {
    expect(distancesIn('Bieg 3 Króli - Grand Prix Trójmiasta 2027 - 1/3')).toEqual([]);
  });

  it('keeps a hundred-kilometre relay and drops the centenary it is named for', () => {
    expect(distancesIn('100 KM W SZTAFECIE NA STADIONU 100-LECIE')).toEqual([100000]);
  });

  it('refuses distances outside what a race can be', () => {
    // A year with a unit welded on, an elevation, and a stray single digit.
    expect(distancesIn('Bieg 2026 km')).toEqual([]);
    expect(distancesIn('start 9000 m n.p.m.')).toEqual([]);
    expect(distancesIn('Bieg na 5 m')).toEqual([]);
  });

  it('caps how many one card may carry', () => {
    expect(distancesIn('1 km 2 km 3 km 4 km 5 km 6 km 7 km 8 km')).toEqual([
      1000, 2000, 3000, 4000, 5000, 6000,
    ]);
  });
});

describe('distancesOf', () => {
  it('is undefined rather than empty when the title does not say', () => {
    expect(running('VII Bieg o Puchar Wójta')).toBeUndefined();
  });

  /*
   * The gate. `maraton` is a live Polish word for a long sitting of anything, and without the tag
   * the same rules that are exactly right about a race put 42.2 km on a film night.
   */
  it('says nothing about an event that is not a race', () => {
    expect(distancesOf({ title: 'Maraton filmowy: Kieślowski', tags: ['film'] })).toBeUndefined();
    expect(distancesOf({ title: 'Bieg na 10 km', tags: [] })).toBeUndefined();
    expect(distancesOf({ title: 'Bieg na 10 km' })).toBeUndefined();
  });

  it('reads the subtitle as well as the title', () => {
    expect(running('Bieg Niepodległości', 'dystans 5 km')).toEqual([5000]);
  });
});

describe('formatDistance', () => {
  it('says a round distance without a decimal point', () => {
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(100000)).toBe('100 km');
  });

  it('gives the marathons the one decimal that identifies them', () => {
    expect(formatDistance(21097)).toBe('21.1 km');
    expect(formatDistance(42195)).toBe('42.2 km');
  });

  it('keeps a sub-kilometre race in metres', () => {
    expect(formatDistance(800)).toBe('800 m');
  });

  it('joins a list the way a card and a push body both print it', () => {
    expect(formatDistances([5000, 21097])).toBe('5 km · 21.1 km');
    expect(formatDistances(undefined)).toBe('');
  });
});
