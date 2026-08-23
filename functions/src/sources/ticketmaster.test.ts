import { describe, expect, it } from 'vitest';
import { tagsOf, toRawEvent } from './ticketmaster';

const event = {
  id: 'G5vYZbFvY1',
  name: 'Pink Floyd Tribute Show',
  url: 'https://www.ticketmaster.pl/event/G5vYZbFvY1',
  dates: { start: { dateTime: '2027-03-14T19:00:00Z' } },
  sales: { public: { startDateTime: '2026-09-01T08:00:00Z' } },
  classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' }, subGenre: { name: 'Pop Rock' } }],
  _embedded: {
    venues: [{ name: 'Torwar', city: { name: 'Warszawa' } }],
    attractions: [{ name: 'Australian Pink Floyd Show' }],
  },
};

describe('toRawEvent', () => {
  it('maps the fields the collector needs', () => {
    const raw = toRawEvent(event)!;
    expect(raw.sourceKey).toBe('G5vYZbFvY1');
    expect(raw.title).toBe('Pink Floyd Tribute Show');
    expect(raw.city).toBe('Warszawa');
    expect(raw.venue).toBe('Torwar');
    expect(new Date(raw.startsAt!).toISOString()).toBe('2027-03-14T19:00:00.000Z');
  });

  it('treats the listing as its own ticket page', () => {
    // Which is why this source can never produce an `onsale` transition — correct, rather than a
    // gap: it only lists what is already on sale.
    expect(toRawEvent(event)!.ticketUrl).toBe(event.url);
  });

  it('puts the act in the subtitle when it differs from the event name', () => {
    expect(toRawEvent(event)!.subtitle).toBe('Australian Pink Floyd Show');
  });

  it('reads a date-only start', () => {
    const raw = toRawEvent({ ...event, dates: { start: { localDate: '2027-03-14' } } })!;
    expect(raw.startsAt).not.toBeNull();
  });

  it('returns null for a row with no id or no name', () => {
    expect(toRawEvent({ name: 'x' })).toBeNull();
    expect(toRawEvent({ id: 'x' })).toBeNull();
  });

  it('survives a listing with no venue or classification at all', () => {
    const raw = toRawEvent({ id: 'x', name: 'Bare' })!;
    expect(raw.city).toBeUndefined();
    expect(raw.tags).toContain('ticketed');
  });
});

describe('tagsOf', () => {
  it('maps their tree onto the vocabulary the other sources use', () => {
    // So an interest asking for `opera` matches a Ticketmaster listing and a Teatr Wielki one alike.
    expect(tagsOf({ classifications: [{ segment: { name: 'Music' }, genre: { name: 'Classical' } }] }))
      .toEqual(expect.arrayContaining(['music', 'opera']));
    expect(tagsOf({ classifications: [{ segment: { name: 'Arts & Theatre' } }] }))
      .toContain('theatre');
  });

  it('keeps the raw genre too, so a keyword can reach what the fixed vocabulary missed', () => {
    expect(tagsOf({ classifications: [{ genre: { name: 'World Music' } }] }))
      .toEqual(expect.arrayContaining(['folk', 'world-music']));
  });

  it('always marks the source as ticketed', () => {
    expect(tagsOf({})).toEqual(['ticketed']);
  });
});
