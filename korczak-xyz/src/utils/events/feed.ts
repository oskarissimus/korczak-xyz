/*
 * Arranging collected events for reading.
 *
 * Pure, and in the portable set — the collector does not use it today, but nothing here needs a
 * browser and keeping it beside `notices.ts` is what stops "what the feed shows" and "what the
 * collector notifies about" drifting into two different ideas of the same list. They now agree by
 * being the same short rule: an upcoming or undated row, from a source this account has left on.
 */

import type { EventRecord } from './types';
import { ALL_SOURCES_ON, sourceEnabled, type SourcePrefs } from './sourcePrefs';
import { foldText } from './normalize';
import { daysUntil } from './normalize';

export type FeedGroup = 'week' | 'month' | 'later' | 'undated';

export interface FeedSection {
  group: FeedGroup;
  events: EventRecord[];
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

export interface FeedOptions {
  /**
   * Which sources this account is still listening to. Defaulted to all of them: the cost of a
   * caller here forgetting it is rows on a screen, where the same omission in the collector is a
   * phone ringing about a feed somebody switched off.
   */
  sources?: SourcePrefs;
}

/**
 * The feed: what the enabled sources collected, deduped, grouped by how soon it is.
 *
 * **The whole of what this returns is what the sources produced**, which since the interests went
 * (Sep 2026) is nearly the whole corpus: past rows are dropped, a switched-off source is dropped,
 * and nothing else is. That is the tab's contract — the feed is the output of the pipeline, not a
 * place to inspect it, and narrowing it belongs where the narrowing is a fact about the world: in
 * an adapter, in the pages a source reads, or on the switch that turns one off.
 *
 * What was given up with the interests is real: the feed carries every race in Poland where it used
 * to carry the ones in Warszawa, and every ticketed night where it used to carry the opera. The
 * `n collected` chip on each source card is what that costs, per source, and the switch beside it
 * is the answer.
 */
export function buildFeed(
  events: EventRecord[],
  now: number,
  opts: FeedOptions = {},
): FeedSection[] {
  const sources = opts.sources ?? ALL_SOURCES_ON;

  const kept: EventRecord[] = [];
  for (const event of dedupeByFingerprint(events)) {
    // Something that finished yesterday is not "coming up". A sale announcement expires the same
    // way, on the day the sale it announced opens.
    const at = actionableAt(event);
    if (at !== null && daysUntil(at, now) < 0) continue;

    // A source this account has switched off on the Sources tab.
    if (!sourceEnabled(sources, event.source)) continue;

    kept.push(event);
  }

  kept.sort(compareEvents);

  const sections: Record<FeedGroup, EventRecord[]> = { week: [], month: [], later: [], undated: [] };
  for (const event of kept) sections[groupOf(event, now)].push(event);

  return (['week', 'month', 'later', 'undated'] as FeedGroup[])
    .map((group) => ({ group, events: sections[group] }))
    .filter((section) => section.events.length > 0);
}

/**
 * The next moment this event asks anything of the reader.
 *
 * Almost always `startsAt`, and for every source but one it is exactly that. The exception is an
 * announcement that a **sale opens** on a stated date: an article carries no date of its own (the
 * rule the RSS adapter is built on, and for the same reason), so its `startsAt` is null while the
 * moment you have to be at a keyboard is perfectly well known.
 *
 * Filing that under "no dates yet" would put the one row in the feed you can be *late* for below
 * every concert in the corpus. So the grouping, the ordering and the has-it-passed test all ask
 * this rather than reading `startsAt` directly — and because `onSaleAt` is only ever set where a
 * source stated it ahead of time, nothing else in the feed moves.
 */
export function actionableAt(
  event: Pick<EventRecord, 'startsAt' | 'onSaleAt'>,
): number | null {
  if (event.startsAt !== null) return event.startsAt;
  return event.onSaleAt ?? null;
}

/**
 * Which bucket an event belongs in.
 *
 * `undated` last rather than first: a season with no nights scheduled is the least actionable
 * thing in the list, however recently it was announced.
 */
export function groupOf(event: EventRecord, now: number): FeedGroup {
  const at = actionableAt(event);
  if (at === null) return 'undated';
  const days = daysUntil(at, now);
  if (days <= 7) return 'week';
  if (days <= 31) return 'month';
  return 'later';
}

/**
 * Chronological, because the question the feed answers is "what is coming up".
 *
 * There is no relevance tiebreak within a day any more — `scoreMatch` ranked a narrow interest's
 * hit above a broad one's on the same night, and with no interests there is nothing to be narrow
 * about. The id is the tiebreak instead, which is arbitrary and, more to the point, stable: two
 * renders of one day must not reshuffle.
 *
 * Undated events fall to the end and order by when they were announced — by `announcedAt`, which
 * is the source's publication date where there is one and not the day the collector happened to
 * meet the row.
 */
function compareEvents(a: EventRecord, b: EventRecord): number {
  const at = actionableAt(a);
  const bt = actionableAt(b);
  if (at === null && bt === null) return announcedAt(b) - announcedAt(a);
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

/**
 * When this was announced, as the world would say it rather than as the collector would.
 *
 * `firstSeenAt` is when *this app* met the row, which for anything scraped off a page holding ten
 * items is when the collector started rather than when the news broke. A feed read for the first
 * time hands over its whole back catalogue in one run, and every one of those rows carries the
 * same `firstSeenAt` to the millisecond — so the undated group ordered by it is not ordered by
 * anything at all, and a two-month-old article sits above this morning's.
 *
 * The publication date is what a source states about its own item, so where there is one it is
 * the answer. `firstSeenAt` remains the fallback, and remains what `announced` notices fire on:
 * a late-discovered article is still new to a reader who has never seen it.
 */
export function announcedAt(event: Pick<EventRecord, 'publishedAt' | 'firstSeenAt'>): number {
  return event.publishedAt ?? event.firstSeenAt;
}

/**
 * The corpus split by the adapter that produced each row — the first half of every event id, and
 * what `eventSources` health and the source catalogue are both keyed on.
 *
 * One pass rather than a filter per source: the Sources tab draws five cards over two thousand
 * rows and asks each card two different questions about its own slice.
 */
export function bySource(events: EventRecord[]): Map<string, EventRecord[]> {
  const grouped = new Map<string, EventRecord[]>();
  for (const event of events) {
    const held = grouped.get(event.source);
    if (held) held.push(event);
    else grouped.set(event.source, [event]);
  }
  return grouped;
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
/**
 * The sale moment in words, or null when the source never stated one.
 *
 * Separate from `whenLabel` rather than folded into it, because a card can have both: a
 * Ticketmaster night has a curtain *and* a sale date, and the two are different instructions. It
 * is also the one thing on a sale-announcement card that is not in Polish — `dateText` holds the
 * theatre's own sentence, which is right for checking the parse and no use to an English reader
 * trying to work out which morning to be awake.
 */
export function saleWhenLabel(
  event: { onSaleAt?: number },
  locale: string,
  timeZone = 'Europe/Warsaw',
): string | null {
  if (event.onSaleAt === undefined) return null;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    // The hour is the point: a season sale opening at 11.00 is not one opening at midnight.
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(event.onSaleAt));
}

export function whenLabel(
  event: {
    startsAt: number | null;
    dateText?: string;
    allDay?: boolean;
  },
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
