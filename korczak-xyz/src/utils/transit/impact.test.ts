import { describe, expect, it } from 'vitest';
import { affectedLines, audibleAtRoute, impactOf } from './impact';
import { newSegment, SEED_SEGMENTS } from './segments';
import type { TransitItem, WatchedSegment } from './types';

const NOW = Date.parse('2026-09-03T12:00:00Z');

const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map(
  (seed) => newSegment(seed, seed.id, 'w', NOW)!,
);

function item(patch: Partial<TransitItem> = {}): TransitItem {
  return {
    id: 'impediment_x',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/utrudnienia/2026/09/03/x/',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/2026/09/03/x/',
    publishedAt: NOW,
    titleLines: ['M1'],
    contentHash: 'abcd1234abcd1234',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe('items that reach nobody', () => {
  it('has no verdict about a bus', () => {
    expect(
      impactOf(item({ title: 'Utrudnienia w komunikacji: 189, 401', titleLines: ['189', '401'] }), SEGMENTS),
    ).toBeNull();
  });

  it('has no verdict when nothing is watched', () => {
    expect(impactOf(item(), [])).toBeNull();
  });

  it('has no verdict when every watched segment is a tombstone', () => {
    expect(impactOf(item(), SEGMENTS.map((s) => ({ ...s, deleted: true })))).toBeNull();
  });
});

describe('a closure the extractor read', () => {
  it('is route-level when it lands on the journey', () => {
    const verdict = impactOf(item({ closedStops: ['Świętokrzyska', 'Centrum', 'Politechnika'] }), SEGMENTS);
    expect(verdict).toMatchObject({ impact: 'route', certain: true, lines: ['M1'] });
    expect(verdict!.stops).toEqual(expect.arrayContaining(['Świętokrzyska', 'Centrum', 'Politechnika']));
    expect(verdict!.segmentIds).toEqual(['seed-m1-swietokrzyska-imielin']);
  });

  /*
   * The reason a segment is an interval and not a pair. Rondo ONZ is named in neither seed and is
   * in the middle of the first leg; matched on endpoints alone this reads as somebody else's day.
   */
  it('is route-level for a station in the middle of a leg, named by neither endpoint', () => {
    const verdict = impactOf(
      item({ title: 'Utrudnienia w komunikacji: M2', titleLines: ['M2'], closedStops: ['Rondo ONZ'] }),
      SEGMENTS,
    );
    expect(verdict).toMatchObject({ impact: 'route', certain: true, stops: ['Rondo ONZ'] });
  });

  it('is line-level when it lands on the watched line but past the journey', () => {
    const verdict = impactOf(item({ closedStops: ['Kabaty', 'Natolin'] }), SEGMENTS);
    expect(verdict).toMatchObject({ impact: 'line', certain: true });
    expect(verdict!.segmentIds).toEqual([]);
    expect(verdict!.stops).toEqual(expect.arrayContaining(['Kabaty', 'Natolin']));
  });

  /*
   * An empty list is a real answer — a lift out of order, a reduced frequency — and it is not the
   * same as nobody having read the prose. It stays line-level, and the reader still hears about it.
   */
  it('is line-level when the prose named no closure at all', () => {
    expect(impactOf(item({ closedStops: [] }), SEGMENTS)).toMatchObject({ impact: 'line', certain: true });
  });

  it('is route-level for the whole line, without needing a station list', () => {
    expect(impactOf(item({ wholeLine: true, closedStops: [] }), SEGMENTS)).toMatchObject({
      impact: 'route',
      certain: true,
    });
  });
});

describe('what happens when the reading fails', () => {
  /*
   * The rule the whole file is arranged around. A metro communiqué nobody could read is not a
   * communiqué about somebody else's line — and filing it as one is how a broken extractor becomes
   * an app that has quietly stopped mentioning that the metro is shut.
   */
  it('escalates an unread item to route level, marked uncertain', () => {
    expect(impactOf(item(), SEGMENTS)).toMatchObject({ impact: 'route', certain: false, stops: [] });
  });

  it('escalates a station name this build cannot place', () => {
    const verdict = impactOf(item({ closedStops: ['Kabaty', 'Chrzanów'] }), SEGMENTS);
    expect(verdict).toMatchObject({ impact: 'route', certain: false });
  });

  it('does not escalate when the unplaceable name is placed on the other affected line', () => {
    const verdict = impactOf(
      item({
        title: 'Utrudnienia w komunikacji: M1, M2',
        titleLines: ['M1', 'M2'],
        closedStops: ['Kabaty', 'Bemowo'],
      }),
      SEGMENTS,
    );
    expect(verdict).toMatchObject({ impact: 'line', certain: true });
  });
});

describe('which lines an item is about', () => {
  it('takes the headline as fact', () => {
    expect(affectedLines(item({ title: 'Utrudnienia w komunikacji: 742, M1', titleLines: ['742', 'M1'] }))).toEqual([
      'M1',
    ]);
  });

  it('adds a line the extractor found and the headline understated', () => {
    expect(affectedLines(item({ lines: ['M2'] }))).toEqual(['M1', 'M2']);
  });
});

describe('muting', () => {
  const muted = SEGMENTS.map((s) => ({ ...s, muted: true }));

  it('does not change the verdict — that is a statement about the world', () => {
    expect(impactOf(item({ closedStops: ['Centrum'] }), muted)).toMatchObject({ impact: 'route' });
  });

  it('does change whether it may ring at route priority', () => {
    const verdict = impactOf(item({ closedStops: ['Centrum'] }), muted)!;
    expect(audibleAtRoute(verdict, muted)).toBe(false);
    expect(audibleAtRoute(verdict, SEGMENTS)).toBe(true);
  });

  it('stays audible while one matched segment is unmuted', () => {
    const half = [SEGMENTS[0], { ...SEGMENTS[1], muted: true }];
    const verdict = impactOf(
      item({ title: 'Utrudnienia: M1, M2', titleLines: ['M1', 'M2'], closedStops: ['Rondo ONZ', 'Centrum'] }),
      half,
    )!;
    expect(audibleAtRoute(verdict, half)).toBe(true);
  });
});
