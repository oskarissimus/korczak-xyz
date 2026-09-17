import { describe, expect, it } from 'vitest';
import { alertKindFor, planAlerts, type PlanContext } from './notices';
import { newSegment, SEED_SEGMENTS } from './segments';
import { alertIdFor, contentHashOf } from './normalize';
import { DEFAULT_TRANSIT_SETTINGS, type TransitItem, type TransitSettings, type WatchedSegment } from './types';

const NOW = Date.parse('2026-09-03T12:00:00Z');
const ARMED = NOW - 86400000;

const SEGMENTS: WatchedSegment[] = SEED_SEGMENTS.map((seed) => newSegment(seed, seed.id, 'w', ARMED)!);

/*
 * A whole communiqué. `hasProse` treats an item carrying only WTP's headline as unread whatever it
 * stores, so a fixture with no body would put every row here in that state — see `MIN_PROSE_CHARS`.
 */
const PROSE =
  'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
  'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański. ' +
  'Trwa uruchamianie zastępczej komunikacji autobusowej ZA METRO.';

function item(n: number, patch: Partial<TransitItem> = {}): TransitItem {
  const guid = `https://www.wtp.waw.pl/utrudnienia/2026/09/03/x${n}/`;
  return {
    id: `impediment_x${n}`,
    feed: 'impediment',
    guid,
    title: 'Utrudnienia w komunikacji: M1',
    url: guid,
    body: PROSE,
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

  /** Yesterday evening: published, met by the collector a moment later, alerted on. */
  const LAST_NIGHT = NOW - 23 * 3600000;
  const yesterdays = item(1, { publishedAt: LAST_NIGHT - 30000, firstSeenAt: LAST_NIGHT });
  /** Tonight: the same post, the same text, a new `pubDate`. Nothing else moved. */
  const tonight = { ...yesterdays, publishedAt: NOW - 60000 };

  /*
   * 17 Sep 2026, and the reason the alert id carries the publication date as well.
   *
   * WTP files a second incident under the first one's post rather than opening a new one: the guid
   * is `?post_type=impediment&p=177253` both nights, the headline is the template every M1 row
   * carries, the body is that headline restated, and the article is the same two-loop paragraph. So
   * every digest this app takes is identical, the alert id was the one claimed 24 hours earlier,
   * and `create()` failed on it — the closure was on the screen, read down to the station, and the
   * phone stayed silent while a competing app rang.
   *
   * Note what this defeats: nothing was stale and no reading was wrong. The guard was right and
   * what it was comparing could not see the day change.
   */
  it('fires again when WTP publishes the same communiqué a second time', () => {
    const seen = new Set([alertIdFor(yesterdays.guid, 'route', yesterdays.contentHash)]);
    expect(planAlerts([yesterdays], SEGMENTS, ctx({ seen })).send).toEqual([]);

    const plan = planAlerts([tonight], SEGMENTS, ctx({ seen }));
    expect(plan.send).toHaveLength(1);
    expect(plan.send[0].item.contentHash).toBe(yesterdays.contentHash);
  });

  /** And the second publication latches in its turn, or the next run repeats it ten minutes later. */
  it('does not fire a third time for that same re-publication', () => {
    const claimed = planAlerts([tonight], SEGMENTS, ctx()).send[0]!;
    const seen = new Set([claimed.alertId]);
    expect(planAlerts([tonight], SEGMENTS, ctx({ seen })).send).toEqual([]);
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
