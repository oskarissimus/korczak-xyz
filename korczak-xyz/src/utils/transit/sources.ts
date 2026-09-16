/*
 * The two pages the collector reads.
 *
 * Here rather than beside the adapter for the reason the events app's `sources.ts` gives: the
 * Raw tab lists what is fetched, the browser cannot import a Cloud Function, and a catalogue kept
 * next to the fetcher would be a second copy of every URL — correct until the first time one moved.
 *
 * Facts only, no prose: this file compiles into a Cloud Function, which has no locale. The sentence
 * describing each feed lives in `Transit/translations.ts`.
 */

import type { FeedKind } from './types';

export const WTP_HOST = 'https://www.wtp.waw.pl';

/**
 * WTP's two RSS feeds.
 *
 * They are WordPress post-type feeds — `?post_type=impediment` and `?post_type=change` — which is
 * not a documented API and is the only machine-readable form the operator publishes. There is no
 * versioned endpoint to prefer, so the risk is taken knowingly and `FeedFetch` is what makes it
 * visible the day the query parameter stops being understood.
 */
export const WTP_FEEDS: ReadonlyArray<{ feed: FeedKind; url: string; path: string }> = [
  {
    feed: 'impediment',
    url: `${WTP_HOST}/feed/?post_type=impediment`,
    // Where the items land, so a card's link can be recognised as belonging to this feed.
    path: '/utrudnienia/',
  },
  {
    feed: 'change',
    url: `${WTP_HOST}/feed/?post_type=change`,
    path: '/zmiany/',
  },
];

/**
 * The community mirror that carries what WTP's own feeds leave out.
 *
 * Both RSS feeds publish the article's headline as their whole body, so the prose naming stations is
 * only on the web page — and the page is behind an AWS WAF that challenges this collector (see
 * `article.ts`). `WarsawGTFS` scrapes those same two pages into a GTFS-Realtime alerts feed and
 * publishes a JSON rendering of it beside the protobuf, under CC0: one row per communiqué, keyed by
 * **WTP's own post id**, carrying the full plain-text body.
 *
 * So this is the same operator's words reaching us by a route that will answer, and the join is
 * exact rather than fuzzy — `A/CHANGE/176745` is the post id already in our guid.
 *
 * **It is one volunteer's server**, which is the thing to know before depending on it. That is why
 * it is a *first* door rather than the only one: the two direct routes are still tried behind it,
 * and everything failing leaves an item unread and escalated exactly as before. If this host goes
 * away the app is as blind as it was on 13 Sep 2026, and no worse.
 *
 * https://github.com/MKuranowski/WarsawGTFS — the generator, and what to read if the shape moves.
 */
export const WTP_ALERTS_URL = 'https://mkuran.pl/gtfs/warsaw/alerts.json';

export function feedUrl(feed: FeedKind): string {
  return WTP_FEEDS.find((entry) => entry.feed === feed)!.url;
}

/**
 * How often each feed is re-read, in minutes. Shown on the Raw tab, and the collector's own schedule
 * is derived from the shorter of the two.
 *
 * An impediment is happening now, so five minutes late is most of its value gone; a planned change
 * is announced days ahead and re-reading it every five minutes buys nothing but requests. WTP's own
 * community bot settled on the same pair, which is the closest thing to a documented rate this feed
 * has.
 */
export const REFRESH_MINUTES: Record<FeedKind, number> = {
  impediment: 10,
  change: 120,
};
