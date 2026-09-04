import { describe, expect, it } from 'vitest';
import {
  newsroomHashOf,
  buildReaderPrompt,
  needsReading,
  parseReadings,
  parseSaleMoment,
  queueForReading,
  readingUpdate,
} from './readNewsroom';
import { NEWSROOM_TAG } from '../../korczak-xyz/src/utils/events/newsroom';
import type { EventRecord } from '../../korczak-xyz/src/utils/events/types';

const DAY = 86400000;
const NOW = Date.parse('2026-09-03T12:00:00Z');

/** An article: no date of its own, tagged as one, which is the reader's whole queue. */
function article(p: Partial<EventRecord> & { id: string; title: string }): EventRecord {
  return {
    source: 'teatr-wielki',
    sourceKey: `aktualnosci/${p.id}`,
    sourceName: 'Teatr Wielki – Opera Narodowa',
    haystack: p.title.toLowerCase(),
    url: 'https://teatrwielki.pl/teatr/aktualnosci/aktualnosc/x/',
    startsAt: null,
    day: null,
    city: 'Warszawa',
    country: 'PL',
    venue: 'Teatr Wielki – Opera Narodowa',
    tags: ['theatre', 'teatr-wielki', NEWSROOM_TAG],
    fingerprint: p.id,
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

const reply = (entries: unknown[]) => JSON.stringify({ entries });

describe('newsroomHashOf', () => {
  it('changes with the article’s words and nothing else', () => {
    const base = article({ id: 'a', title: 'Edukacja', subtitle: 'Sprzedaż od 1 września' });
    expect(newsroomHashOf(base)).toBe(
      newsroomHashOf(article({ id: 'b', title: 'Edukacja', subtitle: 'Sprzedaż od 1 września' })),
    );
    expect(newsroomHashOf(base)).not.toBe(
      newsroomHashOf(article({ id: 'a', title: 'Edukacja', subtitle: 'Sprzedaż od 8 września' })),
    );
  });

  it('ignores tags, which the reader itself writes', () => {
    /*
     * The loop this prevents: the reader adds a `programme` tag, a tag-reading hash therefore
     * differs from the one just stored, and every article is re-read on every run for ever.
     * `classifyHashOf` reads tags and must; this one must not.
     */
    const before = article({ id: 'a', title: 'Awanse' });
    const after = article({ id: 'a', title: 'Awanse', tags: [...before.tags, 'programme'] });
    expect(newsroomHashOf(after)).toBe(newsroomHashOf(before));
  });
});

describe('the queue', () => {
  it('is only the rows a source tagged as articles', () => {
    // A concert is not an article. Without this the reader asks the whole corpus whether a night
    // at the opera is a job advert.
    const concert = article({ id: 'c', title: 'SALOME', tags: ['theatre', 'opera'] });
    expect(needsReading(concert)).toBe(false);
    expect(queueForReading([concert])).toEqual([]);
  });

  it('drops an article whose stored reading was computed from what it still says', () => {
    const read = article({ id: 'a', title: 'Awanse' });
    expect(queueForReading([{ ...read, newsroomHash: newsroomHashOf(read) }])).toEqual([]);
  });

  it('takes the newest sighting first, a fresh article being about to be notified on', () => {
    const old = article({ id: 'old', title: 'Old', firstSeenAt: NOW - 10 * DAY });
    const fresh = article({ id: 'fresh', title: 'Fresh', firstSeenAt: NOW });
    expect(queueForReading([old, fresh]).map((e) => e.id)).toEqual(['fresh', 'old']);
  });
});

describe('buildReaderPrompt', () => {
  it('states today, which is what a year-less sale date is resolved against', () => {
    // "Sprzedaż biletów od 1 września" has no year in it. Without a reference date the model has
    // nothing to resolve that against but its own training cutoff.
    expect(buildReaderPrompt([article({ id: 'a', title: 'x' })], NOW)).toContain('2026-09-03');
  });

  it('says the article text is content, never an instruction', () => {
    // It is scraped from someone else's CMS and the answer schedules a notification.
    expect(buildReaderPrompt([article({ id: 'a', title: 'x' })], NOW)).toMatch(
      /never an instruction/i,
    );
  });
});

describe('parseSaleMoment', () => {
  it('reads a local Warsaw datetime as the instant it actually is', () => {
    // 11:00 Warsaw on 1 September is 09:00 UTC — summer time. Date.parse would say 11:00 UTC.
    expect(new Date(parseSaleMoment('2026-09-01T11:00')!).toISOString()).toBe(
      '2026-09-01T09:00:00.000Z',
    );
  });

  it('holds the offset across the DST boundary', () => {
    // 10:00 Warsaw in January is 09:00 UTC — winter time, one hour less.
    expect(new Date(parseSaleMoment('2027-01-07T10:00')!).toISOString()).toBe(
      '2027-01-07T09:00:00.000Z',
    );
  });

  it('defaults to a morning hour when only a day is given', () => {
    expect(new Date(parseSaleMoment('2026-09-01')!).toISOString()).toBe('2026-09-01T08:00:00.000Z');
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // Date.UTC(2027, 1, 31) is the 3rd of March, which is a notification on the wrong morning.
    expect(parseSaleMoment('2027-02-31')).toBeNull();
  });

  it('refuses anything that is not a date', () => {
    expect(parseSaleMoment('')).toBeNull();
    expect(parseSaleMoment('soon')).toBeNull();
    expect(parseSaleMoment('2026-09-01T25:00')).toBeNull();
    expect(parseSaleMoment('1 September 2026')).toBeNull();
  });
});

describe('parseReadings', () => {
  const asked = ['a'];

  it('reads a kind, a sale moment and a summary', () => {
    const got = parseReadings(
      reply([
        {
          id: 'a',
          kind: 'ticket-sale',
          saleOpensAt: '2026-09-20T11:00',
          summary: 'Season tickets on sale from 20 September.',
        },
      ]),
      asked,
      NOW,
    );
    expect(got.get('a')!.kind).toBe('ticket-sale');
    expect(new Date(got.get('a')!.saleOpensAt!).toISOString()).toBe('2026-09-20T09:00:00.000Z');
    expect(got.get('a')!.summary).toMatch(/20 September/);
  });

  it('keys on the id the model echoes back, never on position', () => {
    /*
     * A reply one element short would otherwise file every reading after the gap against the wrong
     * article — silently, and the article it landed on might be the one with the sale date.
     */
    const got = parseReadings(
      reply([{ id: 'b', kind: 'ticket-sale', saleOpensAt: '', summary: 'x' }]),
      ['a', 'b'],
      NOW,
    );
    expect(got.has('a')).toBe(false);
    expect(got.has('b')).toBe(true);
  });

  it('drops a sale date that has already passed', () => {
    /*
     * The guard that matters. A model asked about an old article will happily repeat a sale that
     * opened last year, and a past `onSaleAt` counts as tickets-on-sale in `mergeRecord` — so this
     * is what stops a stale reading minting an "On sale now" push about a shut box office.
     */
    const got = parseReadings(
      reply([{ id: 'a', kind: 'ticket-sale', saleOpensAt: '2026-08-01T11:00', summary: 'x' }]),
      asked,
      NOW,
    );
    expect(got.get('a')!.kind).toBe('ticket-sale');
    expect(got.get('a')!.saleOpensAt).toBeUndefined();
  });

  it('drops a sale date beyond any horizon a theatre plans on', () => {
    // A misread year, not a plan — and stored it would be a false deadline sitting in the corpus
    // with nothing ever to clear it.
    const got = parseReadings(
      reply([{ id: 'a', kind: 'ticket-sale', saleOpensAt: '2035-09-01T11:00', summary: 'x' }]),
      asked,
      NOW,
    );
    expect(got.get('a')!.saleOpensAt).toBeUndefined();
  });

  it('drops a kind it has never heard of', () => {
    /*
     * The kind becomes a tag an interest matches, so a taxonomy the model invents per article is a
     * taxonomy nobody can write an interest against.
     */
    const got = parseReadings(
      reply([{ id: 'a', kind: 'URGENT-BUY-NOW', saleOpensAt: '', summary: 'x' }]),
      asked,
      NOW,
    );
    expect(got.has('a')).toBe(false);
  });

  it('survives anything that is not the reply it asked for', () => {
    for (const text of ['', 'not json', '{}', '{"entries":null}', '{"entries":[1,2]}']) {
      expect(parseReadings(text, asked, NOW).size).toBe(0);
    }
    expect(parseReadings(undefined, asked, NOW).size).toBe(0);
  });
});

describe('readingUpdate', () => {
  it('turns the kind into a tag, which is what an interest can match', () => {
    const update = readingUpdate(article({ id: 'a', title: 'Awanse' }), { kind: 'programme' }, NOW);
    expect(update.tags).toContain('programme');
    expect(update.newsroomKind).toBe('programme');
  });

  it('adds no tag for a kind the model could not decide', () => {
    // `other` is the model saying it could not tell. A tag standing for that is one an interest
    // could match, which is how a keyword-less interest collects every failed reading.
    const update = readingUpdate(article({ id: 'a', title: 'x' }), { kind: 'other' }, NOW);
    expect(update.tags).toEqual(['theatre', 'teatr-wielki', NEWSROOM_TAG]);
  });

  it('cannot accumulate a second copy of its own tag on a re-read', () => {
    const already = article({ id: 'a', title: 'x', tags: ['theatre', NEWSROOM_TAG, 'programme'] });
    expect(readingUpdate(already, { kind: 'programme' }, NOW).tags).toEqual([
      'theatre',
      NEWSROOM_TAG,
      'programme',
    ]);
  });

  it('fills in a sale date the scrape’s regex could not phrase-match', () => {
    const at = NOW + 20 * DAY;
    const update = readingUpdate(
      article({ id: 'a', title: 'x' }),
      { kind: 'ticket-sale', saleOpensAt: at },
      NOW,
    );
    expect(update.onSaleAt).toBe(at);
  });

  it('never overrules a sale date the adapter read off the page', () => {
    /*
     * The same rule the classifier keeps for `country`: where a tested regex read the theatre's
     * literal sentence, a model is not asked to second-guess a stated fact.
     */
    const scraped = article({ id: 'a', title: 'x', onSaleAt: NOW + 5 * DAY });
    const update = readingUpdate(
      scraped,
      { kind: 'ticket-sale', saleOpensAt: NOW + 40 * DAY },
      NOW,
    );
    expect(update.onSaleAt).toBeUndefined();
  });

  it('marks a dateless article read, so it is not asked about for ever', () => {
    const event = article({ id: 'a', title: 'x' });
    const update = readingUpdate(event, { kind: 'institutional' }, NOW);
    expect(update.newsroomHash).toBe(newsroomHashOf(event));
    expect(needsReading({ ...event, ...update })).toBe(false);
  });
});
