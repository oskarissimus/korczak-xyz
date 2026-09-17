import { describe, expect, it, vi } from 'vitest';
import {
  articleFailure,
  articleUpdate,
  fetchArticle,
  fetchArticles,
  articleStampOf,
  needsArticle,
  queueForArticles,
  renderedContentOf,
  wpRestUrlFor,
} from './article';
import { parseAlerts } from './alerts';
import { contentHashOf, feedHashOf, hasProse } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

const NOW = Date.parse('2026-09-12T07:45:00Z');

/** The 12 Sep 2026 M1 row, as it actually arrived: the headline, twice, and no prose anywhere. */
function item(patch: Partial<TransitItem> = {}): TransitItem {
  const base: TransitItem = {
    id: 'impediment_p-176873',
    feed: 'impediment',
    guid: 'https://www.wtp.waw.pl/?post_type=impediment&p=176873',
    title: 'Utrudnienia w komunikacji: M1',
    url: 'https://www.wtp.waw.pl/utrudnienia/2026/09/12/utrudnienia-w-kursowaniu-pociagow-metra-na-linii-m1-3/',
    body: 'ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.',
    publishedAt: NOW,
    titleLines: ['M1'],
    contentHash: '',
    firstSeenAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
  return { ...base, contentHash: patch.contentHash ?? feedHashOf(base) };
}

const PROSE =
  'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
  'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański. ' +
  'Metro kursuje w dwóch pętlach: Młociny <-> Słodowiec oraz Kabaty <-> Dworzec Gdański.';

const CHROME = `<nav>${'menu '.repeat(60)}</nav>`;
const PAGE = `<html><body><header>${CHROME}</header><article><h1>Utrudnienia</h1><p>${PROSE}</p></article></body></html>`;

function ok(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

describe('which pages get asked for', () => {
  it('asks for a metro item whose feed row is a headline', () => {
    expect(needsArticle(item(), NOW)).toBe(true);
  });

  /* The cheap gate still rules. A fortnight of bus roadworks must not become a fortnight of fetches. */
  it('never asks for a bus one', () => {
    expect(needsArticle(item({ titleLines: ['189', '401'] }), NOW)).toBe(false);
  });

  it('does not ask when the feed carried a communiqué after all', () => {
    expect(needsArticle(item({ body: PROSE }), NOW)).toBe(false);
  });

  /*
   * The latch. Without it every metro item in the corpus is re-fetched every ten minutes for the
   * whole forty-five-day retention, to learn each time that the page says what it said.
   */
  it('never asks twice about a page it read', () => {
    const read = { ...item(), ...articleUpdate(item(), PROSE) };
    expect(needsArticle(read, NOW)).toBe(false);
    expect(needsArticle(read, NOW + 30 * 86400000)).toBe(false);
  });

  /*
   * A failure is retried, but only while the notice is recent. The failure this source has is a WAF
   * challenge — a property of the moment, not of the page — so one 403 during the morning the M1 is
   * cut must not freeze that closure into "no details" for its whole life. Two hours later it is
   * latched, or a page that is permanently gone is requested four thousand times before it is swept.
   */
  it('retries a failure while the notice is fresh, and latches once it is not', () => {
    const failed = { ...item(), ...articleFailure(item(), 'HTTP 403') };
    expect(needsArticle(failed, NOW + 600_000)).toBe(true);
    expect(needsArticle(failed, NOW + 3 * 3600_000)).toBe(false);
  });

  it('takes the newest first: this morning before a fortnight-old planned change', () => {
    const queue = queueForArticles(
      [item({ id: 'old', publishedAt: NOW - 86400000 }), item({ id: 'new', publishedAt: NOW })],
      NOW,
    );
    expect(queue.map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('fetching one', () => {
  it('reads the article element out of the page', async () => {
    const result = await fetchArticle(async () => ok(PAGE), { guid: 'no-id', url: 'https://x.test/a' });
    expect(result).toEqual({ text: expect.stringContaining('Słodowiec – Dworzec Gdański') });
  });

  /*
   * The three ways this source refuses, all landing in the same state. A CloudFront 403 is the one
   * actually observed from a datacentre address — see the header in `wtp.ts` — and it must be a
   * recorded failure rather than an empty article that reads as a quiet notice.
   */
  it('turns every refusal into a reason, never into an empty communiqué', async () => {
    const blocked = {
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: async () => '',
    } as unknown as Response;
    // Prefixed, because an item asks three doors and the reasons must stay tellable apart.
    expect(
      (await fetchArticle(async () => blocked, { guid: 'no-id', url: 'https://x.test/a' })) as { error: string },
    ).toEqual({ error: expect.stringContaining('page: HTTP 403') });
    expect(
      await fetchArticle(async () => ok(`<html><body>no article here${'x'.repeat(600)}</body></html>`), {
        guid: 'no-id',
        url: 'https://x.test/a',
      }),
    ).toEqual({ error: expect.stringContaining('no <article> element') });
    expect(
      await fetchArticle(async () => {
        throw new Error('terminated');
      }, { guid: 'no-id', url: 'https://x.test/a' }),
    ).toEqual({ error: expect.stringContaining('page: terminated') });
  });

  /*
   * The bug this file shipped with, and the reason `wafChallenge` is shared rather than restated.
   * A challenged request is `HTTP 202` with two kilobytes of Javascript — and `response.ok` is true
   * for a 202, so the first production run read the challenge as a page, found no `<article>` in
   * it, and said the markup had moved. "WTP redesigned their site" and "we were blocked" call for
   * opposite things from whoever reads that line.
   */
  it('knows a WAF challenge from a redesign', async () => {
    const challenge = {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: async () => '<!DOCTYPE html><html><head><script>window.gokuProps={}</script></head></html>',
    } as unknown as Response;
    expect(await fetchArticle(async () => challenge, { guid: 'no-id', url: 'https://x.test/a' })).toEqual({
      error: expect.stringContaining('challenged'),
    });

    const flagged = {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'x-amzn-waf-action' ? 'challenge' : null) },
      text: async () => 'x'.repeat(5000),
    } as unknown as Response;
    expect(await fetchArticle(async () => flagged, { guid: 'no-id', url: 'https://x.test/a' })).toEqual({
      error: expect.stringContaining('WAF'),
    });
  });

  it('does not mistake a stub error page for a communiqué', async () => {
    expect(await fetchArticle(async () => ok('<html></html>'), { guid: 'no-id', url: 'https://x.test/a' })).toEqual({
      error: expect.stringContaining('not a page'),
    });
  });
});

describe('the alerts door', () => {
  const ALERT_BODY =
    'Z przyczyn technicznych występują utrudnienia w kursowaniu pociągów metra na linii M1. ' +
    'Ruch pociągów metra został wstrzymany na odcinku Słodowiec – Dworzec Gdański.';
  const index = parseAlerts(
    JSON.stringify({ alerts: [{ id: 'A/IMPEDIMENT/176873', body: ALERT_BODY }] }),
  );

  /*
   * The point of the whole source: the prose arrives without a single request to WTP, joined on the
   * post id that is already in the guid.
   */
  it('answers from the index without asking WTP at all', async () => {
    const asked: string[] = [];
    const result = await fetchArticle(
      async (url) => {
        asked.push(String(url));
        return ok(PAGE);
      },
      item(),
      index,
    );
    expect(result).toEqual({ text: expect.stringContaining('Słodowiec – Dworzec Gdański') });
    expect(asked).toEqual([]);
  });

  /*
   * The mirror carries live alerts only, so an item whose disruption has ended is simply not in it.
   * That must fall through to the doors behind rather than count as an answer.
   */
  it('falls through when the item is not among the live alerts', async () => {
    const result = await fetchArticle(async () => ok(PAGE), item({ guid: 'https://x.test/?p=999' }), index);
    expect(result).toEqual({ text: expect.stringContaining('Słodowiec – Dworzec Gdański') });
  });

  it('says how many live alerts it looked through, so a stopped mirror is not a quiet evening', async () => {
    const challenge = {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: async () => '',
    } as unknown as Response;
    const result = await fetchArticle(async () => challenge, item({ guid: 'https://x.test/?p=999' }), index);
    expect((result as { error: string }).error).toContain('alerts: not among 1 live');
  });

  it('carries the mirror’s own failure into the reason', async () => {
    const dead = parseAlerts('not json');
    const challenge = {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: async () => '',
    } as unknown as Response;
    const result = await fetchArticle(async () => challenge, item(), dead);
    expect((result as { error: string }).error).toContain('alerts:');
    expect((result as { error: string }).error).toContain('not JSON');
  });
});

describe('the REST door', () => {
  /* The guid states the post type and id outright, which is exactly what the REST route wants. */
  it('derives the route from the guid, not from the pretty permalink', () => {
    expect(wpRestUrlFor(item())).toBe('https://www.wtp.waw.pl/wp-json/wp/v2/impediment/176873');
    expect(wpRestUrlFor({ guid: 'https://example.test/some/slug/' })).toBeUndefined();
  });

  it('reads content.rendered, and is total about everything that is not it', () => {
    expect(renderedContentOf(JSON.stringify({ content: { rendered: `<p>${PROSE}</p>` } }))).toContain(
      'Słodowiec – Dworzec Gdański',
    );
    expect(renderedContentOf('not json')).toBe('');
    expect(renderedContentOf('{"content":{}}')).toBe('');
    expect(renderedContentOf('{"content":{"rendered":7}}')).toBe('');
  });

  it('prefers the API, and never asks for the page once it has the prose', async () => {
    const asked: string[] = [];
    const result = await fetchArticle(async (url) => {
      asked.push(String(url));
      return ok(JSON.stringify({ content: { rendered: `<p>${PROSE}</p>` } }));
    }, item());
    expect(result).toEqual({ text: expect.stringContaining('Słodowiec – Dworzec Gdański') });
    expect(asked).toEqual(['https://www.wtp.waw.pl/wp-json/wp/v2/impediment/176873']);
  });

  it('falls back to the page when the API is the door that is shut', async () => {
    const asked: string[] = [];
    const result = await fetchArticle(async (url) => {
      asked.push(String(url));
      return String(url).includes('wp-json')
        ? ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' } as unknown as Response)
        : ok(PAGE);
    }, item());
    expect(result).toEqual({ text: expect.stringContaining('Słodowiec – Dworzec Gdański') });
    expect(asked).toHaveLength(2);
  });

  /*
   * Both doors shut is an ordinary outcome, and the error has to say so in both halves: "challenged
   * twice" and "challenged, then the markup moved" send whoever reads it to different places.
   */
  it('names what both doors said when both are shut', async () => {
    const challenge = {
      ok: true,
      status: 202,
      headers: { get: () => null },
      text: async () => '',
    } as unknown as Response;
    const result = await fetchArticle(async () => challenge, item());
    expect(result).toEqual({ error: expect.stringContaining('api:') });
    expect((result as { error: string }).error).toContain('page:');
  });
});

describe('what a fetch writes', () => {
  /*
   * The hash has to move here, not on the next run. The extractor runs seconds later in the same
   * run and compares `extractHash` against `contentHash`; left at the feed-only digest, a page
   * fetched a moment ago would sit unread until WTP happened to edit the row.
   */
  it('recomputes the content hash so the extractor sees a new revision', () => {
    const row = item();
    const update = articleUpdate(row, PROSE);
    expect(update.contentHash).toBe(contentHashOf({ title: row.title, body: row.body, article: PROSE }));
    expect(update.contentHash).not.toBe(row.contentHash);
    expect(hasProse({ ...row, ...update })).toBe(true);
  });

  it('latches on the feed revision rather than on the one it just minted', () => {
    const row = item();
    expect(articleUpdate(row, PROSE).articleFetchedFor).toContain(feedHashOf(row));
    expect(articleFailure(row, 'HTTP 403').articleFetchedFor).toBe(articleStampOf(row));
  });

  /*
   * The stamp carries the build as well as the revision, so a change to how pages are *read* asks
   * for them again. Without it the three items the first production run latched on a wrong verdict
   * would have kept it until WTP happened to edit their feed rows.
   */
  it('asks again when this build reads pages differently from the one that latched it', () => {
    const stale = { ...item(), articleFetchedFor: `1:${feedHashOf(item())}`, articleError: 'x' };
    expect(needsArticle(stale, NOW + 30 * 86400000)).toBe(true);
  });

  /*
   * The property that makes the date in this string affordable. Both the stamp and the alert id are
   * compared against a value already stored, so a component added unconditionally would invalidate
   * every row at once — dropping the corpus's articles and re-announcing a fortnight of metro
   * history on the deploy. An ordinary row is published before we meet it, so it keeps exactly the
   * stamp it has: the build and the feed digest, and nothing after them.
   */
  it('leaves the stamp of a row published before we met it exactly as it was', () => {
    expect(articleStampOf(item()).split(':')).toHaveLength(2);
    expect(articleStampOf(item()).endsWith(`:${feedHashOf(item())}`)).toBe(true);
  });

  /*
   * And the case it is for. WTP's metro headline is a template — `Utrudnienia w komunikacji: M1`
   * over one sentence restating it — so `feedHashOf` is the same string for every M1 incident there
   * has ever been, and a stored article looked current under a row about a different closure.
   */
  it('asks for the page again when WTP has published the post a second time', () => {
    const latched = item();
    const again = item({ publishedAt: NOW + 86400000 });
    expect(articleStampOf(again)).not.toBe(articleStampOf(latched));
    expect(feedHashOf(again)).toBe(feedHashOf(latched));

    const stale = { ...again, articleFetchedFor: articleStampOf(latched) };
    expect(needsArticle(stale, NOW + 86400000)).toBe(true);
  });

  it('clears a previous failure rather than leaving it beside a page that read fine', () => {
    expect(articleUpdate(item(), PROSE).articleError).toBe('');
  });

  /* A failed re-fetch must never delete prose already held: the card would lose its stop list. */
  it('leaves the stored article alone when a fetch fails', () => {
    expect(articleFailure(item(), 'HTTP 403')).not.toHaveProperty('article');
  });
});

describe('a run', () => {
  /** The mirror, answering with nothing — so a run test exercises the doors behind it. */
  const noAlerts = JSON.stringify({ alerts: [] });
  const routed = (page: Response) => async (url: RequestInfo | URL) =>
    String(url).includes('mkuran.pl') ? ok(noAlerts) : page;

  it('writes what it read and hands the updated copies back', async () => {
    const written = new Map<string, Partial<TransitItem>>();
    const { items, outcome } = await fetchArticles([item(), item({ id: 'bus', titleLines: ['189'] })], {
      now: NOW,
      fetch: routed(ok(PAGE)) as unknown as typeof globalThis.fetch,
      write: async (id, update) => {
        written.set(id, update);
      },
    });

    expect(outcome).toMatchObject({ fetched: 1, failed: 0, readable: 1, fromAlerts: 0 });
    expect([...written.keys()]).toEqual(['impediment_p-176873']);
    // The extractor runs next on these, so the prose has to be on the copies it is handed.
    expect(hasProse(items[0])).toBe(true);
    expect(items[1].article).toBeUndefined();
  });

  it('records a block without losing the run', async () => {
    const { items, outcome } = await fetchArticles([item()], {
      now: NOW,
      fetch: routed({
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: async () => '',
      } as unknown as Response) as unknown as typeof globalThis.fetch,
      write: async () => {},
    });
    expect(outcome).toMatchObject({ fetched: 0, failed: 1, error: expect.stringContaining('HTTP 403') });
    // Still unreadable, which is what keeps `impactOf` escalating it rather than clearing it.
    expect(hasProse(items[0])).toBe(false);
  });

  /*
   * A write that fails leaves the item exactly as it was. The one outcome that must not happen is
   * an in-memory copy carrying prose the database never kept — the extractor would read it, store a
   * reading against a hash nothing else has, and the next run would read it again for ever.
   */
  it('does not claim prose a failed write did not store', async () => {
    const { items } = await fetchArticles([item()], {
      now: NOW,
      fetch: routed(ok(PAGE)) as unknown as typeof globalThis.fetch,
      write: async () => {
        throw new Error('permission denied');
      },
    });
    expect(items[0].article).toBeUndefined();
  });

  it('asks for nothing when there is nothing to ask for', async () => {
    const fetchImpl = vi.fn();
    const { outcome } = await fetchArticles([item({ body: PROSE })], {
      now: NOW,
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      write: async () => {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome).toEqual({ fetched: 0, failed: 0, readable: 0, fromAlerts: 0, alertCount: 0 });
  });
});
