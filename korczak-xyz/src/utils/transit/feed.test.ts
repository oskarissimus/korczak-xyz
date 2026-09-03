import { describe, expect, it } from 'vitest';
import { buildTransitFeed, extractionIsStale, isMetro } from './feed';
import { newSegment, SEED_SEGMENTS } from './segments';
import type { TransitItem, WatchedSegment } from './types';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map((seed) => newSegment(seed, seed.id, 'w', NOW)!);

function item(id: string, patch: Partial<TransitItem> = {}): TransitItem {
  return {
    id,
    feed: 'impediment',
    guid: `https://www.wtp.waw.pl/utrudnienia/${id}/`,
    title: 'Utrudnienia w komunikacji: M1',
    url: `https://www.wtp.waw.pl/utrudnienia/${id}/`,
    publishedAt: NOW - 3600000,
    titleLines: ['M1'],
    contentHash: 'aaaaaaaaaaaaaaaa',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe('buildTransitFeed', () => {
  const items = [
    item('route', { closedStops: ['Centrum'] }),
    item('line', { closedStops: ['Kabaty'] }),
    item('bus', { title: 'Utrudnienia w komunikacji: 189', titleLines: ['189'], closedStops: [] }),
  ];

  it('files each row under the section its verdict names', () => {
    const feed = buildTransitFeed(items, SEGMENTS, { now: NOW });
    expect(feed.sections.map((s) => s.key)).toEqual(['route', 'line']);
    expect(feed.sections[0].rows.map((r) => r.item.id)).toEqual(['route']);
    expect(feed.sections[1].rows.map((r) => r.item.id)).toEqual(['line']);
  });

  /*
   * A route filter is otherwise unprovable: a communiqué correctly judged irrelevant and one
   * silently dropped look identical from outside. Same argument as the events app's `Filtered out`.
   */
  it('shows what it decided not to show, on request', () => {
    const feed = buildTransitFeed(items, SEGMENTS, { now: NOW, includeOther: true });
    expect(feed.sections.map((s) => s.key)).toEqual(['route', 'line', 'other']);
    expect(feed.sections[2].rows.map((r) => r.item.id)).toEqual(['bus']);
  });

  it('orders newest first', () => {
    const feed = buildTransitFeed(
      [item('old', { publishedAt: NOW - 7200000, closedStops: ['Centrum'] }), item('new', { closedStops: ['Centrum'] })],
      SEGMENTS,
      { now: NOW },
    );
    expect(feed.sections[0].rows.map((r) => r.item.id)).toEqual(['new', 'old']);
  });

  it('drops anything past the horizon', () => {
    const feed = buildTransitFeed([item('ancient', { publishedAt: NOW - 40 * 86400000 })], SEGMENTS, { now: NOW });
    expect(feed.totalCount).toBe(0);
  });

  it('narrows to one feed when asked', () => {
    const feed = buildTransitFeed(
      [item('a', { closedStops: ['Centrum'] }), item('b', { feed: 'change', closedStops: ['Centrum'] })],
      SEGMENTS,
      { now: NOW, feed: 'change' },
    );
    expect(feed.sections[0].rows.map((r) => r.item.id)).toEqual(['b']);
  });

  /*
   * Counted over items that name a metro line, never over matched rows. An item nobody read has no
   * verdict, so measured on matches a stopped extractor would drop numerator and denominator
   * together and go on reporting a perfect score.
   */
  it('counts how much of the metro corpus has actually been read', () => {
    const feed = buildTransitFeed(
      [
        item('read', { closedStops: ['Centrum'], extractHash: 'aaaaaaaaaaaaaaaa' }),
        item('unread'),
        item('bus', { title: 'Utrudnienia: 189', titleLines: ['189'] }),
      ],
      SEGMENTS,
      { now: NOW },
    );
    expect(feed.metroCount).toBe(2);
    expect(feed.extractedCount).toBe(1);
    expect(feed.totalCount).toBe(3);
  });
});

describe('the state badges', () => {
  it('knows a metro item from a bus one', () => {
    expect(isMetro(item('a'))).toBe(true);
    expect(isMetro(item('b', { title: 'Utrudnienia: 189', titleLines: ['189'] }))).toBe(false);
  });

  it('spots a reading that is older than the text it read', () => {
    expect(extractionIsStale(item('a', { extractHash: 'aaaaaaaaaaaaaaaa' }))).toBe(false);
    expect(extractionIsStale(item('a', { extractHash: 'bbbbbbbbbbbbbbbb' }))).toBe(true);
    // Never read at all is not the same as read and stale, and must not draw the same badge.
    expect(extractionIsStale(item('a'))).toBe(false);
  });
});

describe('staleness across a prompt change', () => {
  /*
   * The stored hash is `${EXTRACTOR_VERSION}:${contentHash}`, because bumping the version has to
   * invalidate every reading at once. Compared whole, that prefix would make every item on earth
   * read as "WTP has edited this" — which is a sentence about the operator, and would be a lie
   * about our own build.
   */
  it('reads past the version prefix', () => {
    expect(extractionIsStale(item('a', { extractHash: '1:aaaaaaaaaaaaaaaa' }))).toBe(false);
    expect(extractionIsStale(item('a', { extractHash: '2:aaaaaaaaaaaaaaaa' }))).toBe(false);
    expect(extractionIsStale(item('a', { extractHash: '1:bbbbbbbbbbbbbbbb' }))).toBe(true);
  });
});
