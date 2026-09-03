import { describe, expect, it } from 'vitest';
import { payloadFor } from './notify';
import { mergeItem } from './upsert';
import { newSegment, SEED_SEGMENTS } from '../../../korczak-xyz/src/utils/transit/segments';
import { impactOf } from '../../../korczak-xyz/src/utils/transit/impact';
import { alertIdFor } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { PendingAlert } from '../../../korczak-xyz/src/utils/transit/notices';
import type { TransitItem, WatchedSegment } from '../../../korczak-xyz/src/utils/transit/types';

const NOW = Date.parse('2026-08-27T18:10:00Z');
const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map((seed) => newSegment(seed, seed.id, 'w', NOW)!);

function item(patch: Partial<TransitItem> = {}): TransitItem {
  return {
    id: 'impediment_a',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/utrudnienia/a/',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/a/',
    publishedAt: NOW,
    titleLines: ['M1'],
    contentHash: 'aaaaaaaaaaaaaaaa',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function pending(patch: Partial<TransitItem>): PendingAlert {
  const record = item(patch);
  const verdict = impactOf(record, SEGMENTS)!;
  const kind = verdict.impact;
  return { alertId: alertIdFor(record.guid, kind, record.contentHash), kind, item: record, verdict };
}

describe('the banner', () => {
  it('puts the priority in the title, because that is what a glance takes in', () => {
    const route = payloadFor(pending({ closedStops: ['Centrum', 'Politechnika'] }));
    expect(route.title).toContain('Twoja trasa');
    expect(route.title).toContain('M1');

    const line = payloadFor(pending({ closedStops: ['Kabaty'] }));
    expect(line.title).not.toContain('Twoja trasa');
  });

  /*
   * The stop names lead. Every metro headline WTP writes is "Utrudnienia w komunikacji: M1" — what
   * distinguishes tonight's from last week's is which stations are shut, and a lock screen has no
   * card to open.
   */
  it('leads with the stops that put it on the route', () => {
    const payload = payloadFor(pending({ closedStops: ['Centrum', 'Politechnika'], reason: 'awaria taboru' }));
    expect(payload.body.startsWith('Centrum, Politechnika')).toBe(true);
    expect(payload.body).toContain('awaria taboru');
  });

  it('says when it does not know, rather than shouting about nothing', () => {
    const payload = payloadFor(pending({}));
    expect(payload.body).toContain('Nie udało się odczytać');
  });

  it('says so when the whole line is down', () => {
    expect(payloadFor(pending({ wholeLine: true, closedStops: [] })).body).toContain('Cała linia');
  });

  it('tags on the alert id, so an edited communiqué replaces its own banner group', () => {
    const payload = payloadFor(pending({ closedStops: ['Centrum'] }));
    expect(payload.tag).toContain('aaaaaaaaaaaaaaaa');
    expect(payload.url).toBe('/apps/transit');
  });
});

describe('mergeItem', () => {
  const stored = {
    ...item(),
    firstSeenAt: NOW - 86400000,
    closedStops: ['Centrum'],
    reason: 'awaria taboru',
    extractHash: '1:aaaaaaaaaaaaaaaa',
    extractedAt: NOW - 86400000,
  };

  it('keeps firstSeenAt, which is what armedAt is measured against', () => {
    expect(mergeItem(item(), stored, NOW).record.firstSeenAt).toBe(NOW - 86400000);
    expect(mergeItem(item(), null, NOW).record.firstSeenAt).toBe(NOW);
  });

  /*
   * `batch.set` replaces the whole document, so a field not named in the merge is deleted — and a
   * deleted reading is one paid for again on the very next fetch, every ten minutes, for ever.
   */
  it('carries the reading forward across a fetch that changed nothing', () => {
    const merged = mergeItem(item(), stored, NOW).record;
    expect(merged.closedStops).toEqual(['Centrum']);
    expect(merged.reason).toBe('awaria taboru');
    expect(merged.extractHash).toBe('1:aaaaaaaaaaaaaaaa');
  });

  /*
   * And keeps it across an edit, deliberately. Leaving the old extractHash beside a new
   * contentHash is exactly what makes `needsExtracting` true and what lets the Raw tab say "this
   * reading is out of date" — clearing it would lose the difference between never-read and stale.
   */
  it('leaves a stale reading in place beside the new text, rather than clearing it', () => {
    const edited = mergeItem(item({ contentHash: 'bbbbbbbbbbbbbbbb' }), stored, NOW).record;
    expect(edited.contentHash).toBe('bbbbbbbbbbbbbbbb');
    expect(edited.extractHash).toBe('1:aaaaaaaaaaaaaaaa');
  });
});
