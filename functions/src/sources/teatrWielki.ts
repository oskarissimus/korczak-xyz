/*
 * Teatr Wielki – Opera Narodowa, from the theatre's own news list.
 *
 * One page and the two behind it — `/teatr/aktualnosci/` and its archive — and one question asked
 * of them: **when do the tickets go on sale.** A season's sale opens on one morning at one hour
 * and the house is half sold by lunchtime, so that sentence, published a fortnight or more ahead
 * in prose in the theatre's own news, is the only thing this house publishes with a deadline
 * attached.
 *
 * The archive is read because the front page holds ten articles and that is about two months:
 * the 2026/27 sale date was announced in April and this scrape first ran in September, so the one
 * announcement it exists for had been off the front page for four months before anybody looked.
 * `TEATR_WIELKI_NEWS_PAGES` in the catalogue has the reasoning and the depth.
 *
 * ### It used to scrape the season repertoire too, and does not
 *
 * `/repertuar/sezon-2026/27/` is plain server-rendered markup carrying a title, a genre, a
 * composer and a premiere date per production, and this adapter read all of it into sixty-odd
 * rows a season. What none of it could answer is the question above: a production's page grows a
 * ticket link on the morning the sale opens, which is news that arrives too late to act on. The
 * repertoire was answering "is Figaro programmed" — worth knowing, never urgent, and knowable
 * from the theatre's own site in ten seconds whenever the question comes up.
 *
 * So the season pages are gone, along with the sixty-odd rows a season they minted, and what is
 * left is the page with the deadline on it. Two consequences worth knowing before reviving them:
 * nothing here stamps `opera` or `ballet` any more (`tagsFor` read the genre line off a season
 * teaser, and there is no genre line on a news item), and the corpus no longer carries a single
 * Teatr Wielki *performance* — every row from this source is an article.
 *
 * ### The news list
 *
 * `parseSaleAnnouncement` reads "Sprzedaż biletów od 1 września, g. 11.00" into `onSaleAt` so the
 * `presale` notice can count down to it, and `readNewsroom.ts` reads the article body behind each
 * row for the sale dates that sentence is phrased too loosely to catch. A **committed HTML
 * fixture** is what turns the inevitable redesign into a red build rather than a silently empty
 * feed — which for this source now means no warning before a season sale, since there is no
 * second page left to look healthy in its place.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { parseSaleAnnouncement, stripTags, warsawEpoch } from './html';
import {
  NEWSROOM_TAG,
  TICKET_SALE_TAG,
} from '../../../korczak-xyz/src/utils/events/newsroom';
import {
  TEATR_WIELKI_HOST as HOST,
  teatrWielkiNewsPages,
} from '../../../korczak-xyz/src/utils/events/sources';

/** One `<li>` of `<ul id="content" class="white-list cal-list">`. */
const NEWS_ROW = /<li>\s*<time class="date"([\s\S]*?)<\/li>/g;

/**
 * The news list, as events.
 *
 * Every row, not only the ones announcing a sale — and that is worth defending, because most of
 * these are a job advert or a parking notice. Two reasons:
 *
 *   - **A source that returns rows can be seen to be working.** `eventSources` reads zero as a
 *     failure only where there used to be something; kept to sale rows alone, this page would
 *     legitimately yield nothing for months, and the run where the wording changed and the parse
 *     silently died would look exactly the same. Ten articles a run is a health signal that stays
 *     honest.
 *   - **Nothing here reaches an interest by accident.** The page stamps `theatre` and
 *     `teatr-wielki`, which no seeded interest asks for, and `ticket-sale` — the tag the seeded
 *     "Ticket sales opening" interest is built on — is added per row and only where a date was
 *     actually read out of the prose. A parking notice carries no deadline and matches nothing.
 *
 * `startsAt` is null on every row, sale or not. A news item is an article and an article has no
 * date of its own; the RSS adapter refuses to put a `pubDate` there for the same reason, and doing
 * it here would file the announcement as happening today and let `soon` fire about it. The sale
 * moment goes in `onSaleAt`, which is the field for exactly that and which the feed already ranks
 * a dateless row by.
 */
export function parseNewsPage(html: string): RawEvent[] {
  const out: RawEvent[] = [];

  for (const match of html.matchAll(NEWS_ROW)) {
    const block = match[1];

    const href = /<a[^>]+href="([^"]+)"/.exec(block)?.[1];
    const title = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? '');
    if (!href || !title) continue;

    const slug = newsSlugOf(href);
    if (!slug) continue;

    // `datetime` is machine-readable and already ISO, so the publication day needs no parsing —
    // which matters, because it is what resolves the year the sale sentence leaves out, and
    // because it is the one thing on the row that says how old the news is.
    const publishedDay = /datetime="(\d{4}-\d{2}-\d{2})"/.exec(block)?.[1] ?? null;
    const publishedAt = publishedDay ? warsawEpoch(publishedDay, 0) : null;

    // The teaser, with the category chip ("Aktualności |") stripped off the front.
    const teaser = stripTags(/<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '')
      .replace(/^[^|]*\|\s*/, '')
      .trim();

    // The title can carry it as readily as the teaser ("Sprzedaż biletów na sezon 2027/28").
    const sale = parseSaleAnnouncement(`${title} ${teaser}`, publishedDay);
    const onSaleAt = sale ? warsawEpoch(sale.day, sale.hour) : null;

    out.push({
      sourceKey: `aktualnosci/${slug}`,
      title,
      subtitle: teaser || undefined,
      url: href.startsWith('http') ? href : `${HOST}${href}`,
      startsAt: null,
      /*
       * The day the theatre published it — kept, where before it was read for the sale's missing
       * year and then dropped on the floor.
       *
       * A news list holds ten items and the collector meets them all in one run, so `firstSeenAt`
       * says only when this app arrived. A piece written in July and first seen in September was
       * shown as `Announced 2 d ago`, which is the collector's history stated as though it were
       * the theatre's, and it is why a two-month-old festival read as tonight's news.
       *
       * Still not `startsAt`. An article is not an event happening on the day it was written.
       */
      ...(publishedAt !== null ? { publishedAt } : {}),
      // The theatre's own sentence, so a card is never dateless-and-mute and so a wrong parse can
      // be argued with against what was actually written.
      dateText: sale ? teaser || title : undefined,
      city: 'Warszawa',
      country: 'PL',
      venue: 'Teatr Wielki – Opera Narodowa',
      /*
       * `ticket-sale` per row, never page-wide. It is the one tag that says "this row carries a
       * deadline", the keyword-less seeded interest matches on it alone, and a keyword-less
       * interest has no second filter — so stamping it on the whole page would hand that interest
       * the theatre's job adverts. Same mistake, fourth direction; see the rules file.
       */
      /*
       * `newsroom` is what every row on this page **is** — an article rather than an event —
       * which is the only sort of tag a page may stamp feed-wide. It is a marker for the
       * collector rather than a subject: it is the newsroom reader's entire queue, so
       * pointing that reader at another source's article feed is a line there and nothing here.
       *
       * `ticket-sale` is the opposite kind of tag and is added per row, only where the regex
       * actually read a date out of the prose. It is the whole of the keyword-less "Ticket sales
       * opening" seed, and a keyword-less interest has no second filter — page-wide it would hand
       * that interest the theatre's job adverts. The reader may add it to a row this missed;
       * `tagsWithTicketSale` is where that union is made, once.
       */
      tags:
        onSaleAt !== null
          ? ['theatre', 'teatr-wielki', NEWSROOM_TAG, TICKET_SALE_TAG]
          : ['theatre', 'teatr-wielki', NEWSROOM_TAG],
      ...(onSaleAt !== null ? { onSaleAt } : {}),
      description: teaser,
    });
  }

  return out;
}

/** `/teatr/aktualnosci/aktualnosc/edukacja-w-nowym-sezonie/` -> `edukacja-w-nowym-sezonie`. */
export function newsSlugOf(href: string): string | null {
  const match = /\/aktualnosci\/aktualnosc\/([^?#]+)/.exec(href);
  if (!match) return null;
  return match[1].replace(/^\/+|\/+$/g, '') || null;
}

export const teatrWielki: EventSource = {
  id: 'teatr-wielki',
  label: 'Teatr Wielki – Opera Narodowa',
  /**
   * The front page and the archive behind it.
   *
   * **The front page's failure is the source's failure**, and it is not swallowed. It was, while
   * the season pages were the sturdy half of this scrape — losing an opera season from the feed
   * because a news template moved would have been the fragile half taking the sturdy half down
   * with it. There is no other half now: an unreachable news list means this source has nothing
   * to say, and `eventSources` health exists to make exactly that visible.
   *
   * **An archive page's failure is not.** `p/3/` stops existing the day the theatre has fewer
   * than thirty articles to show, and a source that went red over that would be crying wolf about
   * its own depth. What it costs is the thing worth naming: a `p/2/` that silently 404s leaves
   * this looking healthy on ten rows, which is the state this pagination exists to get out of. It
   * is visible in the count — thirty rows against ten — rather than in a health flag, which is
   * the same signal `ReadOutcome.fetched` carries for the reader.
   *
   * Rows are returned in page order, newest first, because that is the order the pages are in and
   * `upsert.ts` derives everything else. A duplicate across two pages — an article that shifts
   * while the run is in flight — is deduped by id in `collect.ts`, which is where that already
   * happens for a feed that republishes.
   */
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const [front, ...archive] = teatrWielkiNewsPages();
    const out = parseNewsPage(await fetchText(ctx, front));

    for (const url of archive) {
      try {
        out.push(...parseNewsPage(await fetchText(ctx, url)));
      } catch {
        // The archive ran out, or one page of it is having a bad day. Neither is this source
        // failing: the front page is what says whether the scrape still understands this site.
        continue;
      }
    }

    return out;
  },
};
