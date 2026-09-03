import { describe, expect, it } from 'vitest';
import { alertKindFor, planAlerts, type PlanContext } from './notices';
import { newSegment, SEED_SEGMENTS } from './segments';
import { alertIdFor, contentHashOf } from './normalize';
import { DEFAULT_TRANSIT_SETTINGS, type TransitItem, type TransitSettings, type WatchedSegment } from './types';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const ARMED = NOW - 86400000;

const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map((seed) => newSegment(seed, seed.id, 'w', ARMED)!);

function item(n: number, patch: Partial<TransitItem> = {}): TransitItem {
  const guid = `https://www.wtp.waw.pl/utrudnienia/2026/09/03/x${n}/`;
  return {
    id: `impediment_x${n}`,
    feed: 'impediment',
    guid,
    title: 'Utrudnienia w komunikacji: M1',
    url: guid,
    publishedAt: NOW - n * 60000,
    titleLines: ['M1'],
    contentHash: `hash${n}`,
    closedStops: ['Centrum'],
    firstSeenAt: NOW - n * 60000,
    updatedAt: NOW,
    ...patch,
  };
}

function ctx(patch: Partial<PlanContext> = {}, settings: Partial<TransitSettings> = {}): PlanContext {
  return {
    now: NOW,
    settings: { ...DEFAULT_TRANSIT_SETTINGS, armedAt: ARMED, ...settings },
    seen: new Set<string>(),
    appUrl: '/apps/transit',
    ...patch,
  };
}

describe('arming', () => {
  it('sends nothing at all before alerts are armed', () => {
    expect(planAlerts([item(1)], SEGMENTS, ctx({}, { armedAt: null })).send).toEqual([]);
  });

  /*
   * Measured on when this app first saw the item, not on when WTP published it. Otherwise a
   * communiqué published five minutes before the button was pressed is indistinguishable from one
   * published five minutes after, and only one of those is news.
   */
  it('does not replay the corpus that existed when alerts were armed', () => {
    const old = item(1, { firstSeenAt: ARMED - 1000, publishedAt: NOW - 3600000 });
    expect(planAlerts([old], SEGMENTS, ctx()).send).toEqual([]);
  });

  it('ignores a communiqué older than the horizon even if it is new to us', () => {
    const stale = item(1, { publishedAt: NOW - 30 * 86400000 });
    expect(planAlerts([stale], SEGMENTS, ctx()).send).toEqual([]);
  });
});

describe('the latch', () => {
  it('never fires twice for the same text', () => {
    const one = item(1);
    const seen = new Set([alertIdFor(one.guid, 'route', one.contentHash)]);
    expect(planAlerts([one], SEGMENTS, ctx({ seen })).send).toEqual([]);
  });

  /*
   * The reason the content hash is in the alert id at all. WTP edits a live communiqué as a closure
   * grows — "the closure now reaches Imielin too" is news about an article you were already told
   * about, and keyed on the guid alone it would be latched away by the first alert.
   */
  it('fires again when WTP edits the communiqué', () => {
    const first = item(1, { title: 'Utrudnienia w komunikacji: M1', body: 'Zamknięta stacja Centrum.' });
    const firstHash = contentHashOf(first);
    const edited = { ...first, body: 'Zamknięte stacje Centrum i Politechnika.' };
    const editedHash = contentHashOf(edited);
    expect(editedHash).not.toBe(firstHash);

    const seen = new Set([alertIdFor(first.guid, 'route', firstHash)]);
    const plan = planAlerts([{ ...edited, contentHash: editedHash }], SEGMENTS, ctx({ seen }));
    expect(plan.send).toHaveLength(1);
  });

  it('does not fire again for a whitespace edit', () => {
    const first = item(1, { body: 'Zamknięta stacja Centrum.' });
    expect(contentHashOf({ ...first, body: '  Zamknięta   stacja Centrum. ' })).toBe(contentHashOf(first));
  });
});

describe('the two kinds', () => {
  it('ranks a route alert ahead of a line alert when the cap bites', () => {
    const items = [
      item(1, { closedStops: ['Kabaty'] }), // line
      item(2, { closedStops: ['Centrum'] }), // route
    ];
    const plan = planAlerts(items, SEGMENTS, ctx({}, { maxPerRun: 1 }));
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0].kind).toBe('route');
    expect(plan.suppressed).toHaveLength(1);
    expect(plan.summary).toEqual({ count: 1, url: '/apps/transit' });
  });

  it('sends the newest first within a kind', () => {
    const plan = planAlerts([item(5), item(1)], SEGMENTS, ctx({}, { maxPerRun: 1 }));
    expect(plan.send[0].item.id).toBe('impediment_x1');
  });

  it('drops line-level alerts when they are switched off, keeping route ones', () => {
    const items = [item(1, { closedStops: ['Kabaty'] }), item(2, { closedStops: ['Centrum'] })];
    const plan = planAlerts(items, SEGMENTS, ctx({}, { lineAlerts: false }));
    expect(plan.send.map((a) => a.kind)).toEqual(['route']);
  });

  it('drops planned changes when they are switched off', () => {
    const change = item(1, { feed: 'change' });
    expect(planAlerts([change], SEGMENTS, ctx({}, { changeAlerts: false })).send).toEqual([]);
    expect(planAlerts([change], SEGMENTS, ctx()).send).toHaveLength(1);
  });

  /*
   * Muting a leg of the commute demotes it; it does not silence the line. That distinction is the
   * whole difference between "I know about this stretch already" and "stop telling me about M1".
   */
  it('demotes a route match on a muted segment to line level rather than dropping it', () => {
    const muted = SEGMENTS.map((s) => ({ ...s, muted: true }));
    const decided = alertKindFor(item(1), muted, { ...DEFAULT_TRANSIT_SETTINGS, armedAt: ARMED });
    expect(decided?.kind).toBe('line');
    expect(decided?.verdict.impact).toBe('route');
  });

  it('drops it entirely only when line alerts are off too', () => {
    const muted = SEGMENTS.map((s) => ({ ...s, muted: true }));
    expect(
      alertKindFor(item(1), muted, { ...DEFAULT_TRANSIT_SETTINGS, armedAt: ARMED, lineAlerts: false }),
    ).toBeNull();
  });
});

describe('an item nobody could read', () => {
  it('still fires, at route level, so a dead extractor is loud rather than silent', () => {
    const unread = item(1, { closedStops: undefined, extractError: 'model timed out' });
    const plan = planAlerts([unread], SEGMENTS, ctx());
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0].kind).toBe('route');
    expect(plan.send[0].verdict.certain).toBe(false);
  });
});
