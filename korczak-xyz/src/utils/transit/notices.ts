/*
 * What may ring the phone.
 *
 * Pure, so the whole "should this fire?" question is reachable from a unit test rather than from a
 * platform at 07:15. The events app's `notices.ts` makes the same argument at more length; what is
 * different here is what the guards are guarding against.
 *
 * Event Watch's flood risk is a scrape whose markup shifted, re-announcing an opera season. This
 * app's is a single bad morning: a signalling failure on M1 produces a first communiqué, then three
 * edits to it as the closure grows and finally a fourth saying it is over — and every one of those
 * edits changes `contentHash`, which is exactly what lets an update reach you and exactly what
 * could make five notifications out of one incident. So the guards are:
 *
 * - **`armedAt`** — nothing already in the corpus when alerts were switched on may fire. Without
 *   it, arming replays a fortnight of metro history into the lock screen.
 * - **The claim latch** — `alertIdFor` includes the content hash, so an unchanged communiqué can
 *   never fire twice and an edited one fires once more. The document is written by `create()`
 *   before sending, never after: see `notify.ts`.
 * - **`maxPerRun`** — the overflow becomes one summary, and the suppressed alerts are still
 *   claimed, so they cannot arrive individually on the next run instead.
 *
 * Route-level alerts are ordered ahead of line-level ones before the cap is applied, which is the
 * whole of what "more important" means mechanically. They are not exempt from it: six communiqués
 * about one's own commute in one run is already a summary's worth of news, and the seventh is not
 * more urgent for being seventh.
 */

import { alertIdFor } from './normalize';
import { audibleAtRoute, impactOf } from './impact';
import type {
  AlertKind,
  ImpactVerdict,
  TransitAlert,
  TransitItem,
  TransitSettings,
  WatchedSegment,
} from './types';

/**
 * How far back a communiqué may be and still be worth a notification.
 *
 * A guard against a second failure mode the latch cannot catch: WTP re-publishing its back
 * catalogue, or a feed that starts emitting a month of items after an outage. Fourteen days is well
 * past any impediment and comfortably inside the notice a planned change gets, so nothing real is
 * lost — and the item is in the feed regardless, which is the recoverable half.
 */
const MAX_AGE_MS = 14 * 86400000;

export interface PendingAlert {
  alertId: string;
  kind: AlertKind;
  item: TransitItem;
  verdict: ImpactVerdict;
}

export interface AlertPlan {
  send: PendingAlert[];
  /** Over the cap. Claimed but never sent individually, so they cannot arrive later one by one. */
  suppressed: PendingAlert[];
  summary?: { count: number; url: string };
}

export interface PlanContext {
  now: number;
  settings: TransitSettings;
  /** Alert ids already claimed. The only thing between a re-run and a repeat notification. */
  seen: ReadonlySet<string>;
  /** Where a summary notification should open. */
  appUrl: string;
}

/**
 * The kind an item would fire at for these segments, or null for one that fires at none.
 *
 * Split out from `planAlerts` because the app draws it too: a card says whether this is a
 * route-level or a line-level matter, and that answer has to be the same one the notifier reached.
 */
export function alertKindFor(
  item: TransitItem,
  segments: WatchedSegment[],
  settings: TransitSettings,
): { kind: AlertKind; verdict: ImpactVerdict } | null {
  const verdict = impactOf(item, segments);
  if (!verdict) return null;

  // A route verdict every one of whose segments is muted is still a true verdict — it simply does
  // not get to be the loud kind. It falls back to line level rather than to nothing: muting a leg
  // of the commute is not the same as not watching the line.
  const kind: AlertKind = audibleAtRoute(verdict, segments) ? 'route' : 'line';
  if (kind === 'line' && !settings.lineAlerts) return null;
  if (item.feed === 'change' && !settings.changeAlerts) return null;
  return { kind, verdict };
}

export function planAlerts(
  items: TransitItem[],
  segments: WatchedSegment[],
  ctx: PlanContext,
): AlertPlan {
  const { now, settings, seen } = ctx;
  if (settings.armedAt === null) return { send: [], suppressed: [] };

  const candidates: PendingAlert[] = [];

  for (const item of items) {
    /*
     * `firstSeenAt`, not `publishedAt`. Arming has to be measured against when this app learnt of
     * an item, or a communiqué published five minutes before the reader pressed the button is
     * indistinguishable from one published five minutes after — and only one of those is news.
     */
    if (item.firstSeenAt < settings.armedAt) continue;
    if (now - item.publishedAt > MAX_AGE_MS) continue;

    const decided = alertKindFor(item, segments, settings);
    if (!decided) continue;

    const alertId = alertIdFor(item.guid, decided.kind, item.contentHash);
    if (seen.has(alertId)) continue;

    candidates.push({ alertId, kind: decided.kind, item, verdict: decided.verdict });
  }

  // Route before line, then newest first. The second key matters as much as the first when the cap
  // bites: what survives should be what is happening now, not whatever the corpus iterated first.
  candidates.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      b.item.publishedAt - a.item.publishedAt ||
      a.alertId.localeCompare(b.alertId),
  );

  const send = candidates.slice(0, Math.max(0, settings.maxPerRun));
  const suppressed = candidates.slice(send.length);

  return {
    send,
    suppressed,
    ...(suppressed.length > 0
      ? { summary: { count: suppressed.length, url: ctx.appUrl } }
      : {}),
  };
}

function rank(kind: AlertKind): number {
  return kind === 'route' ? 0 : 1;
}

/** The record claimed for one pending alert. Denormalised so the history needs no join. */
export function alertRecordFor(pending: PendingAlert, now: number): TransitAlert {
  const { item, verdict } = pending;
  return {
    id: pending.alertId,
    kind: pending.kind,
    itemId: item.id,
    guid: item.guid,
    feed: item.feed,
    contentHash: item.contentHash,
    segmentIds: verdict.segmentIds,
    lines: verdict.lines,
    stops: verdict.stops,
    certain: verdict.certain,
    claimedAt: now,
    sentAt: null,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    ...(item.summary ? { summary: item.summary } : {}),
  };
}
