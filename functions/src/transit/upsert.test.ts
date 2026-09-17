import { describe, expect, it } from 'vitest';
import { mergeItem, stripUndefined } from './upsert';
import { articleStampOf, articleUpdate } from './article';
import { contentHashOf, feedHashOf, hasProse } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

const NOW = Date.parse('2026-09-12T08:05:00Z');
const EARLIER = NOW - 3600_000;

const STUB = 'Utrudnienia w kursowaniu pociągów metra na linii M1.';
const ENDED = 'ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.';
const PROSE =
  'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
  'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański. ' +
  'Metro kursuje w dwóch pętlach: Młociny <-> Słodowiec oraz Kabaty <-> Dworzec Gdański.';

/** What `parseWtpFeed` produces: the feed's own fields, and a hash over those alone. */
function fromFeed(body: string, patch: Partial<TransitItem> = {}): TransitItem {
  const base: TransitItem = {
    id: 'impediment_p-176873',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/?post_type=impediment&p=176873',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/2026/09/12/a/',
    body,
    publishedAt: EARLIER,
    titleLines: ['M1'],
    contentHash: '',
    firstSeenAt: EARLIER,
    updatedAt: EARLIER,
    ...patch,
  };
  return { ...base, contentHash: feedHashOf(base) };
}

/** The same row after the article pass has run against it. */
function withArticle(body: string): TransitItem {
  const row = fromFeed(body);
  return { ...row, ...articleUpdate(row, PROSE), extractHash: `1:${articleUpdate(row, PROSE).contentHash}` };
}

describe('the extractor’s work survives the next fetch', () => {
  it('keeps the reading when an unchanged feed row arrives again', () => {
    const stored = { ...withArticle(STUB), closedStops: ['Słodowiec', 'Marymont'], summary: 'x' };
    const { record } = mergeItem(fromFeed(STUB), stored, NOW);
    expect(record.closedStops).toEqual(['Słodowiec', 'Marymont']);
    expect(record.article).toBe(PROSE);
    expect(record.firstSeenAt).toBe(EARLIER);
  });

  /*
   * The whole reason the hash is recomputed here. `parseWtpFeed` has no article to hash, so taking
   * `incoming.contentHash` would drop the item back to the feed-only digest every ten minutes —
   * which no longer matches the stored `extractHash`, so the model is called again, on every run,
   * for ever.
   */
  it('re-derives the hash over the article, so an unchanged item is not re-read every run', () => {
    const stored = withArticle(STUB);
    const { record } = mergeItem(fromFeed(STUB), stored, NOW);
    expect(record.contentHash).toBe(contentHashOf({ title: record.title, body: STUB, article: PROSE }));
    expect(record.contentHash).toBe(stored.contentHash);
    expect(record.extractHash).toBe(stored.extractHash);
  });
});

describe('an article outlives its row only as long as the row', () => {
  /*
   * `ZAKOŃCZONO:` is WTP editing the feed text, which means the page behind it has moved on too.
   * Carried forward, the app would hold a fortnight-old description of a live closure under a
   * headline saying it is over — and `contentHash` would cover it and call it current.
   */
  it('drops the article when WTP rewrites the feed text', () => {
    const { record } = mergeItem(fromFeed(ENDED), withArticle(STUB), NOW);
    expect(record.article).toBeUndefined();
    expect(record.articleFetchedFor).toBeUndefined();
    expect(record.contentHash).toBe(feedHashOf({ title: record.title, body: ENDED }));
    // Unreadable again, so it is fetched again on this very run and escalated until it is.
    expect(hasProse(record)).toBe(false);
  });

  it('actually deletes the field rather than leaving the old one in the document', () => {
    const { record } = mergeItem(fromFeed(ENDED), withArticle(STUB), NOW);
    expect(stripUndefined(record)).not.toHaveProperty('article');
  });

  /*
   * The other kind of edited row, and it does not look like one. WTP files a second incident under
   * the first one's post: same guid, same headline, same one-sentence body, new `pubDate`. Every
   * word this comparison can read is identical, so the previous night's article was carried forward
   * and hashed as current — the app describing yesterday's closure under tonight's notice, stop
   * list and all.
   */
  it('drops the article when WTP publishes the same row a second time', () => {
    // As `parseWtpFeed` produces it: the feed's new `pubDate`, and `firstSeenAt` stamped `now`
    // because a parser cannot know when this app first met the row. The stored date is the real one.
    const tonight = fromFeed(STUB, { publishedAt: NOW - 60_000, firstSeenAt: NOW });
    const { record } = mergeItem(tonight, withArticle(STUB), NOW);
    expect(record.article).toBeUndefined();
    expect(record.articleFetchedFor).toBeUndefined();
    expect(hasProse(record)).toBe(false);
    // And the merged row carries the stored date, so the re-fetch stamps the right revision.
    expect(record.firstSeenAt).toBe(EARLIER);
  });

  /*
   * And the deploy-safety half: a row published before we met it — which is every row in the corpus
   * bar a couple — keeps the article and the stamp it already has. Otherwise this change would drop
   * every stored article at once and re-announce a fortnight of metro history.
   */
  it('keeps the article of a row that was never re-published', () => {
    const stored = withArticle(STUB);
    const { record } = mergeItem(fromFeed(STUB), stored, NOW);
    expect(record.article).toBe(PROSE);
    expect(record.articleFetchedFor).toBe(articleStampOf(stored));
  });

  /* A row nothing has fetched yet is written exactly as the feed stated it. */
  it('leaves a brand new row alone', () => {
    const { record, created } = mergeItem(fromFeed(STUB), null, NOW);
    expect(created).toBe(true);
    expect(record.article).toBeUndefined();
    expect(record.firstSeenAt).toBe(NOW);
  });
});
