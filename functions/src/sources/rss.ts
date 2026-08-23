/*
 * A generic RSS/Atom adapter, driven by a list of URLs.
 *
 * This is what makes the fuzzy categories tractable. There is no aggregator API for medieval fairs
 * or klezmer festivals in Poland — but the people who run them publish, and most of what they
 * publish is WordPress, which means a feed. So instead of one bespoke scraper per interest, there is
 * one adapter and a list: adding "watch this festival's blog" later is a line in FEEDS, not code.
 *
 * The trade is that a feed item is an *article*, not an event: there is a publication date but
 * usually no event date. That is handled honestly rather than guessed at — `startsAt` stays null,
 * the item shows in the feed's "announced, no dates yet" group, and it can still fire an
 * `announced` notification, which for "the 2027 tournament calendar is out" is the right outcome.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { decodeEntities, stripTags } from './html';

interface Feed {
  url: string;
  label: string;
  /** Applied to everything from this feed, so an interest can narrow by them. */
  tags: string[];
  city?: string;
}

/**
 * The watched feeds.
 *
 * Both were checked to be live and returning `application/rss+xml`. Adding one is a line here;
 * nothing else changes, and `eventSources` will report it separately if it stops working.
 */
export const FEEDS: Feed[] = [
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
  },
];

const ITEM = /<(item|entry)[\s>]([\s\S]*?)<\/\1>/g;

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!match) return undefined;
  // CDATA is how most feeds carry a title with an ampersand in it.
  const inner = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(inner).trim() || undefined;
}

/** Atom puts the link in an attribute; RSS puts it in the element. */
function linkOf(xml: string): string | undefined {
  const atom = /<link[^>]+href="([^"]+)"/i.exec(xml)?.[1];
  if (atom) return atom;
  return tag(xml, 'link');
}

export function parseFeed(xml: string, feed: Feed): RawEvent[] {
  const out: RawEvent[] = [];
  for (const match of xml.matchAll(ITEM)) {
    const item = match[2];
    const title = tag(item, 'title');
    const link = linkOf(item) ?? tag(item, 'guid');
    if (!title || !link) continue;

    const summary = tag(item, 'description') ?? tag(item, 'summary') ?? tag(item, 'content');

    out.push({
      // The permalink is the identity. A guid would do, but plenty of feeds emit a guid that is
      // just the link, and one of the two is always present.
      sourceKey: link,
      title,
      url: link,
      /*
       * Null on purpose. A feed item's pubDate is when the article was written, not when the
       * tournament is — and putting the publication date in `startsAt` would file every article as
       * an event happening today, then let `soon` fire about it. Honest nulls group under
       * "announced, no dates yet", which is what these actually are.
       */
      startsAt: null,
      city: feed.city,
      tags: feed.tags,
      description: summary ? stripTags(summary).slice(0, 600) : undefined,
    });
  }
  return out;
}

export const rssFeeds: EventSource = {
  id: 'feed',
  label: 'Watched feeds',
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    let reached = 0;
    const failures: string[] = [];

    for (const feed of FEEDS) {
      try {
        out.push(...parseFeed(await fetchText(ctx, feed.url), feed));
        reached += 1;
      } catch (e) {
        failures.push(`${feed.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // One dead blog should not report the whole source as broken while the other still works; all
    // of them dead is a real failure worth a red row on the alerts tab.
    if (reached === 0) throw new Error(failures.join('; ') || 'no feeds configured');
    return out;
  },
};
