/*
 * Reading WTP's two RSS feeds.
 *
 * The parsing is ordinary WordPress RSS. What is not ordinary, and what most of this file is about,
 * is **how this source fails**.
 *
 * wtp.waw.pl sits behind CloudFront with AWS WAF in front of it, and a request the WAF wants to
 * challenge does not come back as an error. It comes back as `HTTP 202`, with
 * `x-amzn-waf-action: challenge`, a `content-type` of `text/html`, and **a body of zero bytes** —
 * which `response.ok` calls a success and an RSS parser reads as a feed containing no items. Left
 * alone, that means the app's answer to "is anything wrong with the metro?" becomes a confident
 * "no" on precisely the days it cannot see. Verified against the live site while this was written:
 * a plain request from a datacentre IP gets exactly that.
 *
 * So the rule here is: **a body that is not a feed is an error, never an empty feed.** Three checks
 * enforce it, and all three are needed —
 *
 *   1. `x-amzn-waf-action` on the response, which names the problem outright when it is present.
 *   2. A zero-length or tiny body, which is what the challenge actually delivers.
 *   3. A body that does not contain `<rss` or `<feed`, which catches an error page served with a
 *      200 as well as any future shape of interstitial.
 *
 * and the failure carries the status, the byte count and the first bytes of what did arrive, into
 * `FeedFetch`, so the Raw tab can show what came back instead of a feed. That row is the difference
 * between "the metro is fine" and "we have not been able to look since Tuesday".
 *
 * If this ever does start being challenged in production, the fix is not in this file: it is
 * `functions/README.md`'s note about the collector's egress. Nothing here should learn to solve a
 * WAF challenge.
 */

import { decodeEntities, stripTags } from '../sources/html';
import { WTP_FEEDS } from '../../../korczak-xyz/src/utils/transit/sources';
import { linesInTitle } from '../../../korczak-xyz/src/utils/transit/lines';
import { contentHashOf, transitIdFor } from '../../../korczak-xyz/src/utils/transit/normalize';
import type { FeedKind, RawFeedItem, TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

/** How long a communiqué's prose may be before it is cut. Enough for the whole of a long one. */
const BODY_LIMIT = 4000;
/** How much of an item's XML the archive keeps. Generous: this exists to be read when things break. */
const RAW_LIMIT = 20000;
/** Below this, no HTTP body is a feed. The WAF challenge delivers zero; a stub error page a few hundred. */
const MIN_FEED_BYTES = 200;

const ITEM = /<item[\s>]([\s\S]*?)<\/item>/g;

export interface FetchOutcome {
  feed: FeedKind;
  url: string;
  ok: boolean;
  status?: number;
  bytes: number;
  items: TransitItem[];
  raw: RawFeedItem[];
  /** The first bytes of a body that was not a feed. The whole point of recording a failure. */
  bodyHead?: string;
  error?: string;
}

export interface FetchContext {
  now: number;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Both feeds, each reported separately: one being down must not hide the other still working. */
export async function fetchWtpFeeds(ctx: FetchContext): Promise<FetchOutcome[]> {
  const out: FetchOutcome[] = [];
  for (const entry of WTP_FEEDS) out.push(await fetchWtpFeed(ctx, entry.feed, entry.url));
  return out;
}

export async function fetchWtpFeed(
  ctx: FetchContext,
  feed: FeedKind,
  url: string,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? 25000);
  try {
    const response = await ctx.fetch(url, {
      signal: controller.signal,
      headers: {
        /*
         * A browser-shaped Accept and a named agent. Not an attempt to get past anything — a WAF
         * challenge is not defeated by a header — but WordPress does content-negotiate, and a
         * client that says nothing about itself is the one most likely to be served something
         * other than the feed.
         */
        accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        'accept-language': 'pl-PL,pl;q=0.9',
        'user-agent': 'korczak.xyz transit watch (+https://korczak.xyz)',
      },
    });

    const body = await response.text();
    const bytes = body.length;
    const wafAction = response.headers.get('x-amzn-waf-action') ?? undefined;

    const failure = notAFeed(response.status, response.ok, body, wafAction);
    if (failure) {
      return { feed, url, ok: false, status: response.status, bytes, items: [], raw: [], bodyHead: head(body), error: failure };
    }

    const parsed = parseWtpFeed(body, feed, ctx.now);
    return { feed, url, ok: true, status: response.status, bytes, ...parsed };
  } catch (e) {
    return {
      feed,
      url,
      ok: false,
      bytes: 0,
      items: [],
      raw: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why this response is not a feed, or undefined if it is one.
 *
 * Pure and exported so the cases that matter are unit tests rather than a live experiment. Read the
 * header of this file before loosening any of these: every one of them turns a silent all-clear
 * into a visible failure, which is the whole of what this source needs from its error handling.
 */
export function notAFeed(
  status: number,
  ok: boolean,
  body: string,
  wafAction?: string,
): string | undefined {
  if (wafAction) return `blocked by WAF (${wafAction}), HTTP ${status}`;
  if (!ok) return `HTTP ${status}`;
  // A 202 is the challenge's own status code, and it is never how a feed is served.
  if (status === 202) return `HTTP 202 with no feed — the request was challenged, not answered`;
  if (body.length < MIN_FEED_BYTES) return `HTTP ${status} with ${body.length} bytes — not a feed`;
  if (!/<rss[\s>]|<feed[\s>]/i.test(body)) return `HTTP ${status} returned ${body.length} bytes that are not RSS`;
  return undefined;
}

function head(body: string): string {
  return body.slice(0, 500);
}

/**
 * One feed's XML into items and their archive rows.
 *
 * Both are produced here, from the same pass, so an item can never be in the corpus without its
 * source being in the archive. Keeping the two apart would let the archive quietly fall behind
 * exactly when it is needed — the run where parsing went wrong.
 */
export function parseWtpFeed(
  xml: string,
  feed: FeedKind,
  now: number,
): { items: TransitItem[]; raw: RawFeedItem[] } {
  const items: TransitItem[] = [];
  const raw: RawFeedItem[] = [];

  for (const match of xml.matchAll(ITEM)) {
    const element = match[1];
    const title = tag(element, 'title');
    const link = tag(element, 'link');
    const guid = tag(element, 'guid') ?? link;
    if (!guid) continue;

    const id = transitIdFor(feed, guid);
    const publishedAt = parsePubDate(tag(element, 'pubDate')) ?? now;

    /*
     * Archived whether or not it parsed. An archive that keeps only what was understood cannot
     * answer the question it exists for — which is what the feed said on the run that went wrong.
     */
    raw.push({
      id,
      feed,
      guid,
      title: title ?? '',
      url: link ?? guid,
      publishedAt,
      xml: match[0].slice(0, RAW_LIMIT),
      fetchedAt: now,
      parsed: Boolean(title && link),
    });

    if (!title || !link) continue;

    /*
     * `content:encoded` is where WordPress puts the article; `description` is the excerpt. Both are
     * taken, longest wins — WTP has been seen publishing items with one, the other, and both, and
     * the extractor's answer is only as good as the prose it is shown.
     */
    const encoded = tag(element, 'content:encoded');
    const description = tag(element, 'description');
    const prose = [encoded, description]
      .filter((v): v is string => Boolean(v))
      .sort((a, b) => b.length - a.length)[0];
    const body = prose ? stripTags(prose).slice(0, BODY_LIMIT) : undefined;

    items.push({
      id,
      feed,
      guid,
      title,
      url: link,
      ...(body ? { body } : {}),
      publishedAt,
      titleLines: linesInTitle(title),
      contentHash: contentHashOf({ title, body }),
      firstSeenAt: now,
      updatedAt: now,
    });
  }

  return { items, raw };
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!match) return undefined;
  // CDATA is how WordPress carries a headline containing an ampersand, and how it carries the
  // whole of `content:encoded`.
  const inner = match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(inner).trim() || undefined;
}

/**
 * `pubDate` as epoch ms, or null.
 *
 * RFC 822 with a numeric offset, which `Date.parse` handles. Null rather than `now` on failure, so
 * the caller decides — and it decides on `now`, because an item with no date is still an item and
 * dropping it would lose a real communiqué over a formatting change.
 */
export function parsePubDate(text: string | undefined): number | null {
  if (!text) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? at : null;
}
