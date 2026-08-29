/*
 * Arranging matched events for reading.
 *
 * Pure, and in the portable set — the collector does not use it today, but nothing here needs a
 * browser and keeping it beside the matcher is what stops "what the feed shows" and "what the
 * collector notifies about" drifting into two different ideas of the same list.
 */

import type { EventRecord, Interest } from './types';
import { interestsRejectingFor, matchingInterests, scoreMatch } from './match';
import { foldText } from './normalize';
import { daysUntil } from './normalize';

export interface FeedItem {
  event: EventRecord;
  /** Why it is here. Empty when the reader asked to see everything. */
  matched: Interest[];
  /**
   * Which interests turned it away on the `places` rule alone. Only ever populated in
   * `rejected-place` mode, where it is the whole point of the row.
   */
  rejectedBy?: Interest[];
}

/**
 * What the feed is being asked for.
 *
 * `rejected-place` is the verification view: events that satisfied everything an interest asked
 * about their *content* and were turned away only for where they are or who they are for. It
 * exists because a geography filter is otherwise unfalsifiable from the outside — a thing that
 * stopped appearing and a thing that was never announced look identical, and the whole question
 * being asked of this feature is which of the two just happened.
 *
 * Built from the same `matchReason` call the real filter makes, so this view cannot show a
 * different set from the one being filtered on. See `matchReason`'s header.
 */
export type FeedMode = 'matched' | 'rejected-place' | 'all';

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
  opts: { mode: FeedMode } = { mode: 'matched' },
): FeedSection[] {
  const items: FeedItem[] = [];
  for (const event of dedupeByFingerprint(events)) {
    // Something that finished yesterday is not "coming up", whatever matched it.
    if (event.startsAt !== null && daysUntil(event.startsAt, now) < 0) continue;
    const matched = matchingInterests(event, interests, { forPush: false });

    if (opts.mode === 'rejected-place') {
      /*
       * An event another interest already lets through is not something the filter is keeping from
       * you, so it does not belong in a list of what the filter removed — however near a miss it
       * was for this one.
       */
      if (matched.length > 0) continue;
      const rejectedBy = interestsRejectingFor(event, interests, 'places', { forPush: false });
      if (rejectedBy.length === 0) continue;
      items.push({ event, matched, rejectedBy });
      continue;
    }

    if (opts.mode === 'matched' && matched.length === 0) continue;
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

/**
 * How many of each country are in a list, commonest first.
 *
 * Drawn over the rejected view, where it answers the question the cards cannot: not "what was
 * removed" one at a time, but *what shape* the removal has. Four national PyCons in four countries
 * reads very differently from forty rows all filed under one — the second is a classifier getting
 * a country wrong at scale, and it is the failure this line exists to make visible at a glance.
 *
 * `?` for a record with no country, so the tally is total and the unplaced are countable rather
 * than merely absent.
 */
export function countryTally(events: EventRecord[]): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const code = event.country ?? '?';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  // Count first, then code, so the line does not reshuffle between renders on a tie.
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * How much of the corpus has been through the classifier.
 *
 * The other half of verifying this, and the half the rejected list structurally cannot show: an
 * unclassified event **passes** the places rule, so it is never in that list. Without this number
 * a classifier that has quietly stopped looks exactly like a filter with nothing to remove.
 */
export function classificationCoverage(events: EventRecord[]): {
  classified: number;
  total: number;
} {
  let classified = 0;
  for (const event of events) if (event.reach !== undefined) classified += 1;
  return { classified, total: events.length };
}

/**
 * Where an event is, without saying it twice.
 *
 * Venue and city are separate fields because some sources give both — but an iCal `LOCATION` is one
 * free-text line ("Brisbane, Australia") that the adapter also extracts a city from, so printing the
 * pair joined reads "Brisbane, Australia, Brisbane". The city is dropped whenever the venue already
 * contains it, compared folded so "Kraków" matches "Krakow".
 */
export function placeLabel(event: { venue?: string; city?: string }): string {
  const venue = event.venue?.trim();
  const city = event.city?.trim();
  if (!venue) return city ?? '';
  if (!city || foldText(venue).includes(foldText(city))) return venue;
  return `${venue}, ${city}`;
}

/**
 * The date, or the source's own words when it gave prose nobody could parse.
 *
 * Never blank: a card with no date at all reads as a bug, and "Premiera: jesień 2027" is genuinely
 * what the theatre said.
 *
 * An all-day event gets no clock. iCal's `VALUE=DATE` carries no time, so it lands on midnight UTC
 * and printing that in Warsaw produced "Thu 27 Aug, 02:00" for a conference that starts whenever
 * the doors open — a precision the source never claimed, and one that would read differently either
 * side of a daylight-saving change.
 */
export function whenLabel(
  event: { startsAt: number | null; dateText?: string; allDay?: boolean },
  locale: string,
  timeZone = 'Europe/Warsaw',
): string {
  if (event.startsAt === null) return event.dateText ?? '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    ...(event.allDay ? {} : { hour: '2-digit' as const, minute: '2-digit' as const }),
    timeZone,
  }).format(new Date(event.startsAt));
}
