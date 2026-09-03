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
