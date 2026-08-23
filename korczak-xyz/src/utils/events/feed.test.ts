import { describe, expect, it } from 'vitest';
import { buildFeed, dedupeByFingerprint, groupOf } from './feed';
import { fingerprintOf, haystackOf } from './normalize';
import type { EventRecord, Interest } from './types';

const DAY = 86400000;
const NOW = Date.parse('2026-08-23T12:00:00Z');

let n = 0;
function ev(p: Partial<EventRecord> & { title: string }): EventRecord {
  const day = p.day ?? '2026-12-01';
  return {
    id: p.id ?? `e${n++}`,
    source: 'feed',
    sourceKey: p.title,
    sourceName: 'test',
    title: p.title,
    haystack: p.haystack ?? haystackOf({ title: p.title, tags: p.tags }),
    url: 'https://example.test/e',
    startsAt: 'startsAt' in p ? p.startsAt! : Date.parse(`${day}T18:00:00Z`),
    day,
    tags: p.tags ?? [],
    fingerprint: p.fingerprint ?? fingerprintOf({ title: p.title, day }),
    firstSeenAt: p.firstSeenAt ?? NOW - DAY,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

const ALL: Interest = {
  id: 'i1', rev: 0, updatedAt: NOW, writerId: 'w', createdAt: 0,
  label: 'Everything', keywords: [], leadDays: 14,
};

describe('dedupeByFingerprint', () => {
  it('keeps the copy that has a ticket link', () => {
    // Ticketmaster and a scrape of the same night. Showing both makes the app look broken; the
    // one you can buy from is the one worth keeping.
    const fp = fingerprintOf({ title: 'Wesele Figara', day: '2027-01-14' });
    const scraped = ev({ id: 'tw', title: 'Wesele Figara', fingerprint: fp, firstSeenAt: 1 });
    const sold = ev({
      id: 'tm', title: 'Wesele Figara', fingerprint: fp, firstSeenAt: 9,
      ticketUrl: 'https://tickets.test/x',
    });
    expect(dedupeByFingerprint([scraped, sold]).map((e) => e.id)).toEqual(['tm']);
    // ...and the answer does not depend on the order they arrived in.
    expect(dedupeByFingerprint([sold, scraped]).map((e) => e.id)).toEqual(['tm']);
  });

  it('falls back to the one seen first, so the choice is stable', () => {
    const fp = fingerprintOf({ title: 'X', day: '2027-01-14' });
    const older = ev({ id: 'a', title: 'X', fingerprint: fp, firstSeenAt: 1 });
    const newer = ev({ id: 'b', title: 'X', fingerprint: fp, firstSeenAt: 9 });
    expect(dedupeByFingerprint([newer, older]).map((e) => e.id)).toEqual(['a']);
  });

  it('leaves genuinely different events alone', () => {
    expect(dedupeByFingerprint([ev({ title: 'A' }), ev({ title: 'B' })])).toHaveLength(2);
  });
});

describe('groupOf', () => {
  it('buckets by how soon, with undated last', () => {
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 3 * DAY }), NOW)).toBe('week');
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 20 * DAY }), NOW)).toBe('month');
    expect(groupOf(ev({ title: 'X', startsAt: NOW + 200 * DAY }), NOW)).toBe('later');
    expect(groupOf(ev({ title: 'X', startsAt: null, day: null }), NOW)).toBe('undated');
  });
});

describe('buildFeed', () => {
  it('drops what has already happened', () => {
    const past = ev({ title: 'Gone', startsAt: NOW - 5 * DAY });
    expect(buildFeed([past], [ALL], NOW)).toEqual([]);
  });

  it('shows a muted interest’s matches', () => {
    // Muting says "do not wake me", not "hide it from me". Conflating the two makes a muted
    // interest indistinguishable from a deleted one.
    const muted: Interest = { ...ALL, muted: true };
    const sections = buildFeed([ev({ title: 'X' })], [muted], NOW);
    expect(sections[0].items).toHaveLength(1);
  });

  it('hides everything when no interest matches', () => {
    const narrow: Interest = { ...ALL, keywords: ['klezmer'] };
    expect(buildFeed([ev({ title: 'Techno' })], [narrow], NOW)).toEqual([]);
  });

  it('shows unmatched events when asked to show everything', () => {
    const narrow: Interest = { ...ALL, keywords: ['klezmer'] };
    const sections = buildFeed([ev({ title: 'Techno' })], [narrow], NOW, { matchedOnly: false });
    expect(sections[0].items[0].matched).toEqual([]);
  });

  it('orders chronologically and groups in reading order', () => {
    const sections = buildFeed(
      [
        ev({ title: 'Far', startsAt: NOW + 100 * DAY }),
        ev({ title: 'Undated', startsAt: null, day: null }),
        ev({ title: 'Soon', startsAt: NOW + 2 * DAY }),
        ev({ title: 'Mid', startsAt: NOW + 20 * DAY }),
      ],
      [ALL],
      NOW,
    );
    expect(sections.map((s) => s.group)).toEqual(['week', 'month', 'later', 'undated']);
    expect(sections[0].items[0].event.title).toBe('Soon');
  });

  it('omits an empty group rather than rendering a bare heading', () => {
    const sections = buildFeed([ev({ title: 'Soon', startsAt: NOW + 2 * DAY })], [ALL], NOW);
    expect(sections.map((s) => s.group)).toEqual(['week']);
  });

  it('records which interests matched, so a row can say why it is there', () => {
    const klezmer: Interest = { ...ALL, id: 'k', label: 'Klezmer', keywords: ['klezmer*'] };
    const sections = buildFeed([ev({ title: 'Koncert klezmerski' })], [ALL, klezmer], NOW);
    expect(sections[0].items[0].matched.map((i) => i.label)).toEqual(['Everything', 'Klezmer']);
  });
});
