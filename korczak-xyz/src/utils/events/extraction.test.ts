import { describe, expect, it } from 'vitest';
import { hasValue, modelPasses } from './extraction';
import { fingerprintOf, haystackOf } from './normalize';
import type { EventRecord } from './types';

const NOW = Date.parse('2026-09-14T12:00:00Z');

let n = 0;
function ev(p: Partial<EventRecord> & { title: string }): EventRecord {
  const day = p.day ?? '2026-12-01';
  return {
    id: p.id ?? `e${n++}`,
    source: 'teatr-wielki',
    sourceKey: p.title,
    sourceName: 'test',
    haystack: haystackOf({ title: p.title }),
    url: 'https://example.test/e',
    startsAt: 'startsAt' in p ? p.startsAt! : Date.parse(`${day}T18:00:00Z`),
    day,
    tags: p.tags ?? [],
    fingerprint: fingerprintOf({ title: p.title, day }),
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

describe('hasValue', () => {
  it('reads null, the empty string and the empty array as absent', () => {
    // The three ways a field is written and still says nothing. `tags: []` is the one that matters:
    // it is always written, so counting on `!== undefined` would report every row as tagged.
    expect(hasValue(ev({ title: 'X', startsAt: null }), 'startsAt')).toBe(false);
    expect(hasValue(ev({ title: 'X', tags: [] }), 'tags')).toBe(false);
    expect(hasValue(ev({ title: 'X', city: '' }), 'city')).toBe(false);
    expect(hasValue(ev({ title: 'X', tags: ['opera'] }), 'tags')).toBe(true);
  });

  it('counts a false verdict as an answer, which it is', () => {
    // `newsroomTicketSale: false` is the reader having read the article and said no. Read as
    // absent, every article it cleared would look like one it never reached.
    expect(hasValue(ev({ title: 'X', newsroomTicketSale: false }), 'newsroomTicketSale')).toBe(true);
  });
});

describe('modelPasses', () => {
  const article = (p: Partial<EventRecord> = {}) =>
    ev({ title: 'Wkrótce ogłoszenie nowego sezonu', tags: ['newsroom', 'theatre'], ...p });
  const listing = (p: Partial<EventRecord> = {}) => ev({ title: 'Wesele Figara', ...p });

  it('splits the rows by the tag, because that is what decides which pass reads them', () => {
    /*
     * `needsClassifying` skips a newsroom row outright and the reader reads nothing else, so a
     * source that starts tagging its pages moves between the two passes with no code changing —
     * and a table describing the split per source would be wrong with nothing to catch it.
     */
    const passes = modelPasses([article(), article(), listing()]);
    expect(passes.map((p) => [p.pass, p.rows])).toEqual([
      ['classifier', 1],
      ['newsroom', 2],
    ]);
  });

  it('leaves out a pass with nothing to read, and keeps one with nothing answered', () => {
    // The two states this is drawn for. A source the reader never touches is not a fault; a source
    // the classifier should have reached and has not is the way this app fails quietly.
    const passes = modelPasses([listing(), listing()]);
    expect(passes.map((p) => p.pass)).toEqual(['classifier']);
    expect(passes[0]).toMatchObject({ rows: 2, answered: 0 });
  });

  it('counts an answer by the stamp, not by any one verdict', () => {
    /*
     * The call answers three questions and may come back with two of them. Counted on `reach`, a
     * classifier that declined to guess would report as partly stopped — and the queue it is meant
     * to show would never empty.
     */
    const passes = modelPasses([listing({ classifiedAt: NOW, kind: 'listing', country: 'PL' })]);
    expect(passes[0].answered).toBe(1);
  });

  it('counts each field on its own, which is where a partial verdict shows', () => {
    const passes = modelPasses([
      listing({ classifiedAt: NOW, kind: 'listing', reach: 'local', country: 'PL' }),
      listing({ classifiedAt: NOW, kind: 'listing', country: 'PL' }),
    ]);
    expect(passes[0].fields).toEqual([
      { field: 'kind', present: 2 },
      { field: 'reach', present: 1 },
      { field: 'country', present: 2, shared: true },
    ]);
  });

  it('marks the fields a source states itself, so a full count is not a contradiction', () => {
    // Every Teatr Wielki row is `PL` from the moment it is scraped. Unmarked, `country 40` beside
    // `12 of 40 answered` reads as two numbers that cannot both be true.
    const passes = modelPasses([listing({ country: 'PL' })]);
    expect(passes[0].fields.find((f) => f.field === 'country')?.shared).toBe(true);
    expect(passes[0].fields.find((f) => f.field === 'kind')?.shared).toBeUndefined();
  });

  it('reports the reader against the articles alone', () => {
    const passes = modelPasses([
      article({ newsroomReadAt: NOW, newsroomTicketSale: true, onSaleAt: NOW + 86400000 }),
      article({ newsroomReadAt: NOW, newsroomTicketSale: false }),
      article(),
    ]);
    const reader = passes.find((p) => p.pass === 'newsroom')!;
    expect(reader).toMatchObject({ rows: 3, answered: 2 });
    expect(reader.fields).toEqual([
      { field: 'newsroomTicketSale', present: 2 },
      { field: 'onSaleAt', present: 1, shared: true },
    ]);
  });

  it('says nothing at all about an empty source', () => {
    expect(modelPasses([])).toEqual([]);
  });
});
