import { describe, expect, it } from 'vitest';
import { bySource, filteringOf } from './filtering';
import { fingerprintOf, haystackOf } from './normalize';
import type { EventRecord, Interest } from './types';

const NOW = Date.parse('2026-09-14T12:00:00Z');

let n = 0;
function ev(p: Partial<EventRecord> & { title: string }): EventRecord {
  const day = p.day ?? '2026-12-01';
  return {
    id: p.id ?? `e${n++}`,
    source: p.source ?? 'feed',
    sourceKey: p.title,
    sourceName: 'test',
    haystack: haystackOf({ title: p.title }),
    url: 'https://example.test/e',
    startsAt: Date.parse(`${day}T18:00:00Z`),
    day,
    tags: p.tags ?? [],
    fingerprint: fingerprintOf({ title: p.title, day }),
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

const interest = (over: Partial<Interest> & { id: string; label: string }): Interest => ({
  rev: 0,
  updatedAt: NOW,
  writerId: 'w',
  createdAt: 0,
  keywords: [],
  leadDays: 14,
  ...over,
});

const KLEZMER = interest({ id: 'k', label: 'Klezmer', keywords: ['klezmer*'] });
const RUNNING = interest({ id: 'r', label: 'Running', tags: ['running'] });

describe('filteringOf', () => {
  const rows = [
    ev({ title: 'Koncert klezmerski' }),
    ev({ title: 'Wieczór klezmerski' }),
    ev({ title: '48. Maraton Warszawski', tags: ['running'] }),
    ev({ title: 'Ted Kaczynski, a biography' }),
  ];

  it('counts each interest over this source’s rows', () => {
    const { filters } = filteringOf(rows, [KLEZMER, RUNNING]);
    expect(filters.map((f) => [f.interest.id, f.kept])).toEqual([
      ['k', 2],
      ['r', 1],
    ]);
  });

  it('says how much of the source reaches the feed at all', () => {
    // Rows, not matches: an event two interests keep is one row reaching the feed, and adding them
    // up would report more rows kept than the source produced.
    expect(filteringOf(rows, [KLEZMER, RUNNING])).toMatchObject({ rows: 4, kept: 3 });
  });

  it('counts a row once however many interests keep it', () => {
    const both = ev({ title: 'Klezmer w biegu', tags: ['running'] });
    expect(filteringOf([both], [KLEZMER, RUNNING])).toMatchObject({ rows: 1, kept: 1 });
  });

  it('leaves out an interest that reaches nothing here, and counts it instead', () => {
    /*
     * Every interest under every source is five copies of one list, and a zero is not read per
     * source anyway — an interest matching nothing *anywhere* is a dead interest, which is the
     * Interests tab's question. What this number answers is narrower: how much of what you have
     * asked for has anything to say about this page.
     */
    const opera = interest({ id: 'o', label: 'Opera', tags: ['opera'] });
    const got = filteringOf(rows, [KLEZMER, opera]);
    expect(got.filters.map((f) => f.interest.id)).toEqual(['k']);
    expect(got.silent).toBe(1);
  });

  it('keeps a muted interest, which still filters the feed', () => {
    // Muting says "do not wake me", not "stop showing me" — dropping it here would report a source
    // as unwatched when it is merely quiet.
    const muted = { ...KLEZMER, muted: true };
    expect(filteringOf(rows, [muted]).filters).toHaveLength(1);
  });

  it('ignores a deleted interest, tombstone and all', () => {
    const gone = { ...KLEZMER, deleted: true };
    expect(filteringOf(rows, [gone])).toMatchObject({ kept: 0, filters: [], silent: 0 });
  });

  it('orders by what each keeps, then by name, so nothing reshuffles on a tie', () => {
    const a = interest({ id: 'a', label: 'Bravo', keywords: ['klezmer*'] });
    const b = interest({ id: 'b', label: 'Alpha', keywords: ['klezmer*'] });
    expect(filteringOf(rows, [a, b]).filters.map((f) => f.interest.label)).toEqual([
      'Alpha',
      'Bravo',
    ]);
  });

  it('reports an empty source honestly rather than as a filter problem', () => {
    expect(filteringOf([], [KLEZMER])).toMatchObject({ rows: 0, kept: 0, silent: 1 });
  });
});

describe('bySource', () => {
  it('splits on the adapter, which is what health and the catalogue are keyed on', () => {
    const corpus = [
      ev({ title: 'A', source: 'feed' }),
      ev({ title: 'B', source: 'elektroniczne-zapisy' }),
      ev({ title: 'C', source: 'feed' }),
    ];
    const grouped = bySource(corpus);
    expect(grouped.get('feed')?.map((e) => e.title)).toEqual(['A', 'C']);
    expect(grouped.get('elektroniczne-zapisy')).toHaveLength(1);
    expect(grouped.get('ticketmaster')).toBeUndefined();
  });
});
