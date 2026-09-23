import { describe, expect, it } from 'vitest';
import {
  announcedAt,
  buildFeed,
  bySource,
  dedupeByFingerprint,
  groupOf,
  placeLabel,
  saleWhenLabel,
  whenLabel,
} from './feed';
import { setSourceCity, setSourceEnabled } from './sourcePrefs';
import { fingerprintOf } from './normalize';
import type { EventRecord } from './types';

const DAY = 86400000;
const NOW = Date.parse('2026-08-23T12:00:00Z');

let n = 0;
function ev(p: Partial<EventRecord> & { title: string }): EventRecord {
  const day = p.day ?? '2026-12-01';
  return {
    id: p.id ?? `e${n++}`,
    source: 'feed',
    sourceKey: p.title,
    sourceName: 'test',
    url: 'https://example.test/e',
    startsAt: 'startsAt' in p ? p.startsAt! : Date.parse(`${day}T18:00:00Z`),
    day,
    tags: p.tags ?? [],
    fingerprint: p.fingerprint ?? fingerprintOf({ title: p.title, day }),
    firstSeenAt: p.firstSeenAt ?? NOW - DAY,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

describe('dedupeByFingerprint', () => {
  it('keeps the copy that has a ticket link', () => {
    // Ticketmaster and a scrape of the same night. Showing both makes the app look broken; the
    // one you can buy from is the one worth keeping.
    const fp = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14' });
    const scraped = ev({ id: 'tw', title: 'Wesele Figara', fingerprint: fp, firstSeenAt: 1 });
    const sold = ev({
      id: 'tm', title: 'Wesele Figara', fingerprint: fp, firstSeenAt: 9,
      ticketUrl: 'https://tickets.test/x',
    });
    expect(dedupeByFingerprint([scraped, sold]).map((e) => e.id)).toEqual(['tm']);
    // ...and the answer does not depend on the order they arrived in.
    expect(dedupeByFingerprint([sold, scraped]).map((e) => e.id)).toEqual(['tm']);
  });

  it('falls back to the one seen first, so the choice is stable', () => {
    const fp = fingerprintOf({ title: 'X', day: '2027-01-14' });
    const older = ev({ id: 'a', title: 'X', fingerprint: fp, firstSeenAt: 1 });
    const newer = ev({ id: 'b', title: 'X', fingerprint: fp, firstSeenAt: 9 });
    expect(dedupeByFingerprint([newer, older]).map((e) => e.id)).toEqual(['a']);
  });

  it('leaves genuinely different events alone', () => {
    expect(dedupeByFingerprint([ev({ title: 'A' }), ev({ title: 'B' })])).toHaveLength(2);
  });
});

describe('groupOf', () => {
  it('buckets by how soon, with undated last', () => {
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 3 * DAY }), NOW)).toBe('week');
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 20 * DAY }), NOW)).toBe('month');
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 200 * DAY }), NOW)).toBe('later');
    expect(groupOf(ev({ title: 'X', startsAt: null, day: null }), NOW)).toBe('undated');
  });
});

describe('buildFeed', () => {
  it('drops what has already happened', () => {
    const past = ev({ title: 'Gone', startsAt: NOW - 5 * DAY });
    expect(buildFeed([past], NOW)).toEqual([]);
  });

  it('keeps everything an enabled source collected', () => {
    /*
     * The contract since the interests went: the feed is the corpus minus what is past and minus
     * what a switch is keeping out. A row nobody would have written a keyword for is still a row
     * the source produced, and deciding it is not worth reading is that source's business.
     */
    const sections = buildFeed([ev({ title: 'Techno' }), ev({ title: 'Koncert klezmerski' })], NOW);
    expect(sections.flatMap((s) => s.events)).toHaveLength(2);
  });

  it('keeps a coverage row, the kind rule having gone with the interests', () => {
    // `Interest.includeCoverage` was the opt-in; there is no opt-in and no opt-out now. A sponsor
    // post about a marathon is a row the running blog published, and it is switched off by feed.
    const sponsor = ev({ title: 'Marki DIP Hot Partnerem 48. Maratonu', kind: 'coverage' });
    expect(buildFeed([sponsor], NOW)[0].events).toHaveLength(1);
  });

  /*
   * A source switched off on the Sources tab — which is now the only thing standing between the
   * corpus and this list. What it is currently keeping out is counted on that tab, beside it.
   */
  it('hides the events of a source that has been switched off', () => {
    const off = setSourceEnabled({}, 'feed', false, NOW);
    expect(buildFeed([ev({ title: 'X' })], NOW, { sources: off })).toEqual([]);
  });

  it('leaves the other sources alone', () => {
    const off = setSourceEnabled({}, 'feed', false, NOW);
    const race = ev({ title: 'X', source: 'elektroniczne-zapisy' });
    expect(buildFeed([race], NOW, { sources: off })[0].events).toHaveLength(1);
  });

  it('keeps only the town a source is narrowed to, and rows that state none', () => {
    const waw = setSourceCity({}, 'elektroniczne-zapisy', 'Warszawa', NOW);
    const races = [
      ev({ title: 'Maraton', source: 'elektroniczne-zapisy', city: 'Warszawa' }),
      ev({ title: 'Dycha', source: 'elektroniczne-zapisy', city: 'Gdańsk' }),
      ev({ title: 'Unplaced', source: 'elektroniczne-zapisy', city: undefined }),
    ];
    const titles = buildFeed(races, NOW, { sources: waw }).flatMap((s) => s.events.map((e) => e.title));
    expect(titles.sort()).toEqual(['Maraton', 'Unplaced']);
  });

  it('orders chronologically and groups in reading order', () => {
    const sections = buildFeed(
      [
        ev({ title: 'Far', startsAt: NOW + 100 * DAY }),
        ev({ title: 'Undated', startsAt: null, day: null }),
        ev({ title: 'Soon', startsAt: NOW + 2 * DAY }),
        ev({ title: 'Mid', startsAt: NOW + 20 * DAY }),
      ],
      NOW,
    );
    expect(sections.map((s) => s.group)).toEqual(['week', 'month', 'later', 'undated']);
    expect(sections[0].events[0].title).toBe('Soon');
  });

  it('orders two events on one day by id, so a re-render does not reshuffle', () => {
    const at = NOW + 2 * DAY;
    const b = ev({ id: 'zz', title: 'B', startsAt: at });
    const a = ev({ id: 'aa', title: 'A', startsAt: at });
    expect(buildFeed([b, a], NOW)[0].events.map((e) => e.id)).toEqual(['aa', 'zz']);
  });

  it('omits an empty group rather than rendering a bare heading', () => {
    const sections = buildFeed([ev({ title: 'Soon', startsAt: NOW + 2 * DAY })], NOW);
    expect(sections.map((s) => s.group)).toEqual(['week']);
  });
});

describe('bySource', () => {
  it('splits the corpus by the adapter that produced each row', () => {
    const grouped = bySource([
      ev({ title: 'A', source: 'feed' }),
      ev({ title: 'B', source: 'elektroniczne-zapisy' }),
      ev({ title: 'C', source: 'feed' }),
    ]);
    expect(grouped.get('feed')).toHaveLength(2);
    expect(grouped.get('elektroniczne-zapisy')).toHaveLength(1);
    expect(grouped.get('ticketmaster')).toBeUndefined();
  });
});

describe('placeLabel', () => {
  it('does not say the city twice', () => {
    // An iCal LOCATION is one free-text line that the adapter also extracts a city from, so the
    // pair joined naively reads "Brisbane, Australia, Brisbane". Seen on the live feed.
    expect(placeLabel({ venue: 'Brisbane, Australia', city: 'Brisbane' })).toBe('Brisbane, Australia');
  });

  it('compares folded, so Kraków matches Krakow', () => {
    expect(placeLabel({ venue: 'Kraków, Poland', city: 'Krakow' })).toBe('Kraków, Poland');
  });

  it('keeps both when the venue genuinely does not name the city', () => {
    expect(placeLabel({ venue: 'Teatr Wielki – Opera Narodowa', city: 'Warszawa' })).toBe(
      'Teatr Wielki – Opera Narodowa, Warszawa',
    );
  });

  it('copes with either half missing', () => {
    expect(placeLabel({ city: 'Warszawa' })).toBe('Warszawa');
    expect(placeLabel({ venue: 'Torwar' })).toBe('Torwar');
    expect(placeLabel({})).toBe('');
  });
});

describe('whenLabel', () => {
  const dated = { startsAt: Date.parse('2026-11-22T18:00:00Z') };

  it('prints a clock for an event that has one', () => {
    expect(whenLabel(dated, 'en-GB')).toMatch(/19:00/);
  });

  it('prints NO clock for an all-day event', () => {
    /*
     * iCal's VALUE=DATE carries no time, so it lands on midnight UTC and rendering it in Warsaw
     * produced "Thu 27 Aug, 02:00" for a conference that starts whenever the doors open — a
     * precision the source never claimed, and one that would differ either side of a DST change.
     */
    const allDay = { startsAt: Date.parse('2026-08-27T00:00:00Z'), allDay: true };
    expect(whenLabel(allDay, 'en-GB')).not.toMatch(/\d\d:\d\d/);
    expect(whenLabel(allDay, 'en-GB')).toMatch(/27/);
  });

  it('falls back to the source’s own words when the date could not be parsed', () => {
    // "Premiera: jesień 2027" is genuinely what the theatre said, and a blank reads as a bug.
    expect(whenLabel({ startsAt: null, dateText: 'Premiera: jesień 2027' }, 'en-GB')).toBe(
      'Premiera: jesień 2027',
    );
  });

  it('is never blank', () => {
    expect(whenLabel({ startsAt: null }, 'en-GB')).toBe('—');
  });
});

describe('announcedAt', () => {
  it('is what the source published, not when the collector arrived', () => {
    /*
     * A news list holds ten items and a feed twenty, so the first run meets a whole back
     * catalogue at one `firstSeenAt` — ordering the undated group by it is ordering by nothing,
     * with a two-month-old article above this morning's.
     */
    const published = Date.parse('2026-07-06T00:00:00Z');
    expect(announcedAt({ publishedAt: published, firstSeenAt: NOW })).toBe(published);
    expect(announcedAt({ firstSeenAt: NOW })).toBe(NOW);
  });

  it('orders the undated group by it', () => {
    const seen = NOW - DAY;
    const old = ev({
      title: 'From July',
      startsAt: null,
      day: null,
      firstSeenAt: seen,
      publishedAt: Date.parse('2026-07-06T00:00:00Z'),
    });
    const fresh = ev({
      title: 'From yesterday',
      startsAt: null,
      day: null,
      firstSeenAt: seen,
      publishedAt: NOW - DAY,
    });
    const [section] = buildFeed([old, fresh], NOW);
    expect(section.group).toBe('undated');
    expect(section.events.map((e) => e.title)).toEqual(['From yesterday', 'From July']);
  });
});

/*
 * A sale announcement: no date of its own, and a date you can be late for.
 *
 * The one shape in the corpus where `startsAt` being null does not mean "not actionable yet". The
 * theatre's news item is an article — the RSS rule holds — but the sentence inside it names the
 * morning the box office opens, which is the only thing on the card worth being on time for.
 */
describe('a dateless event with a known sale date', () => {
  const saleAt = Date.parse('2026-08-26T09:00:00Z');
  const announcement = () =>
    ev({
      title: 'Sprzedaż biletów na sezon 2027/28',
      startsAt: null,
      day: null,
      onSaleAt: saleAt,
    } as Partial<EventRecord> & { title: string });

  it('is grouped by when the sale opens, not filed under “no dates yet”', () => {
    // Three days out. Filed as undated it would sit below every concert in the corpus.
    expect(groupOf(announcement(), NOW)).toBe('week');
  });

  it('sorts among the dated events by that same moment', () => {
    const later = ev({ title: 'Concert', day: '2026-09-10' });
    const sections = buildFeed([later, announcement()], NOW);
    expect(sections.flatMap((s) => s.events).map((e) => e.title)[0]).toBe(
      'Sprzedaż biletów na sezon 2027/28',
    );
  });

  it('drops out of the feed once the sale it announced has opened', () => {
    const past = ev({
      title: 'Old sale',
      startsAt: null,
      day: null,
      onSaleAt: NOW - 3 * DAY,
    } as Partial<EventRecord> & { title: string });
    expect(buildFeed([past], NOW)).toEqual([]);
  });

  it('leaves an ordinary undated announcement exactly where it was', () => {
    /*
     * The guard on this whole change: `onSaleAt` is only ever set where a source stated a sale
     * date in advance, so an RSS article or a season with no nights scheduled must not move.
     */
    const article = ev({
      title: 'Season announced',
      startsAt: null,
      day: null,
    } as Partial<EventRecord> & { title: string });
    expect(groupOf(article, NOW)).toBe('undated');
    expect(buildFeed([article], NOW)).toHaveLength(1);
  });
});

describe('saleWhenLabel', () => {
  it('names the hour, a sale opening at 11.00 not being one opening at midnight', () => {
    const at = Date.parse('2026-09-01T09:00:00Z'); // 11:00 Warsaw, summer time.
    expect(saleWhenLabel({ onSaleAt: at }, 'en-GB')).toMatch(/11:00/);
    expect(saleWhenLabel({ onSaleAt: at }, 'en-GB')).toMatch(/1 Sep/);
  });

  it('says nothing where no source stated a sale date', () => {
    expect(saleWhenLabel({}, 'en-GB')).toBeNull();
  });
});
