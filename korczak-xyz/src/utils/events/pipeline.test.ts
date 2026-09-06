import { describe, expect, it } from 'vitest';
import {
  ABSENT,
  applyFacets,
  chosenCount,
  FACET_KEYS,
  facetsOf,
  FIELD_STAGES,
  matchesFacets,
  NO_FACETS,
  OPTIONAL_FIELDS,
  PIPELINE_STAGES,
  stageBlocks,
  toggleFacet,
  type FacetKey,
  type FacetSelection,
} from './pipeline';
import type { EventRecord } from './types';

function event(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'feed_a',
    source: 'feed',
    sourceKey: 'a',
    sourceName: 'historia.org.pl',
    title: 'A thing',
    haystack: 'a thing',
    url: 'https://example.test/a',
    startsAt: null,
    day: null,
    tags: [],
    fingerprint: 'fp-a',
    firstSeenAt: 1,
    updatedAt: 2,
    ...over,
  };
}

const pick = (entries: Array<[FacetKey, string[]]>): FacetSelection =>
  new Map(entries.map(([key, values]) => [key, new Set(values)]));

describe('stageBlocks', () => {
  it('returns every stage, so a pass that has not run shows as empty rather than as missing', () => {
    // The whole point of the tab: a row nothing has classified and a row that was classified are
    // different things, and a heading that simply is not drawn says neither.
    const blocks = stageBlocks(event());
    expect(blocks.map((b) => b.stage)).toEqual(PIPELINE_STAGES.filter((s) => s !== 'other'));
    expect(blocks.find((b) => b.stage === 'classifier')!.fields).toEqual({});
  });

  it('files each field under the pass that wrote it', () => {
    const blocks = stageBlocks(
      event({ city: 'Warszawa', reach: 'local', newsroomKind: 'ticket-sale', country: 'PL' }),
    );
    const fieldsOf = (stage: string) =>
      Object.keys(blocks.find((b) => b.stage === stage)!.fields);

    expect(fieldsOf('scraped')).toContain('city');
    expect(fieldsOf('derived')).toContain('haystack');
    expect(fieldsOf('classifier')).toContain('reach');
    expect(fieldsOf('newsroom')).toContain('newsroomKind');
    // More than one pass can write these, and saying otherwise would be a claim the record
    // cannot support — `mergeRecord` takes the source's country and keeps the model's otherwise.
    expect(fieldsOf('shared')).toEqual(expect.arrayContaining(['country', 'tags']));
    expect(fieldsOf('bookkeeping')).toContain('firstSeenAt');
  });

  it('puts a field this build has never heard of in `other` rather than dropping it', () => {
    // A rollback, or a deploy in flight. A field that vanishes from the one view whose job is
    // showing what is stored is the failure this bucket exists to prevent.
    const withFuture = { ...event(), venueGeo: { lat: 52 } } as unknown as EventRecord;
    const other = stageBlocks(withFuture).find((b) => b.stage === 'other');
    expect(other?.fields).toEqual({ venueGeo: { lat: 52 } });
  });

  it('leaves `other` out entirely when there is nothing in it', () => {
    expect(stageBlocks(event()).some((b) => b.stage === 'other')).toBe(false);
  });

  it('omits an absent optional field rather than printing it as undefined', () => {
    expect('subtitle' in stageBlocks(event()).find((b) => b.stage === 'scraped')!.fields).toBe(
      false,
    );
  });
});

describe('FIELD_STAGES', () => {
  it('names every field a stored record actually carries', () => {
    // The type makes this exhaustive over `EventRecord`; this checks the other direction, that a
    // record built here has no key the map missed.
    for (const key of Object.keys(event({ reach: 'local', kind: 'listing' }))) {
      expect(FIELD_STAGES, `${key} has no stage`).toHaveProperty(key);
    }
  });

  it('offers no `field` option the stage map does not know about', () => {
    for (const field of OPTIONAL_FIELDS) expect(FIELD_STAGES).toHaveProperty(field as string);
  });
});

describe('matchesFacets', () => {
  it('reads an empty selection as no constraint, not as matching nothing', () => {
    // `match.ts`'s rule for a keyword-less interest, arriving here: read the other way the tab
    // opens on a blank list for everyone who has never pressed a button.
    expect(matchesFacets(event(), NO_FACETS)).toBe(true);
    expect(matchesFacets(event(), pick([['kind', []]]))).toBe(true);
  });

  it('is any-of within an axis and all-of across them', () => {
    const row = event({ source: 'feed', kind: 'coverage' });
    expect(matchesFacets(row, pick([['kind', ['coverage', 'listing']]]))).toBe(true);
    expect(matchesFacets(row, pick([['kind', ['listing']]]))).toBe(false);
    expect(
      matchesFacets(row, pick([['kind', ['coverage']], ['source', ['ticketmaster']]])),
    ).toBe(false);
  });

  it('can ask for the rows with no answer on an axis', () => {
    // The count this tab exists for: how much of the corpus nothing has judged yet.
    expect(matchesFacets(event(), pick([['kind', [ABSENT]]]))).toBe(true);
    expect(matchesFacets(event({ kind: 'listing' }), pick([['kind', [ABSENT]]]))).toBe(false);
  });

  it('matches a row on any one of its tags, and files an untagged row under absent', () => {
    const tagged = event({ tags: ['opera', 'music'] });
    expect(matchesFacets(tagged, pick([['tag', ['music']]]))).toBe(true);
    expect(matchesFacets(tagged, pick([['tag', [ABSENT]]]))).toBe(false);
    expect(matchesFacets(event(), pick([['tag', [ABSENT]]]))).toBe(true);
  });

  it('reads the `field` axis as presence, with null and the empty array both absent', () => {
    expect(matchesFacets(event({ startsAt: 1 }), pick([['field', ['startsAt']]]))).toBe(true);
    expect(matchesFacets(event({ startsAt: null }), pick([['field', ['startsAt']]]))).toBe(false);
    expect(matchesFacets(event({ tags: [] }), pick([['field', ['tags']]]))).toBe(false);
    expect(matchesFacets(event({ tags: ['x'] }), pick([['field', ['tags']]]))).toBe(true);
  });

  it('folds two spellings of a city into one option', () => {
    // `cityKey`, so the picker groups what an interest would also reach.
    expect(matchesFacets(event({ city: 'Warsaw' }), pick([['city', ['warszawa']]]))).toBe(true);
  });
});

describe('facetsOf', () => {
  const corpus = [
    event({ id: 'a', kind: 'listing', country: 'PL', tags: ['opera'] }),
    event({ id: 'b', kind: 'listing', country: 'DE', tags: ['opera', 'music'] }),
    event({ id: 'c', kind: 'coverage', country: 'PL' }),
  ];

  it('counts each axis over what the other axes leave, so a count says what pressing it shows', () => {
    const chosen = pick([['kind', ['listing']]]);
    const countries = facetsOf(corpus, chosen).find((f) => f.key === 'country')!;
    // Alphabetical behind the count, so two equally common values do not swap between renders.
    expect(countries.options.map((o) => [o.value, o.count])).toEqual([
      ['DE', 1],
      ['PL', 1],
    ]);

    // Its own axis is counted as though nothing on it were chosen — otherwise every unpicked
    // option in a narrowed view reads zero, which is what makes a filter look broken.
    const kinds = facetsOf(corpus, chosen).find((f) => f.key === 'kind')!;
    expect(kinds.options.map((o) => [o.value, o.count])).toEqual([
      ['listing', 2],
      ['coverage', 1],
    ]);
  });

  it('keeps a chosen value the corpus no longer holds, at zero', () => {
    // A button that takes itself off the screen leaves the view narrowed with nothing to press.
    const kinds = facetsOf(corpus, pick([['kind', ['announcement']]])).find(
      (f) => f.key === 'kind',
    )!;
    expect(kinds.options.find((o) => o.value === 'announcement')).toEqual({
      value: 'announcement',
      label: 'announcement',
      count: 0,
    });
  });

  it('puts the rows with no answer last, whichever way the axis is ordered', () => {
    const tags = facetsOf(corpus, NO_FACETS).find((f) => f.key === 'tag')!;
    expect(tags.options.at(-1)!.value).toBe(ABSENT);
    const reach = facetsOf(corpus, NO_FACETS).find((f) => f.key === 'reach')!;
    expect(reach.options.at(-1)!.value).toBe(ABSENT);
  });

  it('orders a closed vocabulary by its own list and an open one by count', () => {
    const kinds = facetsOf([...corpus, event({ id: 'd', kind: 'announcement' })], NO_FACETS).find(
      (f) => f.key === 'kind',
    )!;
    // KINDS order, not commonest-first: these are buttons, and buttons must not move.
    expect(kinds.options.map((o) => o.value)).toEqual(['listing', 'announcement', 'coverage']);

    const countries = facetsOf(corpus, NO_FACETS).find((f) => f.key === 'country')!;
    expect(countries.options.map((o) => o.value)).toEqual(['PL', 'DE']);
  });

  it('labels a city with the spelling the corpus prefers', () => {
    const cities = facetsOf(
      [event({ city: 'Warsaw' }), event({ id: 'b', city: 'Warszawa' })],
      NO_FACETS,
    ).find((f) => f.key === 'city')!;
    expect(cities.options[0]).toMatchObject({ value: 'warszawa', label: 'Warszawa', count: 2 });
  });

  it('separates the adapter from the publication it read', () => {
    // The whole reason there are two rows: the RSS adapter is one `source` over a list of
    // unrelated magazines, and `feed` alone cannot tell a race report from a history article.
    const feeds = [
      event({ id: 'a', source: 'feed', sourceName: 'Maraton Warszawski' }),
      event({ id: 'b', source: 'feed', sourceName: 'historia.org.pl' }),
      event({ id: 'c', source: 'feed', sourceName: 'historia.org.pl' }),
    ];
    const sources = facetsOf(feeds, NO_FACETS).find((f) => f.key === 'source')!;
    expect(sources.options).toEqual([{ value: 'feed', label: 'feed', count: 3 }]);

    const publications = facetsOf(feeds, NO_FACETS).find((f) => f.key === 'publication')!;
    expect(publications.options.map((o) => [o.value, o.count])).toEqual([
      ['historia.org.pl', 2],
      ['Maraton Warszawski', 1],
    ]);
    expect(applyFacets(feeds, pick([['publication', ['historia.org.pl']]])).map((e) => e.id)).toEqual(
      ['b', 'c'],
    );
  });

  it('returns every axis, in one fixed order', () => {
    expect(facetsOf(corpus, NO_FACETS).map((f) => f.key)).toEqual([...FACET_KEYS]);
  });
});

describe('applyFacets', () => {
  it('narrows to the rows that survive every axis', () => {
    const corpus = [event({ id: 'a', kind: 'listing' }), event({ id: 'b', kind: 'coverage' })];
    expect(applyFacets(corpus, pick([['kind', ['coverage']]])).map((e) => e.id)).toEqual(['b']);
    expect(applyFacets(corpus, NO_FACETS)).toHaveLength(2);
  });
});

describe('toggleFacet', () => {
  it('adds, removes, and drops an axis once nothing is left on it', () => {
    let selection = toggleFacet(NO_FACETS, 'kind', 'listing');
    expect(chosenCount(selection)).toBe(1);
    selection = toggleFacet(selection, 'kind', 'coverage');
    expect([...selection.get('kind')!]).toEqual(['listing', 'coverage']);
    selection = toggleFacet(selection, 'kind', 'listing');
    selection = toggleFacet(selection, 'kind', 'coverage');
    // Emptied rather than left as an empty set, so "nothing chosen" has one representation.
    expect(selection.has('kind')).toBe(false);
    expect(chosenCount(selection)).toBe(0);
  });

  it('does not mutate the selection it was given', () => {
    const before = pick([['kind', ['listing']]]);
    toggleFacet(before, 'kind', 'coverage');
    expect([...before.get('kind')!]).toEqual(['listing']);
  });
});
