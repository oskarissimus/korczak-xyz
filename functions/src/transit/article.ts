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
 * ### Three doors, and none of them is a way through a locked one
 *
 * 1. **The alerts mirror** (`alerts.ts`) — `WarsawGTFS` scrapes the same two WTP pages into a
 *    CC0 GTFS-Realtime feed and publishes it as JSON, one row per communiqué, keyed by WTP's own
 *    post id and carrying the full body. One request for the whole run, and as of 14 Sep 2026 the
 *    only door that answers.
 * 2. **WordPress's REST route** (`wpRestUrlFor` — the guid states the post type and id outright).
 * 3. **The HTML page.**
 *
 * Doors 2 and 3 are public endpoints of WTP's own site, asked once each with the same identifying
 * agent. Both are challenged from this egress; they are kept anyway, because door 1 is one
 * volunteer's server and the doors that are shut today are the ones that still work the day it
 * stops. Everything failing is an ordinary outcome and the item stays unread.
 *
 * The WAF here **rules per path** — both RSS feeds are served to this collector while the article
 * pages are challenged — which is what made doors 2 and 3 worth measuring rather than assuming.
 *
 * ### The two halves, and why they are separate
 *
 * `hasProse` is the half that needs no network: a headline is never read, so the item stays unread
 * and `impactOf` escalates it to route level as uncertain. That restores the resolve-upward rule
 * whatever happens here. This file is the half that makes the reading possible at all — it fetches
 * the page behind the row and stores its prose as `article`, which `proseOf` then prefers.
 *
 * They are separate because this one can be taken away from us, and for WTP's own endpoints it
 * has been. wtp.waw.pl is behind AWS WAF (see `wtp.ts`), and while the two feeds are served, an
 * article page or REST route from this collector's egress comes back as a challenge: `HTTP 202`,
 * two kilobytes of Javascript, no content — measured 13 and 14 Sep 2026. `articleError` records it,
 * `hasProse` stays false, and the app shouts about metro items it cannot read rather than clearing
 * them. Losing every door costs precision; it cannot cost the guarantee — which is the whole reason
 * `needsExtracting` refuses a headline on its own rather than trusting that the prose arrived.
 *
 * Nothing here should learn to solve a WAF challenge; `functions/README.md` holds what to do about
 * the collector's egress if this is to be fixed.
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
import { wafChallenge } from './wtp';
import { EMPTY_INDEX, fetchAlerts, postIdOf, type AlertIndex } from './alerts';
import { contentHashOf, feedHashOf, hasProse } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';
import { isExtractable } from './extract';

/** One page. Short: a page that hangs must not hold up a run that is due again in ten minutes. */
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Below this, nothing that came back is a communiqué page.
 *
 * `wtp.ts`'s `MIN_FEED_BYTES` reasoning, for a document rather than a feed. The WAF challenge is
 * caught by its status before this ever runs; this is for a stub error page served with a 200.
 */
const MIN_PAGE_BYTES = 500;
/**
 * Bump to ask for every page again.
 *
 * The same lever, for the same reason, as `EXTRACTOR_VERSION`: `articleFetchedFor` latches an item
 * against asking twice, and when the thing that changes is **our reading of the page** rather than
 * the page, nothing about the stored row says the answer is stale. It shipped at 1 and went to 2
 * the same evening — the first production run reported `no <article> element in the page` for
 * three items, which was this file taking an HTTP 202 WAF challenge for a redesign. Without a lever
 * those three would have stayed latched on a wrong verdict until WTP happened to edit them. 3 is
 * `wpRestUrlFor`: a door that was not tried before is a different question, not a stale answer, and
 * 4 is the alerts mirror — the first door that has ever actually answered.
 */
const ARTICLE_VERSION = 4;
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
  /** Communiqués whose prose was got, by whichever door. */
  fetched: number;
  /** Asked for and not got: a block, a timeout, a page with no `<article>` in it. */
  failed: number;
  /** Of those, how many now carry enough prose to be worth reading. */
  readable: number;
  /** How many came from the alerts mirror rather than from WTP directly. */
  fromAlerts: number;
  /**
   * How many live alerts the mirror held this run.
   *
   * On the record because zero has two meanings that need telling apart: a quiet evening, and a
   * mirror that has stopped. Without the count the second one is invisible — every item simply goes
   * on being escalated, which is safe and says nothing about why.
   */
  alertCount: number;
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
  // Never asked at this revision, or asked by a build that read pages differently.
  if (item.articleFetchedFor !== articleStampOf(item)) return true;
  // Tried at this revision. Only a failure is worth asking about again, and only while it matters.
  return Boolean(item.articleError) && now - item.publishedAt < RETRY_FAILURE_MS;
}

/** Newest first: a closure this morning is worth a page before a fortnight-old planned change. */
export function queueForArticles(items: TransitItem[], now: number): TransitItem[] {
  return items.filter((item) => needsArticle(item, now)).sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * The same communiqué as WordPress's own JSON, or undefined where the guid is not that shape.
 *
 * wtp.waw.pl is WordPress, and its guid states as much: `?post_type=impediment&p=176873` is a post
 * type and a post id, which is exactly what the REST route wants. So the article is reachable a
 * second way — `/wp-json/wp/v2/impediment/176873`, whose `content.rendered` is the body without a
 * page of chrome around it.
 *
 * **This is a second door, not a way through a locked one.** It is the site's own public API, asked
 * with the same identifying agent, at the same one-request-per-communiqué; if the WAF challenges it
 * too then that is the answer and the item stays unread. It is worth trying only because the WAF
 * demonstrably rules per path rather than per client here — both RSS feeds are served to this
 * collector while the HTML pages are challenged, so which side of that line the REST route falls on
 * is a fact to measure rather than assume.
 *
 * Derived from the guid rather than from `url`, because the guid is the one field guaranteed to
 * carry the id: `url` is the pretty permalink and says nothing about which post it is.
 */
export function wpRestUrlFor(item: Pick<TransitItem, 'guid'>): string | undefined {
  const type = /[?&]post_type=([a-z_]+)/i.exec(item.guid)?.[1];
  const id = /[?&]p=(\d+)/.exec(item.guid)?.[1];
  if (!type || !id) return undefined;
  const host = (() => {
    try {
      return new URL(item.guid).origin;
    } catch {
      return undefined;
    }
  })();
  return host ? `${host}/wp-json/wp/v2/${type}/${id}` : undefined;
}

const HEADERS = {
  'accept-language': 'pl-PL,pl;q=0.9',
  'user-agent': 'korczak.xyz transit watch (+https://korczak.xyz)',
};

/** One request, with every way this host says no turned into a reason. Never throws. */
async function fetchText(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  accept: string,
): Promise<{ body: string; status: number } | { error: string }> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...HEADERS, accept },
    });
    const challenged = wafChallenge(response.status, response.headers.get('x-amzn-waf-action') ?? undefined);
    if (challenged) return { error: challenged };
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return { body: await response.text(), status: response.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * One communiqué's prose, or the reason there is none.
 *
 * Three doors, tried in order, because they fail independently and because the cheapest is also the
 * only one that currently answers:
 *
 *   1. **The alerts mirror**, already fetched once for the whole run and handed in as an index —
 *      no request per item at all. It is the operator's own body, joined on the operator's own post
 *      id. It holds *live* alerts only, so it is silent about anything already over.
 *   2. **WordPress's REST route**, which returns the body without chrome and survives the page
 *      template being redesigned.
 *   3. **The page**, which survives the REST API being switched off.
 *
 * Both of the direct doors are challenged from this collector's egress as of 14 Sep 2026, and they
 * are kept anyway: the mirror is one volunteer's server, and a door that is shut today is the one
 * that still works the day that server stops. **Everything failing is an ordinary outcome** — the
 * item stays unread, `impactOf` escalates it, and the card says WTP published no details. The error
 * names what each door said, because "not in the mirror, then challenged twice" and "challenged,
 * then the markup moved" send whoever reads it to different places.
 *
 * Never throws and never returns a partial success: a page that 403s, times out, or turns out to
 * hold no article all come back the same way.
 */
export async function fetchArticle(
  fetchImpl: typeof globalThis.fetch,
  item: Pick<TransitItem, 'guid' | 'url'>,
  alerts: AlertIndex = EMPTY_INDEX,
): Promise<{ text: string } | { error: string }> {
  const reasons: string[] = [];

  const postId = postIdOf(item);
  const alert = postId ? alerts.byPostId.get(postId) : undefined;
  if (alert) return { text: alert.body };
  reasons.push(
    alerts.error
      ? `alerts: ${alerts.error}`
      : `alerts: not among ${alerts.count} live`,
  );

  const restUrl = wpRestUrlFor(item);
  if (restUrl) {
    const got = await fetchText(fetchImpl, restUrl, 'application/json');
    if ('error' in got) {
      reasons.push(`api: ${got.error}`);
    } else {
      const text = renderedContentOf(got.body);
      if (text) return { text };
      reasons.push(`api: ${got.body.length} bytes with no content.rendered`);
    }
  }

  const got = await fetchText(fetchImpl, item.url, 'text/html,application/xhtml+xml');
  if ('error' in got) {
    reasons.push(`page: ${got.error}`);
  } else if (got.body.length < MIN_PAGE_BYTES) {
    reasons.push(`page: HTTP ${got.status} with ${got.body.length} bytes — not a page`);
  } else {
    const text = articleText(got.body, ARTICLE_CHARS);
    if (text) return { text };
    // A page that arrived and holds no <article> is the markup having moved, and it has to be
    // distinguishable from a page that never arrived — see `wafChallenge`.
    reasons.push(`page: no <article> element in ${got.body.length} bytes`);
  }

  return { error: reasons.join('; ') };
}

/**
 * `content.rendered` out of a WordPress REST reply, as text.
 *
 * Total by construction, like `parseReadings`: a body that is not JSON, an object without the
 * field, a field that is not a string all yield `''`, which the caller reads as this door being
 * shut. The HTML inside is stripped with `articleText`'s own rules rather than a second set — the
 * theatre's tables taught this repo that flattening block tags without newlines joins two facts
 * that were never adjacent.
 */
export function renderedContentOf(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return '';
  }
  const content = (parsed as { content?: { rendered?: unknown } })?.content?.rendered;
  if (typeof content !== 'string' || !content) return '';
  // `articleText` wants an <article> to narrow to; the REST reply is already only the body, so it
  // is wrapped rather than searched.
  return articleText(`<article>${content}</article>`, ARTICLE_CHARS);
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
    articleFetchedFor: articleStampOf(item),
    // Cleared explicitly rather than dropped: `stripUndefined` would leave last week's failure
    // sitting beside a page that has just been read perfectly well.
    articleError: '',
  };
}

/** The fields to write when the page could not be read. The article already held, if any, stands. */
export function articleFailure(item: TransitItem, error: string): Partial<TransitItem> {
  return { articleFetchedFor: articleStampOf(item), articleError: error.slice(0, 300) };
}

/** What a fetch records having been made against: this build, and the feed revision it saw. */
export function articleStampOf(item: Pick<TransitItem, 'title' | 'body'>): string {
  return `${ARTICLE_VERSION}:${feedHashOf(item)}`;
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
  if (queue.length === 0) {
    return { items, outcome: { fetched: 0, failed: 0, readable: 0, fromAlerts: 0, alertCount: 0 } };
  }

  /*
   * One request for the whole run, before any per-item work. It holds every live alert, so asking
   * per item would be the same bytes fetched six times from a volunteer's server — and the count it
   * comes back with is a health signal in its own right: a mirror that has quietly started
   * returning nothing looks exactly like a quiet evening unless the number is on the record.
   */
  const alerts = await fetchAlerts(ctx.fetch);
  if (alerts.error) console.warn('transit alerts mirror', alerts.error);

  let fetched = 0;
  let failed = 0;
  let readable = 0;
  let fromAlerts = 0;
  let firstError: string | undefined;
  const updates = new Map<string, Partial<TransitItem>>();

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue[next++];
      if (!item) return;

      const postId = postIdOf(item);
      if (postId && alerts.byPostId.has(postId)) fromAlerts += 1;
      const result = await fetchArticle(ctx.fetch, item, alerts);
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
    outcome: {
      fetched,
      failed,
      readable,
      fromAlerts,
      alertCount: alerts.count,
      ...(firstError ? { error: firstError } : {}),
    },
  };
}
