import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newsSlugOf, parseNewsPage, teatrWielki } from './teatrWielki';

/*
 * The news list, which is where the theatre says when the tickets go on sale.
 *
 * A committed fixture of the real page, and the only one this adapter has left — the season
 * repertoire scrape and its fixture are gone. teatrwielki.pl will be redesigned, and when it is
 * this test is what turns a silently empty feed into a red build; with the season pages gone
 * there is no second page to look healthy in its place, so it is also the only thing standing
 * between a redesign and a season sale nobody is warned about.
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

  it('marks every row a newsroom item, which is the reader’s whole queue', () => {
    /*
     * Page-wide, unlike `ticket-sale`, and legitimately so: every row here IS an article rather
     * than an event, which is the only sort of fact a page may stamp on everything it yields. It
     * is a marker for the collector rather than a subject — no interest asks for it.
     */
    expect(news.every((e) => e.tags!.includes('newsroom'))).toBe(true);
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

  it('keeps the day the theatre published each item', () => {
    /*
     * The row's `<time datetime>`, which was read for the sale's missing year and then dropped.
     * Without it the feed can only say when the *collector* first saw a piece — so an article from
     * July, met in September, was captioned `Announced 2 d ago` and read as the freshest thing on
     * the screen. Midnight Warsaw on 31 August 2026 is 22:00 UTC on the 30th, summer time.
     */
    const sale = news.find((e) => e.title === 'Edukacja w nowym sezonie')!;
    expect(new Date(sale.publishedAt!).toISOString()).toBe('2026-08-30T22:00:00.000Z');
    expect(news.every((e) => typeof e.publishedAt === 'number')).toBe(true);
  });

  it('does not let the publication date become the event date', () => {
    // The rule the RSS adapter is built on, now with a second date on the row to get wrong: an
    // article is not an event happening on the day it was written.
    const sale = news.find((e) => e.title === 'Edukacja w nowym sezonie')!;
    expect(sale.startsAt).toBeNull();
    expect(sale.publishedAt).not.toBe(sale.onSaleAt);
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

/*
 * The archive behind the front page.
 *
 * Ten articles is about two months, and this scrape started four months after the announcement it
 * exists for — so reading only the front page could never have found the 2026/27 sale date, whole
 * and correctly parsed on page three. The failure contract is the interesting half: the front
 * page must be there, the archive need not be.
 */
describe('fetchEvents', () => {
  const ctxWith = (pages: Record<string, string | null>) => ({
    now: Date.parse('2026-09-09T06:00:00Z'),
    secret: () => undefined,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = pages[url];
      if (body === undefined || body === null) return new Response('nope', { status: 404 });
      return new Response(body, { status: 200 });
    }) as typeof globalThis.fetch,
  });

  const FRONT = 'https://teatrwielki.pl/teatr/aktualnosci/';
  const SECOND = 'https://teatrwielki.pl/teatr/aktualnosci/p/2/';

  it('reads the archive as well as the front page', async () => {
    // The same fixture served twice would dedupe by id downstream, so page two is one row with a
    // slug of its own — enough to show both pages reached the parser.
    const older = newsHtml.replace(/aktualnosci\/aktualnosc\//g, 'aktualnosci/aktualnosc/older-');
    const events = await teatrWielki.fetchEvents(ctxWith({ [FRONT]: newsHtml, [SECOND]: older }));
    expect(events.length).toBe(news.length * 2);
    expect(events.some((e) => e.sourceKey?.startsWith('aktualnosci/older-'))).toBe(true);
  });

  it('forgives an archive page that is not there', async () => {
    // `p/3/` stops existing the day the theatre has fewer than thirty articles to show. A source
    // that went red over its own depth would be crying wolf.
    const events = await teatrWielki.fetchEvents(ctxWith({ [FRONT]: newsHtml }));
    expect(events.length).toBe(news.length);
  });

  it('fails the source when the front page is gone', async () => {
    // That one is the markup having moved, which is the failure `eventSources` health exists to
    // show — and with the season pages gone there is nothing else to look healthy in its place.
    await expect(teatrWielki.fetchEvents(ctxWith({}))).rejects.toThrow();
  });
});
