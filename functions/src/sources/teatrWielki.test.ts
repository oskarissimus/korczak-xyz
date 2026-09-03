import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newsSlugOf, parseNewsPage, parseSeasonPage, slugOf, tagsFor } from './teatrWielki';

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

/*
 * The news list, which is where the theatre says when the tickets go on sale.
 *
 * A second committed fixture, for the same reason as the first: this scrape is the only thing that
 * can warn *before* a season sale opens, and the way it fails is silently.
 */
const newsHtml = readFileSync(new URL('./fixtures/teatr-wielki-news.html', import.meta.url), 'utf8');
const news = parseNewsPage(newsHtml);

describe('parseNewsPage', () => {
  it('reads the news list', () => {
    expect(news.length).toBeGreaterThanOrEqual(8);
  });

  it('reads the sale date out of the theatre’s own sentence', () => {
    /*
     * "Sprzedaż biletów od 1 września, g. 11.00", published 31 August 2026 — and note there is no
     * year in it. 11:00 Warsaw on 1 September is 09:00 UTC, summer time.
     */
    const sale = news.find((e) => e.title === 'Edukacja w nowym sezonie');
    expect(sale).toBeDefined();
    expect(new Date(sale!.onSaleAt!).toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });

  it('tags exactly the rows that carry a deadline', () => {
    /*
     * `ticket-sale` is what the keyword-less "Ticket sales opening" interest matches on, and a
     * keyword-less interest has no second filter — so this tag reaching a row without a sale date
     * hands that interest the theatre's press office. The four earlier versions of this mistake
     * are written up in .claude/rules/events.md.
     */
    for (const item of news) {
      expect(item.tags).toContain('teatr-wielki');
      expect(item.tags!.includes('ticket-sale')).toBe(item.onSaleAt !== undefined);
    }
    expect(news.filter((e) => e.tags!.includes('ticket-sale'))).toHaveLength(1);
  });

  it('does not read a date after “od” that is about something else', () => {
    /*
     * The same page carries "Od 12 czerwca 2026 roku nasi Widzowie mogą korzystać z 30% zniżki na
     * parking podziemny". A reader that took any date after "od" would file a car park discount as
     * a ticket sale and put a notification on the calendar for it.
     */
    const parking = news.find((e) => /Parking/i.test(e.title));
    expect(parking).toBeDefined();
    expect(parking!.onSaleAt).toBeUndefined();
  });

  it('leaves startsAt null on every row, an article having no date of its own', () => {
    // The rule the RSS adapter is built on. Put the publication date here and every announcement
    // is filed as happening today, and `soon` fires about it.
    expect(news.every((e) => e.startsAt === null)).toBe(true);
  });

  it('keys on the article slug, so the theatre’s own id survives a redesign', () => {
    const sale = news.find((e) => e.title === 'Edukacja w nowym sezonie')!;
    expect(sale.sourceKey).toBe('aktualnosci/edukacja-w-nowym-sezonie');
  });

  it('keeps the sentence it read the date from, so a wrong parse can be argued with', () => {
    const sale = news.find((e) => e.title === 'Edukacja w nowym sezonie')!;
    expect(sale.dateText).toMatch(/Sprzedaż biletów od 1 września/);
    // And the category chip is not part of it.
    expect(sale.dateText).not.toMatch(/Aktualności \|/);
  });

  it('places every row at the theatre, which the rows never say themselves', () => {
    expect(news[0].city).toBe('Warszawa');
    expect(news[0].country).toBe('PL');
  });

  it('returns nothing rather than garbage for mangled markup', () => {
    expect(parseNewsPage('<div>completely different</div>')).toEqual([]);
    expect(parseNewsPage('')).toEqual([]);
  });
});

describe('newsSlugOf', () => {
  it('reads the article slug and refuses anything else', () => {
    expect(newsSlugOf('/teatr/aktualnosci/aktualnosc/ufo-znowu-w-trasie/')).toBe(
      'ufo-znowu-w-trasie',
    );
    // The listing's own link, and the category filters, are not articles.
    expect(newsSlugOf('/teatr/aktualnosci/')).toBeNull();
    expect(newsSlugOf('/teatr/aktualnosci/c/109/')).toBeNull();
  });
});
