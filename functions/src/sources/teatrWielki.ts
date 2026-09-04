/*
 * Teatr Wielki – Opera Narodowa, from the season repertoire pages.
 *
 * This is the source the app was really asked for: "tell me when new repertoire is announced", with
 * a season of lead time on a Figaro or a Salome.
 *
 * The obvious page, `/kalendarium/`, is useless to us — it is a TYPO3 shell whose calendar is drawn
 * by JavaScript, so the HTML contains `data-day` attributes and no events at all. The *season* page
 * is plain server-rendered markup and carries more than the calendar would anyway:
 *
 *     <a href="https://teatrwielki.pl/kalendarium/2026-2027/salome/" class="-layer">
 *       <div class="teaser">
 *         <h2>SALOME</h2>
 *         <p>OPERA</p>
 *         <p>Richard Strauss</p>
 *         <p><strong>Premiera: 22 listopada 2026</strong></p>
 *
 * — a title, a genre, a composer, a premiere date, and a slug that makes a stable id. Note
 * `<h2>COPP<span>É</span>LIA</h2>`: the titles contain inner tags, so they must be stripped rather
 * than read raw.
 *
 * What this cannot give us is individual performance nights; those live behind the JS calendar. That
 * is an acceptable gap — the question is "is Figaro programmed this season", not "which Tuesday".
 *
 * The season page cannot answer the *other* question either, and that one has a deadline: **when
 * the tickets go on sale.** A season's sale opens on one morning at one hour and the house is half
 * sold by lunchtime, so noticing a ticket link has appeared — which is all `onsale` can ever do —
 * is noticing too late. The theatre says it in advance, in prose, in its own news list, so
 * `parseNewsPage` reads that sentence into `onSaleAt` and the `presale` notice counts down to it.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { parsePolishDate, parseSaleAnnouncement, stripTags, warsawEpoch } from './html';
import { NEWSROOM_TAG } from '../../../korczak-xyz/src/utils/events/newsroom';
import {
  TEATR_WIELKI_HOST as HOST,
  TEATR_WIELKI_NEWS,
  seasonPaths,
} from '../../../korczak-xyz/src/utils/events/sources';

/** One `<li class="page">…</li>` block per production. */
const BLOCK = /<li class="page">([\s\S]*?)<\/li>/g;

/**
 * Pulls the productions out of one season page.
 *
 * Exported and pure so `teatrWielki.test.ts` can run it against a committed fixture. When the
 * theatre redesigns — and it will — that test is what turns a silent empty feed into a red build.
 */
export function parseSeasonPage(html: string): RawEvent[] {
  const out: RawEvent[] = [];

  for (const match of html.matchAll(BLOCK)) {
    const block = match[1];

    const href = /<a[^>]+href="([^"]+)"/.exec(block)?.[1];
    // Inner tags: COPP<span>É</span>LIA.
    const title = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? '');
    if (!href || !title) continue;

    /*
     * A production, and not one of the education tiles the season page also carries.
     *
     * Two of the sixty-four blocks link outside /kalendarium/ — "PRÓBY OTWARTE" (open rehearsals)
     * and "WYCIECZKI PO TEATRZE" (guided tours). They are things the house does, not things it has
     * programmed, and they were previously kept with a key synthesised from the season page's own
     * URL: `teatr-wielki_https-teatrwielki-pl-repertuar-sezon-2026-27-WYCIECZKI-PO-TEATRZE`. That
     * is stable enough not to re-announce, and still wrong — the slug is the theatre's own
     * identifier for a production, so its absence is the signal that this is not one.
     */
    const slug = slugOf(href);
    if (!slug) continue;

    const paragraphs = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((p) => stripTags(p[1]))
      .filter(Boolean);

    // The teaser's paragraphs are, in order: genre, composer/creators, and the premiere line.
    const premiereLine = paragraphs.find((p) => /premiera/i.test(p));
    const rest = paragraphs.filter((p) => p !== premiereLine);
    const genre = rest[0];
    const composer = rest.slice(1).join(' · ') || undefined;

    const day = premiereLine ? parsePolishDate(premiereLine) : null;

    out.push({
      // The slug is the id. It survives a redesign of everything around it, and it is what the
      // theatre itself uses to identify the production.
      sourceKey: slug,
      title,
      subtitle: composer,
      url: href.startsWith('http') ? href : `${HOST}${href}`,
      startsAt: day ? warsawEpoch(day, 19) : null,
      // Kept whatever happens: "Premiera: jesień 2027" is genuinely what the theatre said, and a
      // card with no date at all reads as a bug.
      dateText: premiereLine,
      city: 'Warszawa',
      country: 'PL',
      venue: 'Teatr Wielki – Opera Narodowa',
      tags: tagsFor(genre),
      description: [genre, composer].filter(Boolean).join(' '),
    });
  }

  return out;
}

/** `https://teatrwielki.pl/kalendarium/2026-2027/salome/` -> `2026-2027/salome`. */
export function slugOf(href: string): string | null {
  const match = /\/kalendarium\/([^?#]+)/.exec(href);
  if (!match) return null;
  return match[1].replace(/^\/+|\/+$/g, '') || null;
}

/**
 * The genre line as tags.
 *
 * `opera` is what the seeded Opera Narodowa interest matches on — it has no keywords at all, so
 * this tag is the entire reason that interest works. Ballet gets its own so it can be excluded.
 */
export function tagsFor(genre: string | undefined): string[] {
  const tags = ['theatre', 'teatr-wielki'];
  const value = (genre ?? '').toLowerCase();
  if (value.includes('balet') || value.includes('ballet')) tags.push('ballet');
  else if (value.includes('opera')) tags.push('opera');
  // Anything else — a gala, a recital, a concert — gets neither. It used to fall through to
  // `opera`, which meant the keyword-less Opera Narodowa interest claimed the entire season
  // including the things that are not operas. `teatr-wielki` still marks the house, so an
  // interest that genuinely wants everything from here can ask for that tag instead.
  return tags;
}

/* --- the news list, which is where a sale date is stated in advance ---------------------------- */

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
    // which matters, because it is what resolves the year the sale sentence leaves out.
    const publishedDay = /datetime="(\d{4}-\d{2}-\d{2})"/.exec(block)?.[1] ?? null;

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
       * `tagsWithNewsroomKind` is where that union is made, once.
       */
      tags:
        onSaleAt !== null
          ? ['theatre', 'teatr-wielki', NEWSROOM_TAG, 'ticket-sale']
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
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const paths = seasonPaths(ctx.now);
    let reached = 0;

    for (const url of paths) {
      let html: string;
      try {
        html = await fetchText(ctx, url);
      } catch {
        // A season page that does not exist yet is the normal case for half the year, not a
        // failure — next season's URL 404s until it is announced, and that announcement is the
        // very thing being watched for.
        continue;
      }
      reached += 1;
      out.push(...parseSeasonPage(html));
    }

    /*
     * The news list, and it is fetched even when both season pages failed.
     *
     * A theatre always has current news, so unlike next season's page a 404 here is a fault rather
     * than the ordinary state of half the year. But it is caught all the same and does not fail
     * the source on its own: the season pages are what the app was built for, and losing an opera
     * season from the feed because a news template moved would be the fragile half taking the
     * sturdy half down with it.
     */
    try {
      out.push(...parseNewsPage(await fetchText(ctx, TEATR_WIELKI_NEWS)));
      reached += 1;
    } catch {
      // Recorded only by its absence from the count below.
    }

    // Every page unreachable is different from "the current season has nothing on", and only the
    // first is worth recording as a broken source.
    if (reached === 0) {
      throw new Error(`no page reachable (${[...paths, TEATR_WIELKI_NEWS].join(', ')})`);
    }
    return out;
  },
};
