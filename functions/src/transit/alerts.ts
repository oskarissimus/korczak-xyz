/*
 * The communiqués, from the mirror that answers.
 *
 * ### Why this exists
 *
 * WTP publishes the article's headline as the entire body of both RSS feeds, so the prose naming
 * stations lives only on the web page — and that page is behind an AWS WAF which challenges this
 * collector's egress with an `HTTP 202`, measured 13–14 Sep 2026 against feeds that are served
 * normally. Two direct doors were tried (the page, and WordPress's own REST route); both are
 * challenged. See `article.ts`.
 *
 * `WarsawGTFS` scrapes those same two pages — `/utrudnienia/` and `/zmiany/` — into a
 * GTFS-Realtime alerts feed, and publishes a JSON rendering of it beside the protobuf under CC0.
 * Each row carries the **full plain-text body**, and is keyed by WTP's own post id:
 *
 *     { "id": "A/CHANGE/176745",
 *       "title": "Zakończenie remontu torowiska w Al. Niepodległości",
 *       "body": "W związku z zakończeniem remontu torowiska…",
 *       "link": "https://www.wtp.waw.pl/zmiany/2026/09/11/…",
 *       "routes": ["14","17","19","33","174"] }
 *
 * So the operator's own words reach us by a route that will answer, and the join is exact rather
 * than fuzzy: `176745` is the number already sitting in our guid. The JSON rather than the `.pb`
 * deliberately — the protobuf would be a dependency and a decoder to carry for a feed whose useful
 * content is three strings.
 *
 * ### One request per run, not one per item
 *
 * The whole feed is a few tens of kilobytes and holds every live alert, so it is fetched **once**
 * and indexed. That is cheaper than the per-item fetches it replaces and gentler on a volunteer's
 * server: a run that enriches six communiqués makes one request, not six.
 *
 * ### What it cannot do, stated plainly
 *
 * **It carries live alerts only** — nine of them on a quiet Sunday. An item whose disruption has
 * ended is not in it, so a communiqué that was already over when this shipped stays unreadable for
 * ever; there is no backfill here and there cannot be one. What this covers is the case the app is
 * actually for: the metro is broken *now*. Once a body is stored, `mergeItem` carries it forward
 * and the reading outlives the alert.
 *
 * **It is one person's server.** That is why it is a door and not the mechanism: `fetchArticle`
 * still tries WTP directly behind it, and everything failing leaves the item unread and escalated —
 * the state `hasProse` guarantees whatever happens out here. If this host goes away the app is as
 * blind as it was before this file existed, and no worse.
 */

import { WTP_ALERTS_URL } from '../../../korczak-xyz/src/utils/transit/sources';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';

/** One request, once a run. Short, because a slow mirror must not hold up a ten-minute schedule. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The same cap the feed body and the article page get. Enough for the longest communiqué seen. */
const BODY_LIMIT = 4000;
/** A sane ceiling on the whole document: ~40 KB live, so this is an order of magnitude of headroom. */
const MAX_BYTES = 2_000_000;

/** What one alert contributes: the prose, and nothing this app does not already have. */
export interface AlertProse {
  /** WTP's post id, as a string of digits — the join onto `TransitItem.guid`. */
  postId: string;
  body: string;
}

export interface AlertIndex {
  /** Keyed by post id. Empty is a real answer: a quiet hour has no live alerts. */
  byPostId: Map<string, AlertProse>;
  /** How many rows the feed held, so "nothing matched" and "nothing arrived" stay distinguishable. */
  count: number;
  error?: string;
}

export const EMPTY_INDEX: AlertIndex = { byPostId: new Map(), count: 0 };

/**
 * The post id this item would be found under, or undefined.
 *
 * The guid states it outright — `?post_type=impediment&p=176873` — which is the same fact
 * `wpRestUrlFor` reads for the REST route. Taken from the guid rather than the pretty permalink for
 * that reason: the permalink is a slug and says nothing about which post it is.
 */
export function postIdOf(item: Pick<TransitItem, 'guid'>): string | undefined {
  return /[?&]p=(\d+)/.exec(item.guid)?.[1];
}

/**
 * The trailing number of an alert id — `A/CHANGE/176745` → `176745`.
 *
 * Matched loosely on purpose. The prefix is the generator's own vocabulary rather than WTP's, and
 * a build of it that renamed `CHANGE` or added a third kind would otherwise silently index nothing;
 * the number is the part that is a fact about the operator.
 */
export function postIdOfAlert(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  return /(\d+)\s*$/.exec(id)?.[1];
}

/**
 * The feed's rows, indexed.
 *
 * Total by construction, exactly as `parseReadings` is: a body that is not JSON, a missing `alerts`
 * array, a row that is not an object, an id of the wrong shape, an absent or empty body — every one
 * of them yields no entry for that row rather than an exception. A mirror that changes shape must
 * degrade this app to what it was without it, never break a collector run.
 */
export function parseAlerts(body: string): AlertIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { byPostId: new Map(), count: 0, error: `${body.length} bytes that are not JSON` };
  }

  const rows = (parsed as { alerts?: unknown })?.alerts;
  if (!Array.isArray(rows)) {
    return { byPostId: new Map(), count: 0, error: 'no alerts array' };
  }

  const byPostId = new Map<string, AlertProse>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const postId = postIdOfAlert(record.id);
    if (!postId) continue;
    const text = typeof record.body === 'string' ? record.body.trim() : '';
    if (!text) continue;
    byPostId.set(postId, { postId, body: text.slice(0, BODY_LIMIT) });
  }

  return { byPostId, count: rows.length };
}

/**
 * Fetch and index, or say why not.
 *
 * A failure here is never a failed run and never an empty index pretending to be an answer: the
 * `error` travels so the caller can put it in what it stores, and the two direct doors are tried
 * regardless. `EMPTY_INDEX` with no error means the feed answered and held nothing matching, which
 * on a quiet evening is the truth.
 */
export async function fetchAlerts(fetchImpl: typeof globalThis.fetch): Promise<AlertIndex> {
  try {
    const response = await fetchImpl(WTP_ALERTS_URL, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        'user-agent': 'korczak.xyz transit watch (+https://korczak.xyz)',
      },
    });
    if (!response.ok) return { byPostId: new Map(), count: 0, error: `HTTP ${response.status}` };
    const body = await response.text();
    if (body.length > MAX_BYTES) {
      return { byPostId: new Map(), count: 0, error: `${body.length} bytes — refusing to parse` };
    }
    return parseAlerts(body);
  } catch (e) {
    return { byPostId: new Map(), count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
