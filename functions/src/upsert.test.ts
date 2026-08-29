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
      classifiedAt: 1000,
      classifyHash: 'abc123',
    });
    const incoming = toRecord(raw(), 's', 'S', LATER);
    const merged = mergeRecord(incoming, before, LATER);
    expect(merged.record.reach).toBe('national');
    expect(merged.record.reachReason).toBe('Dutch community conference');
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
