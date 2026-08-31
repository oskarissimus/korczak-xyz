import { describe, expect, it } from 'vitest';
import { noticesFor, planRun, type PlanContext } from './notices';
import { NO_IGNORES } from './ignores';
import { fingerprintOf, haystackOf, noticeIdFor } from './normalize';
import type { EventRecord, Interest } from './types';

const DAY = 86400000;
const NOW = Date.parse('2026-08-23T12:00:00Z');
const ARMED = NOW - 30 * DAY;

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  armedAt: ARMED,
  maxPerRun: 3,
  maxOnSalePerRun: 10,
  ignored: NO_IGNORES,
  ...over,
});

let seq = 0;
function ev(p: Partial<EventRecord> & { title: string }): EventRecord {
  const day = p.day ?? '2026-12-01';
  return {
    id: p.id ?? `e${seq++}`,
    source: 'feed',
    sourceKey: p.title,
    sourceName: 'test',
    haystack: p.haystack ?? haystackOf({ title: p.title }),
    url: p.url ?? 'https://example.test/e',
    startsAt: 'startsAt' in p ? p.startsAt! : Date.parse(`${day}T18:00:00Z`),
    day,
    tags: p.tags ?? [],
    fingerprint: p.fingerprint ?? fingerprintOf({ title: p.title, day, city: p.city }),
    firstSeenAt: p.firstSeenAt ?? NOW - DAY,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

const KEEN: Interest = {
  id: 'i1',
  rev: 0,
  updatedAt: ARMED,
  writerId: 'w',
  createdAt: ARMED,
  label: 'Everything',
  keywords: [],
  leadDays: 14,
};

const kinds = (list: { kind: string }[]) => list.map((n) => n.kind).sort();

describe('noticesFor', () => {
  it('announces a genuinely new event', () => {
    const got = noticesFor(ev({ title: 'New' }), [KEEN], new Set(), ctx());
    expect(got.map((n) => n.kind)).toContain('announced');
  });

  it('never announces anything the corpus already held when notifications were armed', () => {
    // The first-run storm: without this, arming replays every matching event in the corpus into
    // the lock screen at once.
    const old = ev({ title: 'Old', firstSeenAt: ARMED - DAY });
    expect(kinds(noticesFor(old, [KEEN], new Set(), ctx()))).not.toContain('announced');
  });

  it('never announces a backlog to a newly added interest', () => {
    // Adding an interest must surface its backlog in the feed and push about nothing.
    const fresh: Interest = { ...KEEN, createdAt: NOW - 60000 };
    const existing = ev({ title: 'Existing', firstSeenAt: NOW - 10 * DAY });
    expect(kinds(noticesFor(existing, [fresh], new Set(), ctx()))).not.toContain('announced');
  });

  it('is not re-armed by editing an interest', () => {
    // updatedAt moves on an edit; createdAt does not, and createdAt is what this reads.
    const edited: Interest = { ...KEEN, rev: 5, updatedAt: NOW - 1000 };
    const older = ev({ title: 'Older', firstSeenAt: ARMED + DAY });
    expect(kinds(noticesFor(older, [edited], new Set(), ctx()))).toContain('announced');
  });

  it('sends nothing at all before notifications have ever been armed', () => {
    expect(noticesFor(ev({ title: 'X' }), [KEEN], new Set(), ctx({ armedAt: null }))).toEqual([]);
  });

  it('ignores an event whose date has already passed', () => {
    const past = ev({ title: 'Gone', day: '2026-08-01', startsAt: NOW - 5 * DAY });
    expect(noticesFor(past, [KEEN], new Set(), ctx())).toEqual([]);
  });

  it('fires soon inside the lead time and not outside it', () => {
    const near = ev({ title: 'Near', startsAt: NOW + 10 * DAY, firstSeenAt: ARMED - DAY });
    const far = ev({ title: 'Far', startsAt: NOW + 90 * DAY, firstSeenAt: ARMED - DAY });
    expect(kinds(noticesFor(near, [KEEN], new Set(), ctx()))).toEqual(['soon']);
    expect(noticesFor(far, [KEEN], new Set(), ctx())).toEqual([]);
  });

  it('uses the LONGEST lead time among matching interests, not the shortest', () => {
    // leadDays means "how much warning I want", so any interest asking for 30 days gets 30.
    const patient: Interest = { ...KEEN, id: 'i2', leadDays: 45 };
    const event = ev({ title: 'X', startsAt: NOW + 30 * DAY, firstSeenAt: ARMED - DAY });
    expect(noticesFor(event, [KEEN], new Set(), ctx())).toEqual([]);
    expect(kinds(noticesFor(event, [KEEN, patient], new Set(), ctx()))).toEqual(['soon']);
  });

  it('emits ONE notice per kind however many interests matched', () => {
    // The interests are why it fired, not what fired. Two matches must not be two buzzes.
    const b: Interest = { ...KEEN, id: 'i2', label: 'Also' };
    const got = noticesFor(ev({ title: 'X' }), [KEEN, b], new Set(), ctx());
    expect(got.filter((n) => n.kind === 'announced')).toHaveLength(1);
    expect(got[0].interestIds).toEqual(['i1', 'i2']);
  });

  it('respects a notice a previous run already claimed', () => {
    const event = ev({ title: 'X' });
    const seen = new Set([noticeIdFor(event.fingerprint, 'announced')]);
    expect(kinds(noticesFor(event, [KEEN], seen, ctx()))).not.toContain('announced');
  });

  it('fires onsale on the transition the collector recorded', () => {
    const event = ev({
      title: 'X',
      firstSeenAt: ARMED - DAY,
      startsAt: NOW + 200 * DAY,
      onSaleSeenAt: NOW - 60000,
      ticketUrl: 'https://tickets.test/x',
    });
    expect(kinds(noticesFor(event, [KEEN], new Set(), ctx()))).toEqual(['onsale']);
  });

  it('does not fire onsale for a ticket link that predates arming', () => {
    const event = ev({
      title: 'X',
      firstSeenAt: ARMED - DAY,
      startsAt: NOW + 200 * DAY,
      onSaleSeenAt: ARMED - DAY,
    });
    expect(noticesFor(event, [KEEN], new Set(), ctx())).toEqual([]);
  });

  it('never pushes for a muted interest', () => {
    const muted: Interest = { ...KEEN, muted: true };
    expect(noticesFor(ev({ title: 'X' }), [muted], new Set(), ctx())).toEqual([]);
  });
});

describe('an event dismissed by hand', () => {
  it('is never notified about, however well it matches', () => {
    /*
     * The half of ignoring that is not on the screen. An ignore the collector never reads means
     * the card is gone from the feed and the phone still rings about it at 7am — which is the
     * reading of "ignore" nobody means, and the one that gets a push app deleted.
     */
    const event = ev({ title: 'Not going', startsAt: NOW + 3 * DAY });
    expect(kinds(noticesFor(event, [KEEN], new Set(), ctx()))).not.toEqual([]);
    expect(
      noticesFor(event, [KEEN], new Set(), ctx({ ignored: new Set([event.fingerprint]) })),
    ).toEqual([]);
  });

  it('claims no notice, so un-ignoring it gets its notifications back', () => {
    /*
     * Deliberately not latched. A claimed-but-unsent notice would silently consume the `soon`
     * reminder for an event brought back precisely because its date is wanted after all — and
     * un-ignoring is a deliberate act by the person who would receive the push, which is why this
     * is the one place the app prefers a possible extra send to a lost one.
     */
    const event = ev({ title: 'Reconsidered', startsAt: NOW + 3 * DAY });
    const plan = planRun([event], [KEEN], new Set(), ctx({ ignored: new Set([event.fingerprint]) }));
    expect(plan.send).toEqual([]);
    expect(plan.suppressed).toEqual([]);
    expect(plan.summary).toBeNull();

    // Nothing was written while it was ignored, so the latch is still open for it.
    expect(kinds(planRun([event], [KEEN], new Set(), ctx()).send)).toContain('soon');
  });

  it('silences the twin a second source listed, the key being the fingerprint', () => {
    const fp = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14' });
    const a = ev({ id: 'tw', title: 'Wesele Figara', fingerprint: fp });
    const b = ev({ id: 'tm', title: 'Wesele Figara', fingerprint: fp, ticketUrl: 'https://t.test/x' });
    expect(planRun([a, b], [KEEN], new Set(), ctx({ ignored: new Set([fp]) })).send).toEqual([]);
  });
});

describe('planRun', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      ev({ title: `Event ${i}`, day: `2026-12-${String(i + 1).padStart(2, '0')}` }),
    );

  it('caps announcements and rolls the rest into one summary', () => {
    // The realistic flood: a scrape's markup shifts, every synthesised key changes, and an entire
    // season looks new.
    const plan = planRun(many(20), [KEEN], new Set(), ctx({ maxPerRun: 3 }));
    expect(plan.send.filter((n) => n.kind === 'announced')).toHaveLength(3);
    expect(plan.summary?.count).toBe(17);
  });

  it('still latches the suppressed ones, so they never fire individually later', () => {
    const plan = planRun(many(20), [KEEN], new Set(), ctx({ maxPerRun: 3 }));
    expect(plan.suppressed).toHaveLength(17);
    const all = new Set([...plan.send, ...plan.suppressed].map((n) => n.noticeId));
    expect(all.size).toBe(plan.send.length + plan.suppressed.length);
  });

  it('has no summary when nothing was suppressed', () => {
    expect(planRun(many(2), [KEEN], new Set(), ctx()).summary).toBeNull();
  });

  it('drops the most distant first', () => {
    const plan = planRun(many(10), [KEEN], new Set(), ctx({ maxPerRun: 2 }));
    const sent = plan.send.filter((n) => n.kind === 'announced');
    expect(sent.map((n) => n.title)).toEqual(['Event 0', 'Event 1']);
  });

  it('exempts onsale from the announcement cap', () => {
    // Tickets going on sale is the thing he actually asked for, and it is not noise.
    const onsale = Array.from({ length: 6 }, (_, i) =>
      ev({
        title: `Sale ${i}`,
        day: `2027-06-${String(i + 1).padStart(2, '0')}`,
        firstSeenAt: ARMED - DAY,
        onSaleSeenAt: NOW - 60000,
      }),
    );
    const plan = planRun(onsale, [KEEN], new Set(), ctx({ maxPerRun: 1 }));
    expect(plan.send.filter((n) => n.kind === 'onsale')).toHaveLength(6);
  });

  it('notifies once for one concert listed by two sources', () => {
    // Ticketmaster and the Teatr Wielki scrape both list the same Nozze. The notice id is keyed
    // on the fingerprint precisely so this is one buzz.
    const shared = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14', city: 'Warszawa' });
    const a = ev({ id: 'tm_1', title: 'Wesele Figara', fingerprint: shared });
    const b = ev({ id: 'tw_1', title: 'WESELE FIGARA', fingerprint: shared });
    const plan = planRun([a, b], [KEEN], new Set(), ctx());
    expect(plan.send.filter((n) => n.kind === 'announced')).toHaveLength(1);
  });
});
