import { describe, expect, it } from 'vitest';
import { LEAD_DAYS, noticesFor, planRun, type PlanContext } from './notices';
import { ALL_SOURCES_ON, setSourceCity, setSourceEnabled } from './sourcePrefs';
import { fingerprintOf, noticeIdFor } from './normalize';
import type { EventRecord } from './types';

const DAY = 86400000;
const NOW = Date.parse('2026-08-23T12:00:00Z');
const ARMED = NOW - 30 * DAY;

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  armedAt: ARMED,
  maxPerRun: 3,
  maxOnSalePerRun: 10,
  maxSoonPerRun: 5,
  sources: ALL_SOURCES_ON,
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

const kinds = (list: { kind: string }[]) => list.map((n) => n.kind).sort();

describe('noticesFor', () => {
  it('announces a genuinely new event', () => {
    const got = noticesFor(ev({ title: 'New' }), new Set(), ctx());
    expect(got.map((n) => n.kind)).toContain('announced');
  });

  it('announces anything an enabled source collected, nothing having to ask for it', () => {
    /*
     * The trade the interests paid for and no longer do: a row nobody wrote a keyword for is now a
     * row that can wake you. What narrows this is the source switch and the caps below.
     */
    const obscure = ev({ title: 'Zabierz PIESia do Międzylesia' });
    expect(kinds(noticesFor(obscure, new Set(), ctx()))).toContain('announced');
  });

  it('never announces anything the corpus already held when notifications were armed', () => {
    // The first-run storm: without this, arming replays every event in the corpus into the lock
    // screen at once.
    const old = ev({ title: 'Old', firstSeenAt: ARMED - DAY });
    expect(kinds(noticesFor(old, new Set(), ctx()))).not.toContain('announced');
  });

  it('sends nothing at all before notifications have ever been armed', () => {
    expect(noticesFor(ev({ title: 'X' }), new Set(), ctx({ armedAt: null }))).toEqual([]);
  });

  it('ignores an event whose date has already passed', () => {
    const past = ev({ title: 'Gone', day: '2026-08-01', startsAt: NOW - 5 * DAY });
    expect(noticesFor(past, new Set(), ctx())).toEqual([]);
  });

  it('fires soon inside the lead time and not outside it', () => {
    const near = ev({ title: 'Near', startsAt: NOW + 10 * DAY, firstSeenAt: ARMED - DAY });
    const far = ev({ title: 'Far', startsAt: NOW + 90 * DAY, firstSeenAt: ARMED - DAY });
    expect(kinds(noticesFor(near, new Set(), ctx()))).toEqual(['soon']);
    expect(noticesFor(far, new Set(), ctx())).toEqual([]);
    expect(LEAD_DAYS).toBe(14);
  });

  it('emits ONE notice per kind per event', () => {
    const got = noticesFor(ev({ title: 'X' }), new Set(), ctx());
    expect(got.filter((n) => n.kind === 'announced')).toHaveLength(1);
  });

  it('respects a notice a previous run already claimed', () => {
    const event = ev({ title: 'X' });
    const seen = new Set([noticeIdFor(event.fingerprint, 'announced')]);
    expect(kinds(noticesFor(event, seen, ctx()))).not.toContain('announced');
  });

  it('fires onsale on the transition the collector recorded', () => {
    const event = ev({
      title: 'X',
      firstSeenAt: ARMED - DAY,
      startsAt: NOW + 200 * DAY,
      onSaleSeenAt: NOW - 60000,
      ticketUrl: 'https://tickets.test/x',
    });
    expect(kinds(noticesFor(event, new Set(), ctx()))).toEqual(['onsale']);
  });

  it('does not fire onsale for a ticket link that predates arming', () => {
    const event = ev({
      title: 'X',
      firstSeenAt: ARMED - DAY,
      startsAt: NOW + 200 * DAY,
      onSaleSeenAt: ARMED - DAY,
    });
    expect(noticesFor(event, new Set(), ctx())).toEqual([]);
  });

  /*
   * The push body is built from the notice and never from the event, so a distance that stops here
   * is a lock screen saying only `XVII Bieg Ziemi Puckiej` — a name, with no way to tell whether
   * it is worth getting up for.
   */
  it('carries a race distance through to the notice', () => {
    const race = ev({ title: 'Maraton Warszawski', tags: ['running'], distancesM: [42195] });
    const [notice] = noticesFor(race, new Set(), ctx());
    expect(notice.distancesM).toEqual([42195]);
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
    const plan = planRun(many(20), new Set(), ctx({ maxPerRun: 3 }));
    expect(plan.send.filter((n) => n.kind === 'announced')).toHaveLength(3);
    expect(plan.summary?.count).toBe(17);
  });

  it('still latches the suppressed ones, so they never fire individually later', () => {
    const plan = planRun(many(20), new Set(), ctx({ maxPerRun: 3 }));
    expect(plan.suppressed).toHaveLength(17);
    const all = new Set([...plan.send, ...plan.suppressed].map((n) => n.noticeId));
    expect(all.size).toBe(plan.send.length + plan.suppressed.length);
  });

  it('has no summary when nothing was suppressed', () => {
    expect(planRun(many(2), new Set(), ctx()).summary).toBeNull();
  });

  it('drops the most distant first', () => {
    const plan = planRun(many(10), new Set(), ctx({ maxPerRun: 2 }));
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
    const plan = planRun(onsale, new Set(), ctx({ maxPerRun: 1 }));
    expect(plan.send.filter((n) => n.kind === 'onsale')).toHaveLength(6);
  });

  it('notifies once for one concert listed by two sources', () => {
    // Ticketmaster and the Teatr Wielki scrape both list the same Nozze. The notice id is keyed
    // on the fingerprint precisely so this is one buzz.
    const shared = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14', city: 'Warszawa' });
    const a = ev({ id: 'tm_1', title: 'Wesele Figara', fingerprint: shared });
    const b = ev({ id: 'tw_1', title: 'WESELE FIGARA', fingerprint: shared });
    const plan = planRun([a, b], new Set(), ctx());
    expect(plan.send.filter((n) => n.kind === 'announced')).toHaveLength(1);
  });
});

/*
 * The cap `soon` grew when the interests went.
 *
 * It had none, and did not need one: a reminder fired only for a row an interest had named, so the
 * ceiling was the length of a hand-written list. With the whole corpus eligible, a fortnight's lead
 * over a national race listing is a morning of buzzing about races in towns nobody chose.
 */
describe('the soon cap', () => {
  const near = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      ev({
        title: `Race ${i}`,
        // All within the lead, a day apart, so the sort has something to rank them by.
        startsAt: NOW + (i + 1) * (DAY / 2),
        firstSeenAt: ARMED - DAY,
      }),
    );

  it('sends the soonest and drops the rest', () => {
    const plan = planRun(near(20), new Set(), ctx({ maxSoonPerRun: 5 }));
    const soon = plan.send.filter((n) => n.kind === 'soon');
    expect(soon).toHaveLength(5);
    expect(soon.map((n) => n.title)).toEqual(['Race 0', 'Race 1', 'Race 2', 'Race 3', 'Race 4']);
  });

  it('does not latch what it dropped, so the next run can still warn about it', () => {
    /*
     * The opposite of `announced`, and deliberately. An announcement is a one-off, so an unclaimed
     * suppression only postpones the flood; a countdown is asked again every run, and the events
     * dropped today rise to the top of the sort as they get nearer. Latching them would silence
     * exactly the ones about to become worth a reminder.
     */
    const plan = planRun(near(20), new Set(), ctx({ maxSoonPerRun: 5 }));
    expect(plan.suppressed.filter((n) => n.kind === 'soon')).toEqual([]);

    const sent = new Set(plan.send.map((n) => n.noticeId));
    const next = planRun(near(20), sent, ctx({ maxSoonPerRun: 5 }));
    expect(next.send.filter((n) => n.kind === 'soon').map((n) => n.title)).toEqual([
      'Race 5',
      'Race 6',
      'Race 7',
      'Race 8',
      'Race 9',
    ]);
  });

  it('does not eat the ticket budget, the two being different questions', () => {
    const soon = near(20);
    const sale = ev({
      title: 'Season sale',
      startsAt: null,
      day: null,
      onSaleAt: NOW + 3 * DAY,
      firstSeenAt: ARMED - DAY,
    } as Partial<EventRecord> & { title: string });
    const plan = planRun([...soon, sale], new Set(), ctx({ maxSoonPerRun: 5 }));
    expect(plan.send.filter((n) => n.kind === 'presale')).toHaveLength(1);
    expect(plan.send.filter((n) => n.kind === 'soon')).toHaveLength(5);
  });
});

/*
 * `presale` — the notice this app grew a fourth kind for.
 *
 * `onsale` can only fire once a ticket link has appeared, which for a Teatr Wielki season is news
 * that arrives on the morning the good seats sell. The date, though, is stated weeks ahead in the
 * theatre's own news, and this is what counts down to it.
 */
describe('presale', () => {
  const sale = (at: string, over: Partial<EventRecord> = {}) =>
    ev({
      title: 'Sprzedaż biletów na sezon 2027/28',
      // An announcement is an article: no date of its own. That is the shape this must work for.
      startsAt: null,
      day: null,
      onSaleAt: Date.parse(at),
      firstSeenAt: ARMED - 10 * DAY,
      ...over,
    } as Partial<EventRecord> & { title: string });

  it('warns LEAD_DAYS before the sale opens', () => {
    // 10 days out, against a 14-day lead.
    const got = noticesFor(sale('2026-09-02T09:00:00Z'), new Set(), ctx());
    expect(got.map((n) => n.kind)).toContain('presale');
  });

  it('says nothing while the sale is further out than the lead', () => {
    const got = noticesFor(sale('2026-11-02T09:00:00Z'), new Set(), ctx());
    expect(got.map((n) => n.kind)).not.toContain('presale');
  });

  it('never warns about a sale that has already opened', () => {
    /*
     * Most of the corpus is in this state — every Ticketmaster row carries the date its sale
     * opened, usually months ago. Warning about those is warning about the past, and it is how a
     * feature meant to fire once a season fires a hundred times on its first run.
     */
    const got = noticesFor(sale('2026-08-01T09:00:00Z'), new Set(), ctx());
    expect(got.map((n) => n.kind)).not.toContain('presale');
  });

  it('warns about a sale announced long before this run', () => {
    /*
     * Deliberately not gated on `isFresh`, unlike `announced`. A date-based reminder is not an
     * announcement: a sale announced last month is exactly the one worth a warning today.
     */
    const got = noticesFor(sale('2026-09-02T09:00:00Z'), new Set(), ctx());
    expect(got.map((n) => n.kind)).toContain('presale');
  });

  it('is silent until notifications have been armed', () => {
    const got = noticesFor(sale('2026-09-02T09:00:00Z'), new Set(), ctx({ armedAt: null }));
    expect(got).toEqual([]);
  });

  it('fires once and stays fired, the notice document being the latch', () => {
    const event = sale('2026-09-02T09:00:00Z');
    const seen = new Set([noticeIdFor(event.fingerprint, 'presale')]);
    expect(noticesFor(event, seen, ctx()).map((n) => n.kind)).not.toContain('presale');
  });

  it('carries the sale moment on the notice, which is what the body has to name', () => {
    const at = Date.parse('2026-09-02T09:00:00Z');
    const got = noticesFor(sale('2026-09-02T09:00:00Z'), new Set(), ctx());
    expect(got.find((n) => n.kind === 'presale')!.onSaleAt).toBe(at);
  });

  it('ranks by the sale date, not by the article having none', () => {
    /*
     * The reason `noticeAt` exists, and it is the cap that makes it matter. A sale announcement
     * has a null `startsAt`, so ordering on that field alone sorts every one of them behind every
     * dated notice in the run — and then the budget below keeps whichever the tail happened to
     * hold rather than the sale that opens first.
     */
    const imminent = sale('2026-08-25T09:00:00Z', { id: 'sale-soon', title: 'Sale in two days' });
    const distant = sale('2026-09-05T09:00:00Z', { id: 'sale-later', title: 'Sale in a fortnight' });
    const plan = planRun([distant, imminent], new Set(), ctx({ maxOnSalePerRun: 1 }));
    expect(plan.send.map((n) => n.title)).toEqual(['Sale in two days']);
  });

  it('shares the ticket budget with onsale rather than getting one of its own', () => {
    /*
     * Both say "there is a thing to buy". A source that starts stating sale dates across its whole
     * catalogue must not be able to walk past the cap by arriving under a second name.
     */
    const sales = Array.from({ length: 5 }, (_, i) =>
      sale('2026-09-02T09:00:00Z', { id: `s${i}`, title: `Sale ${i}` }),
    );
    const plan = planRun(sales, new Set(), ctx({ maxOnSalePerRun: 2 }));
    expect(plan.send.filter((n) => n.kind === 'presale')).toHaveLength(2);
  });

  it('is not rolled into the announced summary, being the thing that was asked for', () => {
    const plan = planRun([sale('2026-09-02T09:00:00Z')], new Set(), ctx({ maxPerRun: 0 }));
    expect(plan.send.map((n) => n.kind)).toContain('presale');
    expect(plan.suppressed).toEqual([]);
  });
});

/*
 * The Sources tab's switches, which since the interests went are the only rule here that can
 * silence anything at all.
 *
 * Two halves that are easy to mistake for one: *while* a source is off nothing at all is produced
 * for it, and *after* it comes back on its backlog is history rather than news. The second half is
 * the one worth a test — it is invisible until the day somebody taps the box back on, and getting
 * it wrong delivers exactly the flood the box exists to stop.
 */
describe('a source switched off', () => {
  const OFF = setSourceEnabled({}, 'feed', false, NOW - 10 * DAY);

  it('says nothing at all about its events', () => {
    expect(noticesFor(ev({ title: 'X' }), new Set(), ctx())).not.toEqual([]);
    expect(noticesFor(ev({ title: 'X' }), new Set(), ctx({ sources: OFF }))).toEqual([]);
  });

  it('silences a sale warning too, not only the announcement', () => {
    const event = ev({
      title: 'Season',
      startsAt: null,
      day: null,
      onSaleAt: NOW + 3 * DAY,
    });
    expect(kinds(noticesFor(event, new Set(), ctx()))).toContain('presale');
    expect(noticesFor(event, new Set(), ctx({ sources: OFF }))).toEqual([]);
  });

  it('leaves the other sources alone', () => {
    const race = ev({ title: 'X', source: 'elektroniczne-zapisy' });
    expect(noticesFor(race, new Set(), ctx({ sources: OFF }))).not.toEqual([]);
  });

  it('latches nothing, so switching it back on does not eat its reminders', () => {
    const near = ev({ title: 'Soon', day: '2026-08-30' });
    const plan = planRun([near], new Set(), ctx({ sources: OFF }));
    expect(plan.send).toEqual([]);
    expect(plan.suppressed).toEqual([]);
  });
});

describe('a source narrowed to one town', () => {
  const WAW = setSourceCity({}, 'elektroniczne-zapisy', 'Warszawa', ARMED);

  it('notifies about that town and says nothing about the others', () => {
    const here = ev({ title: 'Maraton', source: 'elektroniczne-zapisy', city: 'Warszawa' });
    const there = ev({ title: 'Dycha', source: 'elektroniczne-zapisy', city: 'Gdańsk' });
    expect(noticesFor(here, new Set(), ctx({ sources: WAW }))).not.toEqual([]);
    expect(noticesFor(there, new Set(), ctx({ sources: WAW }))).toEqual([]);
  });

  it('latches nothing for the other towns, so widening it again keeps their reminders', () => {
    const near = ev({ title: 'Soon', source: 'elektroniczne-zapisy', city: 'Gdańsk', day: '2026-08-30' });
    const plan = planRun([near], new Set(), ctx({ sources: WAW }));
    expect(plan.send).toEqual([]);
    expect(plan.suppressed).toEqual([]);
  });
});

describe('a source switched back on', () => {
  const BACK_AT = NOW - 2 * DAY;
  const BACK = setSourceEnabled(setSourceEnabled({}, 'feed', false, NOW - 30 * DAY), 'feed', true, BACK_AT);

  it('does not announce the backlog collected while it was off', () => {
    // Newer than `armedAt`, so the one remaining clock would let it through — which is exactly the
    // flood the switch was reached for.
    const backlog = ev({ title: 'Collected while off', firstSeenAt: BACK_AT - DAY });
    expect(kinds(noticesFor(backlog, new Set(), ctx()))).toContain('announced');
    expect(kinds(noticesFor(backlog, new Set(), ctx({ sources: BACK })))).not.toContain('announced');
  });

  it('announces what turns up after the tap', () => {
    const fresh = ev({ title: 'Collected after', firstSeenAt: BACK_AT + 1000 });
    expect(kinds(noticesFor(fresh, new Set(), ctx({ sources: BACK })))).toContain('announced');
  });

  it('still reminds about a date that is close, backlog or not', () => {
    // A date-based reminder is not an announcement — the rule `presale` already states. A race next
    // week is next week whenever the row happened to be collected, and the reader turned the source
    // back on to hear about exactly that.
    const near = ev({ title: 'Soon', day: '2026-08-30', firstSeenAt: BACK_AT - DAY });
    expect(kinds(noticesFor(near, new Set(), ctx({ sources: BACK })))).toContain('soon');
  });
});
