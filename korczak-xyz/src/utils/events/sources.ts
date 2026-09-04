/*
 * Which pages are read to produce this feed.
 *
 * The adapters that know *how* to read them live in `functions/src/sources/`; what is here is
 * *which*, and that had to move out of them. The Sources tab exists to answer "where does this
 * come from" from the app itself, and the browser cannot import a Cloud Function — so a catalogue
 * beside the adapters would have been a second copy of every URL, correct until the first time a
 * feed moved. This directory is the one place both runtimes compile, which is exactly what it was
 * made for: the collector fetches these URLs, the tab lists them, and there is one list.
 *
 * So the adapters import their targets from here rather than declaring them. `FEEDS` drives the
 * RSS adapter, `seasonPaths` the theatre scrape, `RUNNING_LISTINGS` the entry-platform one, and
 * `index.test.ts` in that directory checks the live sources and this catalogue still name the same
 * five things — a source added there and forgotten here would collect events the tab claims
 * nothing produces.
 *
 * Nothing user-facing lives here either, and that is the other half of the same rule: this file
 * compiles into a Cloud Function, which has no locale to render prose in. The sentence describing
 * each source is in `Events/translations.ts` under a key this file's ids index — so the catalogue
 * carries facts (a URL, a kind, the tags a page stamps) and the app carries words. It shipped the
 * other way round once, and the Polish page printed four English paragraphs.
 *
 * One rule this module must keep: **no secret ever appears in it.** It is compiled into the
 * browser bundle, so the Ticketmaster page below is the query without its `apikey`, which the
 * adapter appends at the point of the request. A URL is a page to show; a key is not.
 */

import type { SourceId } from './types';

/** How a source is read. Worth showing: a scrape is the fragile one, an API the least so. */
export type SourceKind = 'scrape' | 'ical' | 'rss' | 'api';

/**
 * One page the collector requests.
 *
 * `tags`, `city` and `country` are what this *page* stamps on everything it yields — facts about
 * the publication rather than about any one item, which is why they belong beside its URL and not
 * in a per-item guess. The RSS adapter reads them straight off these entries.
 */
export interface SourcePage {
  url: string;
  label: string;
  /**
   * True where a 404 is the ordinary case rather than a fault.
   *
   * Next season's page does not exist until the season is announced — and that announcement is the
   * very thing being watched for, so its absence is not a broken source and must not read as one.
   */
  optional?: boolean;
  tags?: string[];
  city?: string;
  country?: string;
}

export interface SourceCatalogueEntry {
  /** Matches `EventSource.id`, which is what joins a catalogue row to its `eventSources` health. */
  id: SourceId;
  label: string;
  kind: SourceKind;
  /** The secret this source does nothing without. Absent means it needs none. */
  needsKey?: string;
  /** `now` because the theatre's pages are a function of the season; the rest ignore it. */
  pages(now: number): SourcePage[];
}

/* --- teatrwielki.pl --------------------------------------------------------------------------- */

export const TEATR_WIELKI_HOST = 'https://teatrwielki.pl';

/**
 * Which season pages to read.
 *
 * Both the current and the next, because the whole point is catching the announcement — and a new
 * season page appearing *is* the announcement. The URL shape is `/repertuar/sezon-2026/27/`, which
 * is the theatre's own odd split of the year pair.
 */
export function seasonPaths(now: number): string[] {
  const year = new Date(now).getUTCFullYear();
  const month = new Date(now).getUTCMonth() + 1;
  // A season is announced in spring and runs to the following summer, so from about March the
  // interesting pair is this year's; before that, last year's is still current.
  const first = month >= 3 ? year : year - 1;
  return [first, first + 1].map(
    (start) =>
      `${TEATR_WIELKI_HOST}/repertuar/sezon-${start}/${String((start + 1) % 100).padStart(2, '0')}/`,
  );
}

/**
 * The theatre's own news page, and why a *scrape of articles* earns its place beside the season.
 *
 * The season page answers "what is programmed". It cannot answer the question that actually costs
 * money to get wrong: **when do the tickets go on sale**. A season's sale opens on one morning at
 * one hour, and by the time a ticket link appears on a production — which is all `onsale` can ever
 * observe — the good seats are gone.
 *
 * The theatre states it in advance, in prose, in its own news list: "Sprzedaż biletów od
 * 1 września, g. 11.00", published a fortnight or more ahead. That sentence is the whole reason
 * this page is fetched, and `parseNewsPage` reads it into `onSaleAt` so the `presale` notice can
 * count down to it.
 *
 * Not optional, unlike next season's page: a theatre always has current news, so an empty or
 * unreachable news list means the markup moved rather than that nothing is happening.
 */
export const TEATR_WIELKI_NEWS = `${TEATR_WIELKI_HOST}/teatr/aktualnosci/`;

/* --- python.org ------------------------------------------------------------------------------- */

/** The public Google Calendar behind python.org/events. */
export const PYTHON_ORG_ICAL =
  'https://www.google.com/calendar/ical/j7gov1cmnqr9tvg14k621j7t5c%40group.calendar.google.com/public/basic.ics';

/* --- elektronicznezapisy.pl -------------------------------------------------------------------- */

export const ELEKTRONICZNE_ZAPISY_HOST = 'https://elektronicznezapisy.pl';

/**
 * The running disciplines on the entry platform, which is where a race is a row.
 *
 * One page per discipline, because the platform has no "all running" view — its own navigation is
 * the taxonomy, and these four of its thirty-odd categories are the ones worth watching. The kids'
 * cups, the mountain runs and the relays are each a line away.
 *
 * **No `city`, unlike every other page in this file.** These listings are national and each row
 * says its own place, so the fact belongs to the row rather than to the page — see `splitPlace` in
 * the adapter. Fetching `?city_id=12` instead would have put one reader's Warsaw into a corpus
 * every account shares; `Interest.cities` and the feed's city picker are where that question lives.
 *
 * `running` is what these pages *are*, which is the only kind of tag a page may stamp feed-wide:
 * every row on them is a race. It is deliberately the whole tag list — a discipline tag per page
 * would read as a fact about the event when it is really a fact about which of the platform's
 * categories the organiser ticked, and a race entered in two of them would then carry whichever
 * page happened to be fetched first.
 */
export const RUNNING_LISTINGS: SourcePage[] = [
  '1/bieg.html',
  '48/bieg-przelajowy.html',
  '52/ultra.html',
  '64/bieg-z-przeszkodami.html',
].map((path) => {
  const url = `${ELEKTRONICZNE_ZAPISY_HOST}/${path}`;
  // The link's text is the URL, and here it can be: `elektronicznezapisy.pl/52/ultra.html` names
  // the discipline it lists, so there is nothing a friendlier label would add but something to
  // take on trust.
  return { url, label: displayUrl(url), tags: ['running'], country: 'PL' };
});

/* --- the watched feeds ------------------------------------------------------------------------ */

/**
 * The watched feeds, which are also the RSS adapter's whole configuration.
 *
 * Adding one is a line here: nothing else changes, `eventSources` reports it separately if it stops
 * working, and the Sources tab lists it without being told.
 */
export const FEEDS: SourcePage[] = [
  {
    url: 'https://historia.org.pl/feed/',
    label: 'historia.org.pl',
    /*
     * Their reenactment and tournament calendars are the best single source for castles and fairs —
     * but the feed is a general history magazine, so most items are articles about something else
     * entirely. `history` describes what the feed is; it is the interest's keywords that pick the
     * tournaments out, and only one item in seventy-seven matched on the last live run, which is
     * the ratio working as intended. Tagging it `festival` would have claimed every article was one.
     */
    tags: ['history'],
    country: 'PL',
  },
  {
    url: 'https://www.jewishfestival.pl/feed/',
    label: 'Festiwal Kultury Żydowskiej',
    /*
     * No `klezmer` tag, deliberately. Tags are matched all-of and structurally, but they used to be
     * folded into the keyword haystack too — and a feed-wide `klezmer` made the Klezmer interest
     * match all 67 articles this feed carried, Ted Kaczynski included. The haystack no longer reads
     * tags (see haystackOf), and the tag stays off anyway: what this feed IS is a festival's blog.
     */
    tags: ['music', 'festival'],
    city: 'Kraków',
    country: 'PL',
  },
  {
    url: 'https://maratonwarszawski.com/pl/feed/',
    label: 'Maraton Warszawski',
    /*
     * The other half of watching the running calendar, and the half a listing cannot be.
     *
     * `RUNNING_LISTINGS` knows a race once it has a date and an entry form. This is the foundation
     * that puts on the Maraton, the Półmaraton, Biegnij Warszawo and the Bieg Powstania — so the
     * route changing, next year's date being fixed and entries opening are all announced here
     * first, months before any of it is a row anywhere.
     *
     * `running` is honest as a feed-wide tag: this is a running organiser's own publication, the
     * way historia.org.pl is a history magazine. The cost is the one that tag always carries — a
     * keyword-less interest asking for `running` gets the sponsor posts too, and the seeded
     * `Running in Warszawa` is exactly such an interest. Ten items is what a WordPress feed holds,
     * so that is a card or two, not the sixty-seven the Jewish Culture Festival's feed once handed
     * the Klezmer interest; and it is the trade this feed is here to make, since an announcement
     * with no date yet is the thing worth knowing earliest.
     */
    tags: ['running'],
    city: 'Warszawa',
    country: 'PL',
  },
];

/* --- Ticketmaster ----------------------------------------------------------------------------- */

export const TICKETMASTER_ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
/** Read back onto every record as `country`, so it is the request's constraint and not a guess. */
export const TICKETMASTER_COUNTRY = 'PL';

/**
 * A URL as a page name.
 *
 * The link's text has to be the page, because "check it yourself" is the whole offer of the tab
 * that draws these — a friendly name would be one more thing to take on trust. But two of these
 * URLs are unreadable at full length (the python.org calendar is a 103-character Google Calendar
 * id) and would take three lines of a 320px panel to say nothing, so a long one collapses to its
 * host and its last segment. The `href` is always the whole thing.
 *
 * Language-neutral by construction, which is why it can live in this file at all.
 */
export function displayUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, '');
  if (bare.length <= 48) return bare;
  const [withoutQuery] = bare.split('?');
  const parts = withoutQuery.split('/').filter(Boolean);
  if (parts.length < 2) return parts[0] ?? bare;
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

/* --- the catalogue ---------------------------------------------------------------------------- */

export const SOURCE_CATALOGUE: SourceCatalogueEntry[] = [
  {
    id: 'teatr-wielki',
    label: 'Teatr Wielki – Opera Narodowa',
    kind: 'scrape',
    pages: (now) => [
      ...seasonPaths(now).map((url, index) => ({
        url,
        label: displayUrl(url),
        // The first is the running season and must be there; the second is next season's, which
        // 404s until it is announced.
        optional: index > 0,
        tags: ['theatre', 'teatr-wielki'],
        city: 'Warszawa',
        country: 'PL',
      })),
      {
        url: TEATR_WIELKI_NEWS,
        label: displayUrl(TEATR_WIELKI_NEWS),
        /*
         * `ticket-sale` is deliberately NOT here, though it is the tag this page exists to
         * produce. A page may only stamp feed-wide what every row on it *is*, and most of these
         * rows are a job advert or a parking notice; the tag is applied per row, by the adapter,
         * and only where a sale date was actually read out of the prose. Stamping it here would
         * hand the keyword-less "Ticket sales opening" interest the theatre's entire press
         * office — which is the mistake this app has now made from three directions.
         */
        tags: ['theatre', 'teatr-wielki', 'newsroom'],
        city: 'Warszawa',
        country: 'PL',
      },
    ],
  },
  {
    id: 'python-org',
    label: 'python.org events',
    kind: 'ical',
    pages: () => [
      { url: PYTHON_ORG_ICAL, label: displayUrl(PYTHON_ORG_ICAL), tags: ['tech', 'python'] },
    ],
  },
  {
    id: 'elektroniczne-zapisy',
    label: 'Elektroniczne Zapisy – biegi',
    kind: 'scrape',
    pages: () => RUNNING_LISTINGS,
  },
  {
    id: 'feed',
    label: 'Watched feeds',
    kind: 'rss',
    pages: () => FEEDS,
  },
  {
    id: 'ticketmaster',
    label: 'Ticketmaster (PL)',
    kind: 'api',
    needsKey: 'TICKETMASTER_API_KEY',
    pages: () => [
      {
        url: `${TICKETMASTER_ENDPOINT}?countryCode=${TICKETMASTER_COUNTRY}&sort=date,asc`,
        label: displayUrl(`${TICKETMASTER_ENDPOINT}?countryCode=${TICKETMASTER_COUNTRY}`),
        tags: ['ticketed'],
        country: TICKETMASTER_COUNTRY,
      },
    ],
  },
];

/** The catalogue row for a source id, or undefined for one nothing here describes. */
export function catalogueEntry(id: string): SourceCatalogueEntry | undefined {
  return SOURCE_CATALOGUE.find((entry) => entry.id === id);
}
