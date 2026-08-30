/*
 * A generic RSS/Atom adapter, driven by a list of URLs.
 *
 * This is what makes the fuzzy categories tractable. There is no aggregator API for medieval fairs
 * or klezmer festivals in Poland — but the people who run them publish, and most of what they
 * publish is WordPress, which means a feed. So instead of one bespoke scraper per interest, there is
 * one adapter and a list: adding "watch this festival's blog" later is a line in `FEEDS`, not code.
 *
 * That list lives in `src/utils/events/sources.ts` rather than here, so the Sources tab can name
 * the feeds without importing a Cloud Function — see the header there. It carries each feed's
 * tags, city and country, which are facts about the publication rather than about any one item.
 *
 * The trade is that a feed item is an *article*, not an event: there is a publication date but
 * usually no event date. That is handled honestly rather than guessed at — `startsAt` stays null,
 * the item shows in the feed's "announced, no dates yet" group, and it can still fire an
 * `announced` notification, which for "the 2027 tournament calendar is out" is the right outcome.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import { fetchText } from './types';
import { decodeEntities, stripTags } from './html';
import { FEEDS, type SourcePage } from '../../../korczak-xyz/src/utils/events/sources';

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

export function parseFeed(xml: string, feed: SourcePage): RawEvent[] {
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
      country: feed.country,
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
