import { describe, expect, it } from 'vitest';
import {
  containsWord,
  interestsRejectingFor,
  isInterestActive,
  matchReason,
  matchesInterest,
  matchingInterests,
} from './match';
import { fingerprintOf, haystackOf } from './normalize';
import { seedInterests } from './interests';
import type { EventRecord, Interest } from './types';

const NOW = Date.parse('2026-08-23T12:00:00Z');

// `description` is not on EventRecord — it is an adapter input that gets folded into the
// haystack — so the helper takes it separately rather than pretending the record carries it.
function ev(partial: Partial<EventRecord> & { title: string; description?: string }): EventRecord {
  const day = partial.day ?? '2026-10-01';
  return {
    id: partial.id ?? `x_${partial.title}`,
    source: partial.source ?? 'feed',
    sourceKey: partial.sourceKey ?? partial.title,
    sourceName: partial.sourceName ?? 'test',
    title: partial.title,
    subtitle: partial.subtitle,
    haystack:
      partial.haystack ??
      haystackOf({
        title: partial.title,
        subtitle: partial.subtitle,
        venue: partial.venue,
        city: partial.city,
        description: partial.description,
      }),
    url: partial.url ?? 'https://example.test/e',
    ticketUrl: partial.ticketUrl,
    startsAt: partial.startsAt ?? Date.parse(`${day}T18:00:00Z`),
    day,
    city: partial.city,
    venue: partial.venue,
    country: partial.country,
    reach: partial.reach,
    tags: partial.tags ?? [],
    fingerprint: fingerprintOf({ title: partial.title, day, city: partial.city }),
    firstSeenAt: partial.firstSeenAt ?? NOW,
    updatedAt: NOW,
    ...('onSaleSeenAt' in partial ? { onSaleSeenAt: partial.onSaleSeenAt } : {}),
  } as EventRecord;
}

function interest(partial: Partial<Interest> & { id: string }): Interest {
  return {
    rev: 0,
    updatedAt: NOW,
    writerId: 'w',
    createdAt: NOW,
    label: partial.id,
    keywords: [],
    leadDays: 14,
    ...partial,
  };
}

describe('containsWord', () => {
  it('matches on word boundaries, not as a substring', () => {
    // The bug this exists for: an interest in Pink Floyd firing on a guitar-parts listing.
    expect(containsWord('pink floyd live', 'floyd')).toBe(true);
    expect(containsWord('floydwear hoodies', 'floyd')).toBe(false);
    expect(containsWord('operacja plastyczna', 'opera')).toBe(false);
    expect(containsWord('opera narodowa', 'opera')).toBe(true);
  });

  it('matches a multi-word needle as a phrase, whatever separates the words', () => {
    expect(containsWord('jarmark sredniowieczny na zamku', 'jarmark średniowieczny')).toBe(true);
    expect(containsWord('jarmark - sredniowieczny', 'jarmark sredniowieczny')).toBe(true);
    expect(containsWord('sredniowieczny jarmark', 'jarmark sredniowieczny')).toBe(false);
  });

  it('is diacritic-insensitive in both directions', () => {
    expect(containsWord(haystackOf({ title: 'Muzyka Żydowska' }), 'muzyka zydowska')).toBe(true);
    expect(containsWord(haystackOf({ title: 'muzyka zydowska' }), 'Muzyka Żydowska')).toBe(true);
  });

  it('does not blow up on regex metacharacters in a keyword', () => {
    expect(containsWord('c++ workshop', 'c++')).toBe(true);
    expect(() => containsWord('anything', '(')).not.toThrow();
  });

  it('is false for an empty needle', () => {
    expect(containsWord('anything', '')).toBe(false);
    expect(containsWord('anything', '*')).toBe(false);
  });

  describe('the trailing * prefix marker', () => {
    it('reaches Polish inflections a whole-word match cannot', () => {
      // The case that forced the marker to exist: half the listings are Polish, and Polish
      // inflects almost everything.
      expect(containsWord('koncert klezmerski', 'klezmer')).toBe(false);
      expect(containsWord('koncert klezmerski', 'klezmer*')).toBe(true);
      expect(containsWord('jarmark sredniowieczny', 'sredniowieczn*')).toBe(true);
      expect(containsWord('turniej rycerskiego bractwa', 'rycersk*')).toBe(true);
    });

    it('still anchors the START of the needle to a boundary', () => {
      // A prefix match is not a substring match: this is what keeps 'floyd*' out of "psychofloyd"
      // and keeps the marker from undoing the whole point of word matching.
      expect(containsWord('psychofloyd live', 'floyd*')).toBe(false);
      expect(containsWord('floydwear hoodies', 'floyd*')).toBe(true);
    });

    it('leaves an unmarked keyword strict, which is why the marker is opt-in', () => {
      // 'floyd' and 'opera' are exactly the keywords that must NOT be loosened, and the seeds
      // leave them bare for that reason.
      expect(containsWord('floydwear hoodies', 'floyd')).toBe(false);
      expect(containsWord('operacja plastyczna', 'opera')).toBe(false);
    });
  });
});

describe('matchesInterest', () => {
  it('treats an EMPTY keyword list as no constraint, not as "matches nothing"', () => {
    // The Opera Narodowa interest is exactly this shape. Reading empty as unsatisfiable makes it
    // silently dead — matching nothing forever, with nothing in the UI to say why.
    const opera = interest({ id: 'opera', keywords: [], tags: ['opera'] });
    expect(matchesInterest(ev({ title: 'Salome', tags: ['opera'] }), opera)).toBe(true);
    expect(matchesInterest(ev({ title: 'Pink Floyd', tags: ['music'] }), opera)).toBe(false);
  });

  it('takes keywords as any-of', () => {
    const i = interest({ id: 'i', keywords: ['klezmer', 'yiddish'] });
    expect(matchesInterest(ev({ title: 'Yiddish Songs' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'Klezmer Night' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'Techno' }), i)).toBe(false);
  });

  it('lets one exclusion veto whatever else matched', () => {
    const i = interest({ id: 'i', keywords: ['floyd'], excludeKeywords: ['floyd rose'] });
    expect(matchesInterest(ev({ title: 'Pink Floyd Tribute' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'Floyd Rose tremolo clinic' }), i)).toBe(false);
  });

  it('takes tags as all-of, where keywords are any-of', () => {
    const i = interest({ id: 'i', tags: ['opera', 'premiere'] });
    expect(matchesInterest(ev({ title: 'X', tags: ['opera', 'premiere', 'theatre'] }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'X', tags: ['opera'] }), i)).toBe(false);
  });

  it('takes cities as any-of and requires the event to have one', () => {
    const i = interest({ id: 'i', cities: ['Warszawa', 'Kraków'] });
    expect(matchesInterest(ev({ title: 'X', city: 'warszawa' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'X', city: 'Krakow' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'X', city: 'Gdańsk' }), i)).toBe(false);
    expect(matchesInterest(ev({ title: 'X' }), i)).toBe(false);
  });

  it('compares the date window lexically', () => {
    const i = interest({ id: 'i', fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(matchesInterest(ev({ title: 'X', day: '2026-09-15' }), i)).toBe(true);
    expect(matchesInterest(ev({ title: 'X', day: '2026-10-15' }), i)).toBe(false);
    expect(matchesInterest(ev({ title: 'X', day: '2026-08-31' }), i)).toBe(false);
  });

  it('lets an undated event through any window', () => {
    // A season announced before its nights are scheduled has not been excluded — it simply has no
    // date yet, and hiding it is the opposite of what an announcement feed is for.
    const i = interest({ id: 'i', fromDay: '2026-09-01', toDay: '2026-09-30' });
    const undated = { ...ev({ title: 'Sezon 2027/28' }), day: null, startsAt: null };
    expect(matchesInterest(undated, i)).toBe(true);
  });
});

describe('the places rule', () => {
  // The screenshot that started this: four national PyCons in the feed, none of them attendable.
  const pyconNL = ev({ title: 'PyCon NL 2026', country: 'NL', reach: 'national' });
  const pyconCM = ev({ title: 'PyCon Cameroon 2026', country: 'CM', reach: 'national' });
  const europython = ev({ title: 'EuroPython 2026', country: 'CZ', reach: 'international' });
  const pyconUS = ev({ title: 'PyCon US 2026', country: 'US', reach: 'international' });
  const pyconPL = ev({ title: 'PyCon Polska 2026', country: 'PL', reach: 'national' });

  it('is no constraint at all when no country is asked for', () => {
    const anywhere = interest({ id: 'i', keywords: ['pycon', 'europython'] });
    for (const event of [pyconNL, pyconCM, europython, pyconPL]) {
      expect(matchesInterest(event, anywhere)).toBe(true);
    }
  });

  it('takes the countries as any-of', () => {
    const region = interest({ id: 'i', keywords: ['pycon', 'europython'], countries: ['PL', 'CZ'] });
    expect(matchesInterest(pyconPL, region)).toBe(true);
    expect(matchesInterest(europython, region)).toBe(true);
    expect(matchesInterest(pyconNL, region)).toBe(false);
  });

  /*
   * The whole point of the axis. Read as two AND-ed constraints this would mean "in Poland AND
   * international", which keeps nothing — so the two halves have to be OR-ed, and this is the test
   * that says so.
   */
  it('keeps an international event outside the wanted countries, and drops a national one', () => {
    const mine = interest({
      id: 'i',
      keywords: ['pycon', 'europython'],
      countries: ['PL'],
      internationalAnywhere: true,
    });
    expect(matchesInterest(pyconPL, mine)).toBe(true);
    expect(matchesInterest(europython, mine)).toBe(true);
    expect(matchesInterest(pyconUS, mine)).toBe(true);
    expect(matchesInterest(pyconNL, mine)).toBe(false);
    expect(matchesInterest(pyconCM, mine)).toBe(false);
  });

  it('does not let international in when it was not asked for', () => {
    const strict = interest({ id: 'i', keywords: ['pycon', 'europython'], countries: ['PL'] });
    expect(matchesInterest(europython, strict)).toBe(false);
    expect(matchesInterest(pyconPL, strict)).toBe(true);
  });

  /*
   * Which way this fails when the classifier is down. Pending passes, so the noise comes back
   * where it can be seen, rather than the feed silently emptying — an empty feed looks exactly
   * like everything working.
   */
  it('lets an unclassified event through, per axis', () => {
    const mine = interest({
      id: 'i',
      keywords: ['pycon'],
      countries: ['PL'],
      internationalAnywhere: true,
    });
    // Neither axis known yet.
    expect(matchesInterest(ev({ title: 'PyCon Somewhere' }), mine)).toBe(true);
    // Where it is is known, who it is for is not — the case for every scraped PL row before its
    // first classification, and for any event whose reach the model failed to return.
    expect(matchesInterest(ev({ title: 'PyCon NL', country: 'NL' }), mine)).toBe(true);
  });

  it('reads an unknown reach as not-international once reach is not being asked about', () => {
    const strict = interest({ id: 'i', keywords: ['pycon'], countries: ['PL'] });
    expect(matchesInterest(ev({ title: 'PyCon NL', country: 'NL' }), strict)).toBe(false);
  });

  it('compares codes case-insensitively, so a stored lowercase one still filters', () => {
    const region = interest({ id: 'i', keywords: ['pycon'], countries: ['pl'] });
    expect(matchesInterest(ev({ title: 'PyCon Polska', country: 'pl' }), region)).toBe(true);
    expect(matchesInterest(pyconPL, region)).toBe(true);
  });
});

describe('matchReason', () => {
  it('is null exactly when matchesInterest is true', () => {
    const i = interest({ id: 'i', keywords: ['pycon'], countries: ['PL'] });
    for (const event of [
      ev({ title: 'PyCon Polska', country: 'PL' }),
      ev({ title: 'PyCon NL', country: 'NL', reach: 'national' }),
      ev({ title: 'Koncert klezmerski', country: 'PL' }),
    ]) {
      expect(matchReason(event, i) === null).toBe(matchesInterest(event, i));
    }
  });

  /*
   * A reason is "the first thing wrong", and the rejected view depends on it: an event that also
   * fails the keywords is not a near miss on geography, and listing it as one would fill that view
   * with things nobody was ever going to see.
   */
  it('names the first failing rule, not every failing one', () => {
    const i = interest({
      id: 'i',
      keywords: ['pycon'],
      tags: ['tech'],
      countries: ['PL'],
    });
    // Wrong country AND the wrong subject altogether.
    expect(matchReason(ev({ title: 'Koncert klezmerski', country: 'NL' }), i)).toBe('keywords');
    // Wrong country AND missing the tag.
    expect(matchReason(ev({ title: 'PyCon NL', country: 'NL', reach: 'national' }), i)).toBe('tags');
    // Only the country is wrong. This is the near miss.
    expect(
      matchReason(
        ev({ title: 'PyCon NL', country: 'NL', reach: 'national', tags: ['tech'] }),
        i,
      ),
    ).toBe('places');
  });

  it('names each of the other rules', () => {
    const base = { id: 'i', keywords: ['pycon'] };
    expect(
      matchReason(ev({ title: 'PyCon NL' }), interest({ ...base, excludeKeywords: ['pycon'] })),
    ).toBe('exclude');
    expect(
      matchReason(ev({ title: 'PyCon NL', city: 'Utrecht' }), interest({ ...base, cities: ['Kraków'] })),
    ).toBe('cities');
    expect(
      matchReason(ev({ title: 'PyCon NL', day: '2026-10-01' }), interest({ ...base, toDay: '2026-09-01' })),
    ).toBe('dates');
  });
});

describe('interestsRejectingFor', () => {
  const mine = interest({
    id: 'python',
    keywords: ['pycon'],
    countries: ['PL'],
    internationalAnywhere: true,
  });
  const opera = interest({ id: 'opera', keywords: [], tags: ['opera'] });

  it('names only the interests that turned the event away for that reason', () => {
    const event = ev({ title: 'PyCon NL 2026', country: 'NL', reach: 'national' });
    expect(
      interestsRejectingFor(event, [mine, opera], 'places', { forPush: false }).map((i) => i.id),
    ).toEqual(['python']);
  });

  it('does not name an interest that failed on something sooner', () => {
    // The opera interest rejects this on tags, not on geography — a keyword miss is not a near
    // miss, and the verification view must not fill up with them.
    const event = ev({ title: 'PyCon NL 2026', country: 'NL', reach: 'national' });
    expect(interestsRejectingFor(event, [opera], 'places', { forPush: false })).toEqual([]);
    expect(
      interestsRejectingFor(event, [opera], 'tags', { forPush: false }).map((i) => i.id),
    ).toEqual(['opera']);
  });

  it('skips a tombstoned interest exactly as matchingInterests does', () => {
    const event = ev({ title: 'PyCon NL 2026', country: 'NL', reach: 'national' });
    const dead = { ...mine, deleted: true };
    expect(interestsRejectingFor(event, [dead], 'places', { forPush: false })).toEqual([]);
  });
});

describe('isInterestActive', () => {
  it('drops a tombstone for both callers', () => {
    const gone = interest({ id: 'i', deleted: true });
    expect(isInterestActive(gone, { forPush: false })).toBe(false);
    expect(isInterestActive(gone, { forPush: true })).toBe(false);
  });

  it('lets a muted interest reach the feed but never a push', () => {
    const muted = interest({ id: 'i', muted: true });
    expect(isInterestActive(muted, { forPush: false })).toBe(true);
    expect(isInterestActive(muted, { forPush: true })).toBe(false);
  });
});

describe('the seeded interests against a realistic corpus', () => {
  const seeds = seedInterests({ writerId: 'w', now: NOW });
  const labelsFor = (event: EventRecord) =>
    matchingInterests(event, seeds, { forPush: false })
      .map((i) => i.label)
      .sort();

  const corpus: Array<[EventRecord, string[]]> = [
    [ev({ title: 'Kroke — koncert klezmerski', tags: ['music'] }), ['Klezmer']],
    [
      ev({ title: 'Festiwal Kultury Żydowskiej', city: 'Kraków', tags: ['festival'] }),
      ['Klezmer'],
    ],
    [ev({ title: 'The Wall — Pink Floyd Tribute Show', tags: ['music'] }), ['Pink Floyd']],
    [ev({ title: 'Floyd Rose — warsztaty gitarowe' }), []],
    [
      ev({ title: 'XXVII Jarmark Średniowieczny i Turniej Rycerski', venue: 'Zamek Chudów' }),
      ['Castles & medieval fairs'],
    ],
    [ev({ title: 'PyCon PL 2026', tags: ['tech'] }), ['Python & dev']],
    [ev({ title: 'Warsaw Python Meetup #90', tags: ['tech'] }), ['Python & dev']],
    [ev({ title: 'SALOME', subtitle: 'Richard Strauss', tags: ['opera'] }), ['Opera Narodowa']],
    [
      ev({ title: 'WESELE FIGARA', subtitle: 'W.A. Mozart', tags: ['opera'] }),
      ['Opera Narodowa'],
    ],
    [ev({ title: 'Mecz Legia — Wisła', tags: ['sports'] }), []],
    [ev({ title: 'Stand-up: Kabaret Młodych Panów' }), []],
  ];

  it.each(corpus)('matches %#', (event, expected) => {
    expect(labelsFor(event)).toEqual(expected);
  });

  it('does not let the opera interest swallow every concert', () => {
    // tags is all-of, so an untagged music event must not reach an interest that asks for opera.
    expect(labelsFor(ev({ title: 'Koncert noworoczny', tags: ['music'] }))).toEqual([]);
  });
});
