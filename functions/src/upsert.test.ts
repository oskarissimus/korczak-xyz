import { describe, expect, it } from 'vitest';
import { mergeRecord, stripUndefined, toRecord } from './upsert';
import type { EventRecord } from '../../korczak-xyz/src/utils/events/types';
import type { RawEvent } from './sources/types';

const NOW = Date.parse('2026-08-23T12:00:00Z');
const LATER = NOW + 86400000;

const raw = (over: Partial<RawEvent> = {}): RawEvent => ({
  sourceKey: 'abc',
  title: 'Wesele Figara',
  url: 'https://example.test/e',
  startsAt: Date.parse('2027-01-14T19:00:00Z'),
  city: 'Warszawa',
  venue: 'Teatr Wielki',
  tags: ['opera'],
  ...over,
});

describe('toRecord', () => {
  it('derives everything the adapters must not', () => {
    const record = toRecord(raw(), 'teatr-wielki', 'Teatr Wielki', NOW);
    expect(record.id).toBe('teatr-wielki_abc');
    expect(record.day).toBe('2027-01-14');
    expect(record.haystack).toContain('wesele figara');
    expect(record.fingerprint).toContain('weselefigara');
    expect(record.firstSeenAt).toBe(NOW);
  });

  it('synthesises a key for a source that has none', () => {
    const a = toRecord(raw({ sourceKey: null }), 's', 'S', NOW);
    const b = toRecord(raw({ sourceKey: null }), 's', 'S', LATER);
    // Stable across runs, which is the whole requirement: an id that moved would re-announce.
    expect(a.id).toBe(b.id);
  });

  it('reads a race distance out of the title, and only for a race', () => {
    const race = toRecord(
      raw({ title: '48. Maraton Warszawski', tags: ['running'] }),
      'elektroniczne-zapisy',
      'Elektroniczne Zapisy',
      NOW,
    );
    expect(race.distancesM).toEqual([42195]);

    // The gate. Without the tag the same words read `Maraton filmowy` as a 42 km run.
    expect(toRecord(raw({ title: '48. Maraton Warszawski' }), 's', 'S', NOW).distancesM)
      .toBeUndefined();
    // A race whose title does not say carries no field at all, rather than an empty array on
    // every one of two thousand documents.
    expect(toRecord(raw({ title: 'VII Bieg o Puchar Wójta', tags: ['running'] }), 's', 'S', NOW)
      .distancesM).toBeUndefined();
  });

  it('handles an undated announcement', () => {
    const record = toRecord(raw({ startsAt: null, dateText: 'Premiera: jesień 2027' }), 's', 'S', NOW);
    expect(record.startsAt).toBeNull();
    expect(record.day).toBeNull();
    expect(record.dateText).toBe('Premiera: jesień 2027');
  });
});

describe('mergeRecord', () => {
  const stored = (over: Partial<EventRecord> = {}): EventRecord => ({
    ...toRecord(raw(), 's', 'S', NOW),
    ...over,
  });

  it('NEVER rewrites firstSeenAt', () => {
    // This is what "announced" means. Move it and every event becomes news again on every run.
    const before = stored({ firstSeenAt: 1000 });
    const incoming = toRecord(raw({ title: 'Wesele Figara (poprawione)' }), 's', 'S', LATER);
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.record.firstSeenAt).toBe(1000);
    expect(merged.record.title).toBe('Wesele Figara (poprawione)');
    expect(merged.created).toBe(false);
  });

  it('records the moment a ticket link first appears', () => {
    // The notice layer sees only the merged document, so this transition is observable nowhere
    // else.
    const before = stored({ ticketUrl: undefined, onSaleAt: undefined });
    const incoming = toRecord(raw({ ticketUrl: 'https://tickets.test/x' }), 's', 'S', LATER);
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.newlyOnSale).toBe(true);
    expect(merged.record.onSaleSeenAt).toBe(LATER);
  });

  it('sets onSaleSeenAt exactly once', () => {
    const before = stored({ ticketUrl: 'https://tickets.test/x', onSaleSeenAt: 500 });
    const incoming = toRecord(raw({ ticketUrl: 'https://tickets.test/x' }), 's', 'S', LATER);
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.newlyOnSale).toBe(false);
    expect(merged.record.onSaleSeenAt).toBe(500);
  });

  /*
   * The one that would cost real money. `batch.set` replaces the whole document and
   * `stripUndefined` drops absent fields, so a field no source has heard of is *deleted* on the
   * next run unless mergeRecord names it — and the classifier would then re-answer the same
   * question about every event every six hours, for ever.
   */
  it('carries the classifier fields forward, which no source can supply', () => {
    const before = stored({
      country: 'NL',
      reach: 'national',
      reachReason: 'Dutch community conference',
      kind: 'listing',
      kindReason: 'A conference with dates and a venue',
      classifiedAt: 1000,
      classifyHash: 'abc123',
    });
    const incoming = toRecord(raw(), 's', 'S', LATER);
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.record.reach).toBe('national');
    expect(merged.record.reachReason).toBe('Dutch community conference');
    expect(merged.record.kind).toBe('listing');
    expect(merged.record.kindReason).toBe('A conference with dates and a venue');
    expect(merged.record.classifyHash).toBe('abc123');
    expect(merged.record.classifiedAt).toBe(1000);
  });

  it('lets a source that knows the country overrule the stored one', () => {
    // Ticketmaster is queried countryCode=PL and Teatr Wielki is in Warsaw: those are facts, and
    // they outrank whatever the classifier guessed before the source started saying so.
    const before = stored({ country: 'DE' });
    const incoming = { ...toRecord(raw(), 's', 'S', LATER), country: 'PL' };
    expect(mergeRecord(incoming, before, LATER).record.country).toBe('PL');
    // ...but a source with no opinion does not erase what is known.
    const silent = toRecord(raw(), 's', 'S', LATER);
    expect(mergeRecord(silent, before, LATER).record.country).toBe('DE');
  });

  it('does not call a brand-new ticketed event an onsale transition', () => {
    // There was no "before" in which it had no tickets. Announcing it is the whole story, and
    // firing both would be two buzzes for one piece of news.
    const incoming = toRecord(raw({ ticketUrl: 'https://tickets.test/x' }), 's', 'S', NOW);
    const merged = mergeRecord(incoming, null, NOW);
    expect(merged.created).toBe(true);
    expect(merged.newlyOnSale).toBe(false);
  });
});

describe('stripUndefined', () => {
  it('drops undefined, which setDoc rejects outright', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });
});

/*
 * The reader's fields, and the two ways this merge could quietly lose or misread them.
 *
 * Both are the same class of bug as the classifier's: a field no source has heard of, written by a
 * second writer, over a document the upsert rebuilds from scratch every six hours.
 */
describe('mergeRecord and the newsroom reader', () => {
  const article = (over: Partial<EventRecord> = {}): EventRecord => ({
    ...toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, tags: ['theatre', 'newsroom'] }),
      'teatr-wielki',
      'Teatr Wielki',
      NOW,
    ),
    ...over,
  });

  it('carries a model-supplied onSaleAt forward, the source having none', () => {
    /*
     * The one that would have lost the whole feature. `raw.onSaleAt` is undefined for an article
     * the regex could not phrase-match, `stripUndefined` drops it, and the sale date the reader
     * learnt would be deleted on the next run — six hours later, silently, notice never fired.
     */
    const before = article({ onSaleAt: Date.parse('2027-03-01T09:00:00Z') });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    expect(mergeRecord(incoming, before, LATER).record.onSaleAt).toBe(
      Date.parse('2027-03-01T09:00:00Z'),
    );
  });

  it('lets an adapter that does state a sale date overrule the stored one', () => {
    // Same rule as `country`: the scrape read the sentence, so it wins.
    const before = article({ onSaleAt: Date.parse('2027-03-01T09:00:00Z') });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, onSaleAt: Date.parse('2027-04-01T09:00:00Z') }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    expect(mergeRecord(incoming, before, LATER).record.onSaleAt).toBe(
      Date.parse('2027-04-01T09:00:00Z'),
    );
  });

  it('carries the reading itself forward, and re-derives its tag', () => {
    const before = article({
      newsroomKind: 'programme',
      newsroomSummary: 'The 2027/28 season is announced.',
      newsroomHash: 'abc123',
      newsroomReadAt: NOW,
    });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, tags: ['theatre', 'newsroom'] }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    const merged = mergeRecord(incoming, before, LATER).record;
    expect(merged.newsroomKind).toBe('programme');
    expect(merged.newsroomSummary).toBe('The 2027/28 season is announced.');
    expect(merged.newsroomHash).toBe('abc123');
    // The source rewrites `tags` wholesale and has never heard of `programme`.
    expect(merged.tags).toEqual(['theatre', 'newsroom', 'programme']);
  });

  it('carries the date the article is about forward, no source having heard of it', () => {
    /*
     * Exactly the `onSaleAt` argument, on the field that stops an article about a finished
     * festival reading as news with no dates yet. Unnamed in the merge it would be deleted six
     * hours after the model read it, and the feed would go back to what the screenshot showed.
     */
    const at = Date.parse('2026-07-06T10:00:00Z');
    const before = article({ newsroomEventAt: at });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, tags: ['theatre', 'newsroom'] }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    const merged = mergeRecord(incoming, before, LATER).record;
    expect(merged.newsroomEventAt).toBe(at);
    // And it stays out of `startsAt`, which is what notices count down to.
    expect(merged.startsAt).toBeNull();
  });

  it('keeps a publication date the page no longer shows', () => {
    /*
     * A news list holds ten items. An article that has scrolled off it is still in the corpus and
     * must not lose the day it was published just because the run that met it could not see one.
     */
    const published = Date.parse('2026-07-06T00:00:00Z');
    const before = article({ publishedAt: published });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    expect(mergeRecord(incoming, before, LATER).record.publishedAt).toBe(published);
    // The source still wins where it states one, as it does for `country`.
    const restated = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, publishedAt: LATER }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    expect(mergeRecord(restated, before, LATER).record.publishedAt).toBe(LATER);
  });

  it('does not read a FUTURE sale date as tickets having gone on sale', () => {
    /*
     * `hasTickets` used to be `onSaleAt !== undefined`, which was right only while every one came
     * from Ticketmaster and was months past. Learning that a season opens in three weeks would
     * otherwise mint an `onsale` notice reading "On sale now" about a box office that is shut —
     * and consume the latch that `presale` needed three weeks earlier.
     */
    const before = article({ onSaleAt: undefined });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, onSaleAt: LATER + 20 * 86400000 }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.newlyOnSale).toBe(false);
    expect(merged.record.onSaleSeenAt).toBeUndefined();
  });

  it('still reads a sale date now past as tickets being on sale', () => {
    // Which is what every Ticketmaster row's `sales.public.startDateTime` is, and what the
    // `onsale` notice has always meant.
    const before = article({ onSaleAt: undefined });
    const incoming = toRecord(
      raw({ sourceKey: 'aktualnosci/x', startsAt: null, onSaleAt: LATER - 86400000 }),
      'teatr-wielki',
      'Teatr Wielki',
      LATER,
    );
    expect(mergeRecord(incoming, before, LATER).newlyOnSale).toBe(true);
  });
});
