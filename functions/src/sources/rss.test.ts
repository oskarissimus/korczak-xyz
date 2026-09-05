import { describe, expect, it } from 'vitest';
import { parseFeed } from './rss';

const feed = { url: 'https://x.test/feed/', label: 'X', tags: ['history', 'festival'] };

describe('parseFeed', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Turnieje rycerskie w Polsce 2027 — kalendarz]]></title>
      <link>https://historia.org.pl/2027/01/27/turnieje/</link>
      <description><![CDATA[<p>Zestawienie <b>imprez</b> historycznych.</p>]]></description>
      <pubDate>Mon, 27 Jan 2027 08:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Jarmark &amp; Turniej</title>
      <guid>https://historia.org.pl/2027/02/01/jarmark/</guid>
    </item>
  </channel></rss>`;

  it('reads CDATA titles and links', () => {
    const [first] = parseFeed(rss, feed);
    expect(first.title).toBe('Turnieje rycerskie w Polsce 2027 — kalendarz');
    expect(first.url).toBe('https://historia.org.pl/2027/01/27/turnieje/');
  });

  it('leaves startsAt NULL rather than using the publication date', () => {
    /*
     * A feed item is an article, not an event. Putting pubDate in startsAt would file every post as
     * happening today and then let `soon` fire about it — the app shouting about a blog post.
     * Honest nulls group under "announced, no dates yet", which is what these actually are.
     */
    expect(parseFeed(rss, feed).every((e) => e.startsAt === null)).toBe(true);
  });

  it('keeps the publication date, which is a fact the item states about itself', () => {
    /*
     * Not `startsAt` — see above — and not nothing either, which is what it used to be. A feed
     * holds twenty items and the first run meets all of them at once, so `firstSeenAt` says when
     * this app arrived rather than how old the news is.
     */
    expect(new Date(parseFeed(rss, feed)[0].publishedAt!).toISOString()).toBe(
      '2027-01-27T08:00:00.000Z',
    );
    // An item that states none stays honest about it rather than being stamped with the run clock.
    expect(parseFeed(rss, feed)[1].publishedAt).toBeUndefined();
  });

  it('reads the date under whichever name the feed uses for it', () => {
    const atom = `<feed><entry>
      <title>Festiwal</title>
      <link rel="alternate" href="https://x.test/a"/>
      <published>2027-03-04T10:00:00Z</published>
    </entry><entry>
      <title>Jarmark</title>
      <link rel="alternate" href="https://x.test/b"/>
      <updated>2027-03-05T10:00:00Z</updated>
    </entry></feed>`;
    const items = parseFeed(atom, feed);
    expect(new Date(items[0].publishedAt!).toISOString()).toBe('2027-03-04T10:00:00.000Z');
    expect(new Date(items[1].publishedAt!).toISOString()).toBe('2027-03-05T10:00:00.000Z');
  });

  it('ignores a date it cannot parse rather than storing NaN', () => {
    const junk = `<rss><item><title>T</title><link>https://x.test/a</link>
      <pubDate>whenever</pubDate></item></rss>`;
    expect(parseFeed(junk, feed)[0].publishedAt).toBeUndefined();
  });

  it('decodes entities in a plain title', () => {
    expect(parseFeed(rss, feed)[1].title).toBe('Jarmark & Turniej');
  });

  it('falls back to guid when there is no link', () => {
    expect(parseFeed(rss, feed)[1].url).toBe('https://historia.org.pl/2027/02/01/jarmark/');
  });

  it('strips markup out of the description it will match on', () => {
    expect(parseFeed(rss, feed)[0].description).toBe('Zestawienie imprez historycznych.');
  });

  it('applies the feed’s tags, which is how an interest narrows to it', () => {
    expect(parseFeed(rss, feed)[0].tags).toEqual(['history', 'festival']);
  });

  it('reads Atom, where the link is an attribute', () => {
    const atom = `<feed><entry>
      <title>Festiwal</title>
      <link rel="alternate" href="https://x.test/a"/>
    </entry></feed>`;
    expect(parseFeed(atom, feed)[0].url).toBe('https://x.test/a');
  });

  it('returns nothing for markup it does not recognise', () => {
    expect(parseFeed('<html><body>not a feed</body></html>', feed)).toEqual([]);
    expect(parseFeed('', feed)).toEqual([]);
  });

  it('skips an item with no title', () => {
    expect(parseFeed('<rss><item><link>https://x.test/a</link></item></rss>', feed)).toEqual([]);
  });
});
