import { describe, expect, it } from 'vitest';
import { containsWord, isInterestActive, matchesInterest, matchingInterests } from './match';
import { fingerprintOf, haystackOf } from './normalize';
import { seedInterests } from './interests';
import type { EventRecord, Interest } from './types';

const NOW = Date.parse('2026-08-23T12:00:00Z');

function ev(partial: Partial<EventRecord> & { title: string }): EventRecord {
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
        tags: partial.tags,
        description: partial.description as string | undefined,
      }),
    url: partial.url ?? 'https://example.test/e',
    ticketUrl: partial.ticketUrl,
    startsAt: partial.startsAt ?? Date.parse(`${day}T18:00:00Z`),
    day,
    city: partial.city,
    venue: partial.venue,
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
