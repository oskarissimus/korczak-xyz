/*
 * Arranging matched events for reading.
 *
 * Pure, and in the portable set — the collector does not use it today, but nothing here needs a
 * browser and keeping it beside the matcher is what stops "what the feed shows" and "what the
 * collector notifies about" drifting into two different ideas of the same list.
 */

import type { EventRecord, Interest } from './types';
import { matchingInterests, scoreMatch } from './match';
import { daysUntil } from './normalize';

export interface FeedItem {
  event: EventRecord;
  /** Why it is here. Empty when the reader asked to see everything. */
  matched: Interest[];
}

export type FeedGroup = 'week' | 'month' | 'later' | 'undated';

export interface FeedSection {
  group: FeedGroup;
  items: FeedItem[];
}

/**
 * One row per real-world event, keeping the copy that tells you most.
 *
 * Ticketmaster and a scrape of the same opera house will both list the same night; they share a
 * fingerprint, and showing both would be the app looking broken. The survivor is whichever has a
 * ticket link — that being the difference that matters when the point is buying one — and then
 * whichever was seen first, so the choice is stable between renders.
 */
export function dedupeByFingerprint(events: EventRecord[]): EventRecord[] {
  const best = new Map<string, EventRecord>();
  for (const event of events) {
    const held = best.get(event.fingerprint);
    if (!held) {
      best.set(event.fingerprint, event);
      continue;
    }
    const heldHasTickets = Boolean(held.ticketUrl);
    const mineHasTickets = Boolean(event.ticketUrl);
    if (mineHasTickets !== heldHasTickets) {
      if (mineHasTickets) best.set(event.fingerprint, event);
      continue;
    }
    if (event.firstSeenAt < held.firstSeenAt) best.set(event.fingerprint, event);
  }
  return [...best.values()];
}

/**
 * The feed: matched events, deduped, grouped by how soon they are.
 *
 * `forPush: false` — a muted interest still puts things here. Muting says "do not wake me", not
 * "hide it from me", and conflating the two is how a muted interest becomes indistinguishable from
 * a deleted one.
 */
export function buildFeed(
  events: EventRecord[],
  interests: Interest[],
  now: number,
  opts: { matchedOnly: boolean } = { matchedOnly: true },
): FeedSection[] {
  const items: FeedItem[] = [];
  for (const event of dedupeByFingerprint(events)) {
    // Something that finished yesterday is not "coming up", whatever matched it.
    if (event.startsAt !== null && daysUntil(event.startsAt, now) < 0) continue;
    const matched = matchingInterests(event, interests, { forPush: false });
    if (opts.matchedOnly && matched.length === 0) continue;
    items.push({ event, matched });
  }

  items.sort(compareItems);

  const sections: Record<FeedGroup, FeedItem[]> = { week: [], month: [], later: [], undated: [] };
  for (const item of items) sections[groupOf(item.event, now)].push(item);

  return (['week', 'month', 'later', 'undated'] as FeedGroup[])
    .map((group) => ({ group, items: sections[group] }))
    .filter((section) => section.items.length > 0);
}

/**
 * Which bucket an event belongs in.
 *
 * `undated` last rather than first: a season with no nights scheduled is the least actionable
 * thing in the list, however recently it was announced.
 */
export function groupOf(event: EventRecord, now: number): FeedGroup {
  if (event.startsAt === null) return 'undated';
  const days = daysUntil(event.startsAt, now);
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'later';
}

/**
 * Chronological, because the question the feed answers is "what is coming up".
 *
 * The match score is only a tiebreak within one day — it exists so that on a night when a broad
 * interest and a specific keyword both matched, the specific one is read first. Undated events
 * fall to the end and order by when they were announced.
 */
function compareItems(a: FeedItem, b: FeedItem): number {
  const at = a.event.startsAt;
  const bt = b.event.startsAt;
  if (at === null && bt === null) return b.event.firstSeenAt - a.event.firstSeenAt;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return at - bt;
  return bestScore(b) - bestScore(a) || a.event.id.localeCompare(b.event.id);
}

function bestScore(item: FeedItem): number {
  let best = 0;
  for (const interest of item.matched) {
    best = Math.max(best, scoreMatch(item.event, interest));
  }
  return best;
}
