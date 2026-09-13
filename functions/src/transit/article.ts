/*
 * Fetching the communiqué WTP did not put in its feed.
 *
 * ### What this is for
 *
 * Every item in both WTP feeds carries a `<description>` and a `<content:encoded>`, and for a metro
 * communiqué both of them are **the article's headline, restated, and nothing else**. The morning of
 * 12 Sep 2026 the M1 was cut between Słodowiec and Dworzec Gdański and ran as two loops; the RSS
 * item for it said, in full:
 *
 *     ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.
 *
 * The extractor read that sentence, correctly found no station in it, and stored `closedStops: []`.
 * `impactOf` reads an empty list as a *read* item — `certain: true` — so the closure was filed at
 * line level and the card said **No station closed** with a current `extractHash` beside it. Every
 * component was doing its job on the text it was given, and the text was a headline.
 *
 * That is not one bad item. Every `body` in the corpus is one sentence, so *no* metro communiqué
 * could produce a station list: the station tables, the range expansion and the interval overlap
 * that this app is built around were being fed prose that has never once named a station.
 *
 * ### The two halves, and why they are separate
 *
 * `hasProse` is the half that needs no network: a headline is never read, so the item stays unread
 * and `impactOf` escalates it to route level as uncertain. That restores the resolve-upward rule
 * whatever happens here. This file is the half that makes the reading possible at all — it fetches
 * the page behind the row and stores its prose as `article`, which `proseOf` then prefers.
 *
 * They are separate because this one can be taken away from us. wtp.waw.pl is behind AWS WAF (see
 * `wtp.ts`), and although the feed is served, the article pages may not be from every egress — a
 * plain request for one from a datacentre address returns CloudFront's `403 Request blocked`. If
 * that is what this collector gets, `articleError` records it, `hasProse` stays false, and the app
 * shouts about metro items it cannot read rather than clearing them. Losing the fetch costs
 * precision; it cannot cost the guarantee.
 *
 * ### Once per feed revision, and nothing on a timer
 *
 * `needsArticle` asks for a page once per revision of the RSS row, and `mergeItem` is what makes
 * that the right unit: WTP rewriting the feed text drops the stored article, so the next run
 * fetches the page again. The one exception is a fetch that *failed*, retried while the notice is
 * still recent — see `RETRY_FAILURE_MS`, and note that it is a property of the WAF rather than of
 * the page that makes it worth asking twice.
 *
 * What is given up is an edit *confined to the article body* while the RSS row stays identical, and
 * that is a deliberate gap rather than an oversight. The alternative is re-fetching every live item
 * on every ten-minute run, and since `contentHash` covers the article, any part of that page which
 * changes between fetches (a rendered "stan na" timestamp would do it) becomes a fresh
 * `alertIdFor` and a fresh push, every run, for as long as the incident lasts. Re-reading a
 * developing closure on a timer is the obvious next step and it needs a measurement first: whether
 * two fetches of one live article a few minutes apart are byte-identical.
 */

import { articleText } from '../sources/html';
import { contentHashOf, feedHashOf, hasProse } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';
import { isExtractable } from './extract';

/** One page. Short: a page that hangs must not hold up a run that is due again in ten minutes. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The same cap `wtp.ts` puts on a feed body. Enough for the whole of a long communiqué. */
const ARTICLE_CHARS = 4000;
/**
 * A ceiling per run.
 *
 * The metro produces about eight communiqués a month, so in steady state this is one fetch every
 * few days. The number exists for the first run after a deploy, when a fortnight of unread items is
 * in the backlog at once — and to make sure a bug here can never turn into a hundred requests
 * against somebody else's server.
 */
const MAX_PER_RUN = 10;
const CONCURRENCY = 2;

export interface ArticleOutcome {
  /** Pages fetched that yielded text. */
  fetched: number;
  /** Asked for and not got: a block, a timeout, a page with no `<article>` in it. */
  failed: number;
  /** Of the fetched ones, how many now carry enough prose to be worth reading. */
  readable: number;
  error?: string;
}

export interface ArticleContext {
  now: number;
  fetch: typeof globalThis.fetch;
  write: (id: string, update: Partial<TransitItem>) => Promise<void>;
}

/**
 * How long a *failed* fetch keeps being retried.
 *
 * The latch below is what stops a page that will not load being asked for every ten minutes until
 * it is swept, and on its own it is slightly too strict: the failure this source actually has is a
 * WAF challenge, which is a property of the moment rather than of the page, and one 403 during the
 * morning the M1 is cut would freeze that closure into "no details" for its whole life. So a
 * failure is retried while the notice is new enough for the answer to be worth having. Two hours is
 * about as long as anyone acts on an impediment, and it bounds a permanently blocked page at a
 * dozen requests rather than at four thousand.
 *
 * A *successful* fetch is never retried by this: `articleUpdate` writes an empty `articleError`,
 * which is how the two are told apart.
 */
const RETRY_FAILURE_MS = 2 * 3600_000;

/**
 * Whether to ask for this item's page.
 *
 * The cheap gate first, then "do we already have prose", then the latch. `articleFetchedFor` is set
 * on every attempt, successful or not, and `mergeItem` clearing it when WTP edits the row is what
 * lets a genuine update through — an edited row means an edited page.
 */
export function needsArticle(item: TransitItem, now: number): boolean {
  if (!isExtractable(item)) return false;
  if (hasProse(item)) return false;
  if (item.articleFetchedFor === undefined) return true;
  // Tried at this revision. Only a failure is worth asking about again, and only while it matters.
  return Boolean(item.articleError) && now - item.publishedAt < RETRY_FAILURE_MS;
}

/** Newest first: a closure this morning is worth a page before a fortnight-old planned change. */
export function queueForArticles(items: TransitItem[], now: number): TransitItem[] {
  return items.filter((item) => needsArticle(item, now)).sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * One article's prose, or the reason there is none.
 *
 * Never throws and never returns a partial success: a page that 403s, times out, or turns out to
 * have no `<article>` element in it all come back the same way, because all three leave the item in
 * the same state — unread, and escalated by `impactOf` rather than cleared.
 */
export async function fetchArticle(
  fetchImpl: typeof globalThis.fetch,
  url: string,
): Promise<{ text: string } | { error: string }> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'pl-PL,pl;q=0.9',
        'user-agent': 'korczak.xyz transit watch (+https://korczak.xyz)',
      },
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const text = articleText(await response.text(), ARTICLE_CHARS);
    if (!text) return { error: 'no <article> element in the page' };
    return { text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The fields to write for one fetched page.
 *
 * `contentHash` is recomputed here because the extractor runs next in the same run and keys on it:
 * left at the feed-only digest, the item would be handed to the model with an `extractHash` that
 * already matched, and the page fetched a second ago would never be read. `articleFetchedFor` is
 * the **feed's** digest, not this new one — it records which revision of the RSS row was asked
 * about, which is the question `mergeItem` puts to it.
 */
export function articleUpdate(item: TransitItem, text: string): Partial<TransitItem> {
  return {
    article: text,
    contentHash: contentHashOf({ title: item.title, body: item.body, article: text }),
    articleFetchedFor: feedHashOf(item),
    // Cleared explicitly rather than dropped: `stripUndefined` would leave last week's failure
    // sitting beside a page that has just been read perfectly well.
    articleError: '',
  };
}

/** The fields to write when the page could not be read. The article already held, if any, stands. */
export function articleFailure(item: TransitItem, error: string): Partial<TransitItem> {
  return { articleFetchedFor: feedHashOf(item), articleError: error.slice(0, 300) };
}

/**
 * Fetch what needs fetching, within this run's budget.
 *
 * Returns the updated records as well as writing them, for the reason `extractItems` does: the
 * extractor runs next on what this hands back, and given the pre-fetch copies it would find no
 * prose on every one of them and read nothing at all.
 */
export async function fetchArticles(
  items: TransitItem[],
  ctx: ArticleContext,
): Promise<{ items: TransitItem[]; outcome: ArticleOutcome }> {
  const queue = queueForArticles(items, ctx.now).slice(0, MAX_PER_RUN);
  if (queue.length === 0) return { items, outcome: { fetched: 0, failed: 0, readable: 0 } };

  let fetched = 0;
  let failed = 0;
  let readable = 0;
  let firstError: string | undefined;
  const updates = new Map<string, Partial<TransitItem>>();

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue[next++];
      if (!item) return;

      const result = await fetchArticle(ctx.fetch, item.url);
      const update =
        'text' in result ? articleUpdate(item, result.text) : articleFailure(item, result.error);

      if ('text' in result) {
        fetched += 1;
        if (hasProse({ ...item, article: result.text })) readable += 1;
      } else {
        failed += 1;
        firstError ??= result.error;
      }

      /*
       * A write that fails is not a run that fails — the item stays unread, which is the state it
       * was already in. The one thing that must not happen is the in-memory copy claiming prose
       * the database did not keep, so the update is recorded only once the write has come back.
       */
      try {
        await ctx.write(item.id, update);
        updates.set(item.id, update);
      } catch {
        /* left for the next run */
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    items: items.map((item) => {
      const update = updates.get(item.id);
      return update ? { ...item, ...update } : item;
    }),
    outcome: { fetched, failed, readable, ...(firstError ? { error: firstError } : {}) },
  };
}
