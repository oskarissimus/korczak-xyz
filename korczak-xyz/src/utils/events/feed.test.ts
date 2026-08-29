import { describe, expect, it } from 'vitest';
import {
  buildFeed,
  classificationCoverage,
  countryTally,
  dedupeByFingerprint,
  groupOf,
  placeLabel,
  whenLabel,
} from './feed';
import { fingerprintOf, haystackOf } from './normalize';
import type { EventRecord, Interest } from './types';

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
    haystack: p.haystack ?? haystackOf({ title: p.title }),
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

const ALL: Interest = {
  id: 'i1', rev: 0, updatedAt: NOW, writerId: 'w', createdAt: 0,
  label: 'Everything', keywords: [], leadDays: 14,
};

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
    expect(buildFeed([past], [ALL], NOW)).toEqual([]);
  });

  it('shows a muted interest’s matches', () => {
    // Muting says "do not wake me", not "hide it from me". Conflating the two makes a muted
    // interest indistinguishable from a deleted one.
    const muted: Interest = { ...ALL, muted: true };
    const sections = buildFeed([ev({ title: 'X' })], [muted], NOW);
    expect(sections[0].items).toHaveLength(1);
  });

  it('hides everything when no interest matches', () => {
    const narrow: Interest = { ...ALL, keywords: ['klezmer'] };
    expect(buildFeed([ev({ title: 'Techno' })], [narrow], NOW)).toEqual([]);
  });

  it('shows unmatched events when asked to show everything', () => {
    const narrow: Interest = { ...ALL, keywords: ['klezmer'] };
    const sections = buildFeed([ev({ title: 'Techno' })], [narrow], NOW, { mode: 'all' });
    expect(sections[0].items[0].matched).toEqual([]);
  });

  it('orders chronologically and groups in reading order', () => {
    const sections = buildFeed(
      [
        ev({ title: 'Far', startsAt: NOW + 100 * DAY }),
        ev({ title: 'Undated', startsAt: null, day: null }),
        ev({ title: 'Soon', startsAt: NOW + 2 * DAY }),
        ev({ title: 'Mid', startsAt: NOW + 20 * DAY }),
      ],
      [ALL],
      NOW,
    );
    expect(sections.map((s) => s.group)).toEqual(['week', 'month', 'later', 'undated']);
    expect(sections[0].items[0].event.title).toBe('Soon');
  });

  it('omits an empty group rather than rendering a bare heading', () => {
    const sections = buildFeed([ev({ title: 'Soon', startsAt: NOW + 2 * DAY })], [ALL], NOW);
    expect(sections.map((s) => s.group)).toEqual(['week']);
  });

  it('records which interests matched, so a row can say why it is there', () => {
    const klezmer: Interest = { ...ALL, id: 'k', label: 'Klezmer', keywords: ['klezmer*'] };
    const sections = buildFeed([ev({ title: 'Koncert klezmerski' })], [ALL, klezmer], NOW);
    expect(sections[0].items[0].matched.map((i) => i.label)).toEqual(['Everything', 'Klezmer']);
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

describe('buildFeed in rejected-place mode', () => {
  // The screenshot that started this, plus the one that has to survive it.
  const pyconNL = ev({ title: 'PyCon NL 2026', country: 'NL', reach: 'national' });
  const pyconCM = ev({ title: 'PyCon Cameroon 2026', country: 'CM', reach: 'national' });
  const europython = ev({ title: 'EuroPython 2026', country: 'CZ', reach: 'international' });
  const klezmer = ev({ title: 'Koncert klezmerski', country: 'PL', reach: 'local' });

  const dev: Interest = {
    id: 'dev', rev: 0, updatedAt: NOW, writerId: 'w', createdAt: 0,
    label: 'Python & dev', keywords: ['pycon', 'europython'], leadDays: 14,
    countries: ['PL'], internationalAnywhere: true,
  };

  const corpus = [pyconNL, pyconCM, europython, klezmer];
  const titles = (mode: 'matched' | 'rejected-place' | 'all') =>
    buildFeed(corpus, [dev], NOW, { mode })
      .flatMap((s) => s.items)
      .map((i) => i.event.title)
      .sort();

  it('lists exactly what the places rule removed', () => {
    expect(titles('rejected-place')).toEqual(['PyCon Cameroon 2026', 'PyCon NL 2026']);
  });

  it('is the complement of what matched, over the events any interest reaches', () => {
    // The two views must not overlap and must not both miss something: an event in neither is one
    // this feature quietly lost.
    expect(titles('matched')).toEqual(['EuroPython 2026']);
    expect(titles('all').length).toBe(4);
  });

  /*
   * A keyword miss is not a near miss. Without this the verification view fills up with the whole
   * corpus — every concert in the country is also "not a Python conference in Poland" — and the
   * one question it is meant to answer becomes unreadable.
   */
  it('never lists an event that failed on something before the places rule', () => {
    expect(titles('rejected-place')).not.toContain('Koncert klezmerski');
  });

  it('does not list an event another interest already lets through', () => {
    const everything: Interest = { ...ALL, id: 'all' };
    const shown = buildFeed(corpus, [dev, everything], NOW, { mode: 'rejected-place' });
    expect(shown).toEqual([]);
  });

  it('carries the interests that did the rejecting, so the card can name them', () => {
    const items = buildFeed(corpus, [dev], NOW, { mode: 'rejected-place' }).flatMap((s) => s.items);
    expect(items.every((i) => i.rejectedBy?.map((r) => r.id).includes('dev'))).toBe(true);
  });

  it('is empty while no interest constrains where, so nothing vanishes unexplained', () => {
    const anywhere: Interest = { ...dev, countries: undefined, internationalAnywhere: undefined };
    expect(buildFeed(corpus, [anywhere], NOW, { mode: 'rejected-place' })).toEqual([]);
  });
});

describe('countryTally', () => {
  it('counts by country, commonest first, with the unplaced countable', () => {
    expect(
      countryTally([
        ev({ title: 'a', country: 'NL' }),
        ev({ title: 'b', country: 'NL' }),
        ev({ title: 'c', country: 'CM' }),
        ev({ title: 'd' }),
      ]),
    ).toEqual([
      { code: 'NL', count: 2 },
      { code: '?', count: 1 },
      { code: 'CM', count: 1 },
    ]);
  });
});

describe('classificationCoverage', () => {
  /*
   * The half the rejected list structurally cannot show: an unclassified event passes the places
   * rule, so it is never in that list, and a classifier that has stopped looks exactly like a
   * filter with nothing to remove.
   */
  it('counts what has a reach, not what has a country', () => {
    expect(
      classificationCoverage([
        ev({ title: 'a', country: 'PL', reach: 'local' }),
        ev({ title: 'b', country: 'PL' }),
        ev({ title: 'c' }),
      ]),
    ).toEqual({ classified: 1, total: 3 });
  });
});
