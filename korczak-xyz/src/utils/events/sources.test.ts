import { describe, expect, it } from 'vitest';
import { FEEDS, SOURCE_CATALOGUE, catalogueEntry, displayUrl, seasonPaths } from './sources';

describe('SOURCE_CATALOGUE', () => {
  it('names at least one real page per source', () => {
    const now = Date.parse('2026-08-23T00:00:00Z');
    expect(SOURCE_CATALOGUE.length).toBeGreaterThan(0);
    for (const entry of SOURCE_CATALOGUE) {
      const pages = entry.pages(now);
      expect(pages.length, `${entry.id} lists no pages`).toBeGreaterThan(0);
      for (const page of pages) {
        expect(page.url, `${entry.id} page url`).toMatch(/^https:\/\//);
        expect(page.label, `${entry.id} page label`).toBeTruthy();
      }
      expect(entry.label).toBeTruthy();
    }
  });

  it('carries no secret, being compiled into the browser bundle', () => {
    /*
     * The one rule this module has. A URL here is shown on a page anyone signed in can open, so a
     * key pasted into a query string — the shape the Ticketmaster request actually takes, with
     * `apikey` appended at the point of the request — would be published by the tab that lists it.
     */
    const now = Date.now();
    for (const entry of SOURCE_CATALOGUE) {
      for (const page of entry.pages(now)) {
        expect(page.url.toLowerCase(), `${entry.id} page url`).not.toMatch(
          /apikey|api_key|token|secret|password/,
        );
      }
    }
  });

  it('has a unique id per source, since health rows join on it', () => {
    const ids = SOURCE_CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds an entry by id and answers undefined for one it does not describe', () => {
    expect(catalogueEntry('teatr-wielki')?.kind).toBe('scrape');
    // `classifier` writes an `eventSources` row and is not a page. The tab has to be able to tell.
    expect(catalogueEntry('classifier')).toBeUndefined();
  });
});

describe('displayUrl', () => {
  it('leaves a short URL alone but for the scheme, the link text being the page itself', () => {
    expect(displayUrl('https://teatrwielki.pl/repertuar/sezon-2026/27/')).toBe(
      'teatrwielki.pl/repertuar/sezon-2026/27/',
    );
  });

  it('collapses a long one to its host and last segment', () => {
    // The python.org calendar id is 103 characters of nothing anyone can read, and at 320px it
    // takes three lines to say it. The href stays whole.
    expect(
      displayUrl(
        'https://www.google.com/calendar/ical/j7gov1cmnqr9tvg14k621j7t5c%40group.calendar.google.com/public/basic.ics',
      ),
    ).toBe('www.google.com/…/basic.ics');
  });

  it('drops a long query, which the page meta says in words anyway', () => {
    expect(
      displayUrl('https://app.ticketmaster.com/discovery/v2/events.json?countryCode=PL&sort=date,asc'),
    ).toBe('app.ticketmaster.com/…/events.json');
  });

  it('survives a URL with no path to shorten', () => {
    expect(displayUrl('https://example.test/')).toBe('example.test/');
  });
});

describe('FEEDS', () => {
  it('names a real feed and the tags an interest can narrow by', () => {
    expect(FEEDS.length).toBeGreaterThan(0);
    for (const entry of FEEDS) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.tags?.length ?? 0).toBeGreaterThan(0);
      expect(entry.label).toBeTruthy();
    }
  });
});

describe('seasonPaths', () => {
  it('watches the current and the next season, since a new page IS the announcement', () => {
    const paths = seasonPaths(Date.parse('2026-08-23T00:00:00Z'));
    expect(paths).toEqual([
      'https://teatrwielki.pl/repertuar/sezon-2026/27/',
      'https://teatrwielki.pl/repertuar/sezon-2027/28/',
    ]);
  });

  it('still points at the running season in January', () => {
    // A season announced in spring 2026 runs into summer 2027, so in January 2027 the current
    // pair is still 2026/27.
    expect(seasonPaths(Date.parse('2027-01-15T00:00:00Z'))[0]).toContain('sezon-2026/27');
  });

  it('pads the second year, so 2029/30 does not become 2029/3', () => {
    expect(seasonPaths(Date.parse('2029-06-01T00:00:00Z'))[0]).toContain('sezon-2029/30');
    expect(seasonPaths(Date.parse('2099-06-01T00:00:00Z'))[0]).toContain('sezon-2099/00');
  });

  it('marks next season optional, its 404 being the ordinary case', () => {
    const pages = catalogueEntry('teatr-wielki')!.pages(Date.parse('2026-08-23T00:00:00Z'));
    expect(pages[0].optional).toBeFalsy();
    expect(pages[1].optional).toBe(true);
  });
});
