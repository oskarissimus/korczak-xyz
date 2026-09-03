import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchWtpFeed, notAFeed, parsePubDate, parseWtpFeed } from './wtp';

const FIXTURES = join(new URL('.', import.meta.url).pathname, 'fixtures');
const impediments = readFileSync(join(FIXTURES, 'impediment.xml'), 'utf8');
const changes = readFileSync(join(FIXTURES, 'change.xml'), 'utf8');

const NOW = Date.parse('2026-09-03T18:00:00Z');

describe('parsing WTP feeds', () => {
  it('reads every item and archives every one of them', () => {
    const { items, raw } = parseWtpFeed(impediments, 'impediment', NOW);
    expect(items).toHaveLength(4);
    expect(raw).toHaveLength(4);
    expect(raw.every((row) => row.parsed)).toBe(true);
  });

  it('reads the line list out of the headline', () => {
    const { items } = parseWtpFeed(impediments, 'impediment', NOW);
    expect(items[0].titleLines).toEqual(['M1']);
    expect(items[1].titleLines).toEqual(['742', 'M1']);
    expect(items[3].titleLines).toEqual(['189', '401', '402']);
  });

  it('takes the article body out of content:encoded, tags gone', () => {
    const { items } = parseWtpFeed(impediments, 'impediment', NOW);
    expect(items[0].body).toContain('awarii taboru');
    expect(items[0].body).toContain('Wilanowska');
    expect(items[0].body).not.toContain('<strong>');
    // The entity WordPress uses for an en dash has to survive into the prose the model reads.
    expect(items[0].body).toContain('–');
  });

  it('reads the publication date', () => {
    const { items } = parseWtpFeed(impediments, 'impediment', NOW);
    expect(new Date(items[0].publishedAt).toISOString()).toBe('2026-08-27T18:10:00.000Z');
  });

  it('gives an item the same id in both halves, so a card can find its own source', () => {
    const { items, raw } = parseWtpFeed(changes, 'change', NOW);
    expect(items.map((i) => i.id)).toEqual(raw.map((r) => r.id));
  });

  it('derives an id that survives an edit to the article', () => {
    const first = parseWtpFeed(impediments, 'impediment', NOW).items[0];
    const edited = parseWtpFeed(impediments.replace('awarii taboru', 'awarii zasilania'), 'impediment', NOW + 60000)
      .items[0];
    expect(edited.id).toBe(first.id);
    // …while the content hash moves, which is what lets the edit raise a second alert.
    expect(edited.contentHash).not.toBe(first.contentHash);
  });

  it('keeps the two feeds apart even for an identical permalink', () => {
    const a = parseWtpFeed(impediments, 'impediment', NOW).items[0];
    const b = parseWtpFeed(impediments, 'change', NOW).items[0];
    expect(a.id).not.toBe(b.id);
  });

  it('finds nothing in a body that is not a feed, without throwing', () => {
    expect(parseWtpFeed('', 'change', NOW).items).toEqual([]);
    expect(parseWtpFeed('<html><body>nope</body></html>', 'change', NOW).items).toEqual([]);
  });
});

/*
 * The failure this source actually has. See the header of wtp.ts: a challenged request returns
 * HTTP 202 with an empty body, which `response.ok` calls a success and an RSS parser reads as a
 * feed with no items — i.e. as "nothing is wrong with the metro". Every case below turns that into
 * a recorded error instead.
 */
describe('telling a feed from a WAF challenge', () => {
  it('catches the challenge by its header', () => {
    expect(notAFeed(202, true, '', 'challenge')).toMatch(/WAF/);
  });

  it('catches it by its status even without the header', () => {
    expect(notAFeed(202, true, '')).toMatch(/challenged/);
  });

  it('catches a body too small to be a feed', () => {
    expect(notAFeed(200, true, '<html></html>')).toMatch(/not a feed/);
  });

  it('catches an error page served with a 200', () => {
    expect(notAFeed(200, true, '<html>'.padEnd(400, 'x') + '</html>')).toMatch(/not RSS/);
  });

  it('catches an ordinary HTTP error', () => {
    expect(notAFeed(403, false, 'Request blocked.')).toBe('HTTP 403');
  });

  it('passes a real feed', () => {
    expect(notAFeed(200, true, impediments)).toBeUndefined();
  });
});

describe('fetchWtpFeed', () => {
  const respond = (body: string, init: { status?: number; headers?: Record<string, string> } = {}) =>
    (async () =>
      new Response(body, {
        status: init.status ?? 200,
        headers: init.headers,
      })) as unknown as typeof globalThis.fetch;

  it('reports a challenge as a failure with the evidence attached', async () => {
    const outcome = await fetchWtpFeed(
      { now: NOW, fetch: respond('', { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }) },
      'impediment',
      'https://example.test/feed',
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.items).toEqual([]);
    expect(outcome.error).toMatch(/WAF/);
    expect(outcome.status).toBe(202);
    expect(outcome.bytes).toBe(0);
  });

  it('reports a network failure rather than throwing out of the run', async () => {
    const outcome = await fetchWtpFeed(
      {
        now: NOW,
        fetch: (async () => {
          throw new Error('ECONNRESET');
        }) as unknown as typeof globalThis.fetch,
      },
      'change',
      'https://example.test/feed',
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('ECONNRESET');
  });

  it('parses a good response', async () => {
    const outcome = await fetchWtpFeed(
      { now: NOW, fetch: respond(impediments) },
      'impediment',
      'https://example.test/feed',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.items).toHaveLength(4);
  });
});

describe('parsePubDate', () => {
  it('reads RFC 822 with an offset', () => {
    expect(parsePubDate('Thu, 27 Aug 2026 20:10:00 +0200')).toBe(Date.parse('2026-08-27T18:10:00Z'));
  });

  it('is null rather than wrong for something it cannot read', () => {
    expect(parsePubDate('yesterday')).toBeNull();
    expect(parsePubDate(undefined)).toBeNull();
  });
});
