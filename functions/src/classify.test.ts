import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  classificationUpdate,
  classifyHashOf,
  needsClassifying,
  parseClassification,
  queueForClassification,
} from './classify';
import type { EventRecord } from '../../korczak-xyz/src/utils/events/types';

const NOW = Date.parse('2026-08-29T12:00:00Z');

function ev(p: Partial<EventRecord> & { id: string; title: string }): EventRecord {
  return {
    source: 'python-org',
    sourceKey: p.id,
    sourceName: 'python.org events',
    haystack: p.title.toLowerCase(),
    url: 'https://example.test/e',
    startsAt: NOW + 86400000,
    day: '2026-10-01',
    tags: [],
    fingerprint: p.id,
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...p,
  } as EventRecord;
}

const reply = (events: unknown[]) => JSON.stringify({ events });

describe('classifyHashOf', () => {
  it('changes with what the prompt shows', () => {
    const base = ev({ id: 'a', title: 'PyCon NL' });
    expect(classifyHashOf(base)).toBe(classifyHashOf(ev({ id: 'b', title: 'PyCon NL' })));
    expect(classifyHashOf(base)).not.toBe(classifyHashOf(ev({ id: 'a', title: 'PyCon PL' })));
    expect(classifyHashOf(base)).not.toBe(
      classifyHashOf(ev({ id: 'a', title: 'PyCon NL', city: 'Utrecht' })),
    );
  });

  /*
   * The one that costs money if it goes wrong. `updatedAt` moves on every collector run, so a hash
   * over the whole record would never match its stored value and every event would be re-classified
   * every six hours, forever.
   */
  it('does not change when something the model never saw does', () => {
    const before = ev({ id: 'a', title: 'PyCon NL' });
    const after = ev({
      id: 'a',
      title: 'PyCon NL',
      updatedAt: NOW + 999,
      ticketUrl: 'https://tickets.test/x',
      url: 'https://moved.test/e',
    });
    expect(classifyHashOf(after)).toBe(classifyHashOf(before));
  });
});

describe('needsClassifying', () => {
  it('is true until the stored hash matches what the record says now', () => {
    const fresh = ev({ id: 'a', title: 'PyCon NL' });
    expect(needsClassifying(fresh)).toBe(true);

    const done = { ...fresh, classifyHash: classifyHashOf(fresh) };
    expect(needsClassifying(done)).toBe(false);

    // Retitled by a source that fixed its markup: the verdict was about the old words.
    expect(needsClassifying({ ...done, title: 'PyCon Netherlands' })).toBe(true);
  });
});

describe('buildPrompt', () => {
  it('shows the model what it is judging', () => {
    const prompt = buildPrompt([
      ev({ id: 'p1', title: 'PyCon NL 2026', city: 'Utrecht', venue: 'Jaarbeurs' }),
    ]);
    expect(prompt).toContain('PyCon NL 2026');
    expect(prompt).toContain('Utrecht');
    expect(prompt).toContain('Jaarbeurs');
    expect(prompt).toContain('p1');
  });

  it('states the distinction the whole feature turns on', () => {
    const prompt = buildPrompt([ev({ id: 'p1', title: 'X' })]);
    expect(prompt).toContain('national');
    expect(prompt).toContain('international');
    // "Big" is not the question; where the people travelled from is.
    expect(prompt.toLowerCase()).toContain('who travels');
  });
});

describe('parseClassification', () => {
  it('reads a well-formed reply', () => {
    const got = parseClassification(
      reply([{ id: 'a', country: 'nl', reach: 'national', reason: 'Dutch community conference' }]),
      ['a'],
    );
    expect(got.get('a')).toEqual({
      country: 'NL',
      reach: 'national',
      reason: 'Dutch community conference',
    });
  });

  /*
   * The one that would poison the corpus quietly. A reply one element short, or reordered, would
   * file every verdict after the gap against the wrong event — confident wrong countries, with
   * nothing anywhere to say something had gone wrong.
   */
  it('keys on the echoed id, never on the position in the array', () => {
    const got = parseClassification(
      reply([
        { id: 'c', country: 'CZ', reach: 'international', reason: 'pan-European' },
        { id: 'a', country: 'NL', reach: 'national', reason: 'Dutch' },
      ]),
      ['a', 'b', 'c'],
    );
    expect(got.get('a')?.country).toBe('NL');
    expect(got.get('c')?.country).toBe('CZ');
    // 'b' was asked about and not answered: unclassified, not mislabelled.
    expect(got.has('b')).toBe(false);
  });

  it('drops an id nobody asked about', () => {
    const got = parseClassification(
      reply([{ id: 'invented', country: 'PL', reach: 'local', reason: 'x' }]),
      ['a'],
    );
    expect(got.size).toBe(0);
  });

  it('is total on anything unusable', () => {
    for (const text of [
      undefined,
      '',
      'not json at all',
      '{"events": "not an array"}',
      '{"events": [null, 3, "x"]}',
      '[]',
      '{"nope": []}',
      // A truncated reply, which is what a cut-off generation actually looks like.
      '{"events": [{"id": "a", "coun',
    ]) {
      expect(parseClassification(text, ['a']).size).toBe(0);
    }
  });

  it('takes the half of a verdict it can read', () => {
    // An unknown reach with a good country is still worth the country.
    const got = parseClassification(
      reply([{ id: 'a', country: 'PL', reach: 'regional', reason: 'x' }]),
      ['a'],
    );
    expect(got.get('a')).toEqual({ country: 'PL', reason: 'x' });
  });

  it('refuses a country that is not a country', () => {
    for (const country of ['Poland', 'POL', '', 'p', '12']) {
      const got = parseClassification(reply([{ id: 'a', country, reach: 'local', reason: 'x' }]), [
        'a',
      ]);
      expect(got.get('a')?.country).toBeUndefined();
      // The reach still came through — half a verdict is not no verdict.
      expect(got.get('a')?.reach).toBe('local');
    }
  });

  it('accepts the token for an event that happens nowhere', () => {
    const got = parseClassification(
      reply([{ id: 'a', country: 'ONLINE', reach: 'international', reason: 'remote' }]),
      ['a'],
    );
    expect(got.get('a')?.country).toBe('ONLINE');
  });

  it('yields nothing for a row that answered neither question', () => {
    const got = parseClassification(reply([{ id: 'a', country: 'nope', reach: 'nope' }]), ['a']);
    // Storing an empty verdict would write a hash and mark the event permanently done.
    expect(got.has('a')).toBe(false);
  });
});

describe('classificationUpdate', () => {
  it('lets a country the adapter supplied stand', () => {
    // Teatr Wielki is in Warsaw and Ticketmaster is queried countryCode=PL. Those are facts.
    const event = ev({ id: 'a', title: 'Wesele Figara', country: 'PL' });
    const update = classificationUpdate(event, { country: 'NL', reach: 'local' }, NOW);
    expect(update.country).toBeUndefined();
    expect(update.reach).toBe('local');
  });

  it('fills in a country nobody knew', () => {
    const event = ev({ id: 'a', title: 'PyCon NL' });
    const update = classificationUpdate(event, { country: 'NL', reach: 'national' }, NOW);
    expect(update.country).toBe('NL');
  });

  /*
   * Written even for a partial verdict. Writing it only on a complete one puts an event the model
   * has no country for back in the queue on every run for the rest of its life.
   */
  it('always stamps the hash, so a partial verdict is not retried forever', () => {
    const event = ev({ id: 'a', title: 'Something vague' });
    const update = classificationUpdate(event, { reach: 'local' }, NOW);
    expect(update.classifyHash).toBe(classifyHashOf(event));
    expect(update.classifiedAt).toBe(NOW);
    expect(needsClassifying({ ...event, ...update })).toBe(false);
  });
});

describe('queueForClassification', () => {
  it('skips what is already classified', () => {
    const done = ev({ id: 'done', title: 'Done' });
    const records = [
      { ...done, classifyHash: classifyHashOf(done) },
      ev({ id: 'todo', title: 'Todo' }),
    ];
    expect(queueForClassification(records).map((e) => e.id)).toEqual(['todo']);
  });

  /*
   * Newest first because an event created in this same run is about to be considered for an
   * `announced` push, and the point of classifying before notifying is that the decision is made
   * on a classified record. A push cannot be taken back; a backlog can wait a run.
   */
  it('puts the newest sighting first', () => {
    const records = [
      ev({ id: 'old', title: 'Old', firstSeenAt: NOW - 86400000 }),
      ev({ id: 'new', title: 'New', firstSeenAt: NOW }),
    ];
    expect(queueForClassification(records).map((e) => e.id)).toEqual(['new', 'old']);
  });
});
