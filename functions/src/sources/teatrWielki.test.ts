import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeasonPage, seasonPaths, slugOf, tagsFor } from './teatrWielki';

/*
 * A committed fixture of the real page.
 *
 * teatrwielki.pl will be redesigned, and when it is this test is what turns a silently empty feed
 * into a red build. Re-saving the fixture and adjusting the regex is then a fifteen-minute job with
 * a green light at the end, instead of an afternoon wondering why no opera has been announced.
 */
const html = readFileSync(new URL('./fixtures/teatr-wielki-season.html', import.meta.url), 'utf8');
const events = parseSeasonPage(html);

describe('parseSeasonPage', () => {
  it('finds the productions', () => {
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it('reads a title, a composer and a premiere date', () => {
    const salome = events.find((e) => e.title === 'SALOME');
    expect(salome).toBeDefined();
    expect(salome!.subtitle).toContain('Richard Strauss');
    expect(salome!.url).toBe('https://teatrwielki.pl/kalendarium/2026-2027/salome/');
    // 22 November 2026, 19:00 Warsaw — which is winter time, so 18:00 UTC.
    expect(new Date(salome!.startsAt!).toISOString()).toBe('2026-11-22T18:00:00.000Z');
  });

  it('strips the inner tags real titles contain', () => {
    // <h2>COPP<span>É</span>LIA</h2> — read raw, this becomes "COPPLIA" or keeps the markup.
    expect(events.map((e) => e.title)).toContain('COPPÉLIA');
  });

  it('keeps the theatre’s own words for the date, whatever we parsed', () => {
    const salome = events.find((e) => e.title === 'SALOME')!;
    expect(salome.dateText).toMatch(/Premiera/i);
  });

  it('uses the slug as the id, so a redesign around it does not re-announce everything', () => {
    expect(events.find((e) => e.title === 'SALOME')!.sourceKey).toBe('2026-2027/salome');
  });

  it('skips the education tiles, which are not repertoire', () => {
    /*
     * Two of the season page's blocks link outside /kalendarium/ — open rehearsals and guided
     * tours. They are things the house does rather than things it has programmed, and they used
     * to be kept under a key synthesised from the season page's own URL.
     */
    const titles = events.map((e) => e.title);
    expect(titles).not.toContain('WYCIECZKI PO TEATRZE');
    expect(titles).not.toContain('PRÓBY OTWARTE');
  });

  it('keys every event on the production slug, never on the page URL', () => {
    for (const event of events) {
      expect(event.sourceKey).toMatch(/^\d{4}-\d{4}\//);
      expect(event.sourceKey).not.toContain('http');
    }
  });

  it('tags operas so the keyword-less Opera Narodowa interest can match them', () => {
    // That interest has NO keywords — the tag is the entire reason it works.
    const salome = events.find((e) => e.title === 'SALOME')!;
    expect(salome.tags).toContain('opera');
  });

  it('sets the venue and city, which the page never states per production', () => {
    expect(events[0].venue).toBe('Teatr Wielki – Opera Narodowa');
    expect(events[0].city).toBe('Warszawa');
  });

  it('returns nothing rather than garbage for mangled markup', () => {
    // A redesign should produce an empty source (which the health table reports), never rows made
    // of navigation chrome.
    expect(parseSeasonPage('<div>completely different</div>')).toEqual([]);
    expect(parseSeasonPage('')).toEqual([]);
  });

  it('skips a block with no title or no link', () => {
    expect(parseSeasonPage('<li class="page"><div class="teaser"></div></li>')).toEqual([]);
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
});

describe('slugOf', () => {
  it('extracts the production slug', () => {
    expect(slugOf('https://teatrwielki.pl/kalendarium/2026-2027/salome/')).toBe('2026-2027/salome');
  });

  it('is null for a link that is not a production', () => {
    expect(slugOf('https://teatrwielki.pl/repertuar/')).toBeNull();
  });
});

describe('tagsFor', () => {
  it('separates ballet from opera so one can be excluded', () => {
    expect(tagsFor('BALET')).toContain('ballet');
    expect(tagsFor('BALET')).not.toContain('opera');
    expect(tagsFor('OPERA')).toContain('opera');
  });

  it('does not call a gala an opera', () => {
    // It used to fall through, which let the keyword-less Opera Narodowa interest claim the whole
    // season including the things that are not operas.
    expect(tagsFor('GALA BALETOWA')).not.toContain('opera');
    expect(tagsFor('KONCERT')).not.toContain('opera');
    // The house tag is still there for an interest that genuinely wants everything from here.
    expect(tagsFor('KONCERT')).toContain('teatr-wielki');
  });
});
