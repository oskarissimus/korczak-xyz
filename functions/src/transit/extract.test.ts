import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  extractHashOf,
  isExtractable,
  needsExtracting,
  parseReadings,
  parseWhen,
  queueForExtraction,
  readingUpdate,
} from './extract';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

const NOW = Date.parse('2026-08-27T18:10:00Z');

function item(patch: Partial<TransitItem> = {}): TransitItem {
  return {
    id: 'impediment_a',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/utrudnienia/a/',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/a/',
    body: 'Od godz. 20:00 pociągi metra linii M1 nie kursują na odcinku Centrum – Wilanowska.',
    publishedAt: NOW,
    titleLines: ['M1'],
    contentHash: 'aaaaaaaaaaaaaaaa',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe('the cheap gate', () => {
  /*
   * The property that keeps this app nearly free: whether an item is worth a model call is decided
   * from WTP's own headline, which came with the feed. A fortnight of bus roadworks costs nothing.
   */
  it('never shows the model a bus communiqué', () => {
    expect(isExtractable(item({ titleLines: ['189', '401'] }))).toBe(false);
    expect(isExtractable(item({ titleLines: ['742', 'M1'] }))).toBe(true);
  });

  it('reads an item once, and again only when WTP edits it', () => {
    const fresh = item();
    expect(needsExtracting(fresh)).toBe(true);
    const done = { ...fresh, extractHash: extractHashOf(fresh) };
    expect(needsExtracting(done)).toBe(false);
    expect(needsExtracting({ ...done, contentHash: 'bbbbbbbbbbbbbbbb' })).toBe(true);
  });

  it('queues newest first, because a push cannot be taken back and a backlog can wait', () => {
    const queue = queueForExtraction([
      item({ id: 'old', publishedAt: NOW - 86400000 }),
      item({ id: 'new', publishedAt: NOW }),
    ]);
    expect(queue.map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('the prompt', () => {
  it('names every station on both lines, in order', () => {
    const prompt = buildPrompt([item()]);
    expect(prompt).toContain('M1: Kabaty, Natolin, Imielin');
    expect(prompt).toContain('M2: Bemowo, Ulrychów, Księcia Janusza');
    expect(prompt).toContain('Bródno');
  });

  /*
   * The instruction the whole reading depends on. Polish notices state a closure as a stretch at
   * least as often as they list stations, and a stretch this app cannot expand is a closure it
   * cannot place on a route.
   */
  it('asks for ranges to be expanded station by station', () => {
    expect(buildPrompt([item()])).toContain('Expand ranges');
  });

  it('gives each notice its own publication date, since the prose gives times without dates', () => {
    expect(buildPrompt([item()])).toContain('2026-08-27T18:10:00.000Z');
  });
});

describe('parsing the reply', () => {
  const asked = [item({ id: 'a' }), item({ id: 'b' })];

  const reply = (items: unknown[]) => JSON.stringify({ items });

  it('reads a full reading', () => {
    const out = parseReadings(
      reply([
        {
          id: 'a',
          lines: ['M1'],
          closedStops: ['Centrum', 'Politechnika', 'Wilanowska'],
          wholeLine: false,
          from: '2026-08-27T20:00:00+02:00',
          until: '',
          reason: 'awaria taboru',
          summary: 'Metro M1 nie kursuje na odcinku Centrum – Wilanowska.',
        },
      ]),
      asked,
    );
    expect(out.get('a')).toEqual({
      lines: ['M1'],
      closedStops: ['Centrum', 'Politechnika', 'Wilanowska'],
      wholeLine: false,
      effectiveFrom: Date.parse('2026-08-27T18:00:00Z'),
      reason: 'awaria taboru',
      summary: 'Metro M1 nie kursuje na odcinku Centrum – Wilanowska.',
    });
  });

  /*
   * Keyed by the id the model echoes, never by position. A reply one element short would otherwise
   * file every reading after the gap against the wrong communiqué — silently, producing a corpus of
   * confident wrong station lists, which is a route the app says is clear.
   */
  it('keys by the echoed id and drops one that was never asked about', () => {
    const out = parseReadings(
      reply([
        { id: 'zzz', lines: ['M1'], closedStops: ['Kabaty'], wholeLine: false, from: '', until: '', reason: '', summary: '' },
        { id: 'b', lines: ['M1'], closedStops: ['Natolin'], wholeLine: false, from: '', until: '', reason: '', summary: '' },
      ]),
      asked,
    );
    expect([...out.keys()]).toEqual(['b']);
    expect(out.get('b')?.closedStops).toEqual(['Natolin']);
  });

  it('accepts an empty closure list as a real answer', () => {
    const out = parseReadings(
      reply([{ id: 'a', lines: ['M1'], closedStops: [], wholeLine: false, from: '', until: '', reason: '', summary: 'Zwiększona częstotliwość.' }]),
      asked,
    );
    expect(out.get('a')?.closedStops).toEqual([]);
  });

  /*
   * A row with no station list at all is not a reading. Storing one would mark the item read and
   * take it out of the escalation `impactOf` applies to unread items — filing it, silently, as
   * somebody else's problem.
   */
  it('refuses a row that says nothing about stations', () => {
    const out = parseReadings(reply([{ id: 'a', lines: ['M1'], summary: 'coś się dzieje' }]), asked);
    expect(out.size).toBe(0);
  });

  it('survives anything unparseable, yielding no reading rather than throwing', () => {
    expect(parseReadings(undefined, asked).size).toBe(0);
    expect(parseReadings('not json', asked).size).toBe(0);
    expect(parseReadings('{"items":"nope"}', asked).size).toBe(0);
    expect(parseReadings(reply([null, 7, 'x']), asked).size).toBe(0);
  });

  it('drops a line it does not recognise', () => {
    const out = parseReadings(
      reply([{ id: 'a', lines: ['M1', 'M9'], closedStops: [], wholeLine: false, from: '', until: '', reason: '', summary: '' }]),
      asked,
    );
    expect(out.get('a')?.lines).toEqual(['M1']);
  });

  /*
   * A station name is a free string on purpose — an enum would turn "a station I have never heard
   * of" into "the nearest one I was offered". The unknown name reaches `impactOf`, which escalates.
   */
  it('keeps a station name it cannot place, rather than dropping or correcting it', () => {
    const out = parseReadings(
      reply([{ id: 'a', lines: ['M1'], closedStops: ['Chrzanów'], wholeLine: false, from: '', until: '', reason: '', summary: '' }]),
      asked,
    );
    expect(out.get('a')?.closedStops).toEqual(['Chrzanów']);
  });
});

describe('parseWhen', () => {
  it('reads an ISO time with the Warsaw offset', () => {
    expect(parseWhen('2026-08-27T20:00:00+02:00', NOW)).toBe(Date.parse('2026-08-27T18:00:00Z'));
  });

  it('is null for a time the notice did not state', () => {
    expect(parseWhen('', NOW)).toBeNull();
    expect(parseWhen('do odwołania', NOW)).toBeNull();
  });

  /*
   * A model asked for a date it was not given will occasionally supply one. A closure six months
   * either side of its own announcement is an invention, and storing it puts a card on screen
   * claiming a disruption that ended before it began.
   */
  it('refuses a date impossibly far from the announcement', () => {
    expect(parseWhen('2019-01-01T00:00:00+01:00', NOW)).toBeNull();
    expect(parseWhen('2030-01-01T00:00:00+01:00', NOW)).toBeNull();
  });
});

describe('readingUpdate', () => {
  it('always writes a closure list, so an unread item and a no-closure one stay distinguishable', () => {
    const update = readingUpdate(item(), { summary: 'x' }, NOW);
    expect(update.closedStops).toEqual([]);
    expect(update.wholeLine).toBe(false);
    expect(update.extractHash).toBe(extractHashOf(item()));
  });

  it('clears a previous failure rather than leaving it on the card', () => {
    expect(readingUpdate(item({ extractError: 'timed out' }), { closedStops: [] }, NOW).extractError).toBe('');
  });
});
