/*
 * Arranging matched events for reading.
 *
 * Pure, and in the portable set — the collector does not use it today, but nothing here needs a
 * browser and keeping it beside the matcher is what stops "what the feed shows" and "what the
 * collector notifies about" drifting into two different ideas of the same list.
 */

import type { EventRecord, Interest } from './types';
import { NO_IGNORES } from './ignores';
import { interestsRejectingFor, matchingInterests, scoreMatch } from './match';
import { cityKey, isEndonym } from './cities';
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
  /**
   * Dismissed by hand. Set in every mode that can show such a row — so `all` can mark one rather
   * than draw it as though nothing had happened to it, which would make "Everything" and "Matched"
   * differ for a reason nothing on the screen states.
   */
  ignored?: boolean;
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
 *
 * `ignored` is the same argument reaching the hand-dismissed rows: hiding something with no list
 * that says what is hidden is a filter you cannot check and cannot undo, and the only way back to
 * an ignored event would be remembering it existed. It is also the *only* way back — the Ignore
 * button is on the card, so the card has to be reachable.
 */
export type FeedMode = 'matched' | 'rejected-place' | 'all' | 'ignored';

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

export interface FeedOptions {
  /** Which view. Defaults to `matched`, which is what the tab opens on. */
  mode?: FeedMode;
  /**
   * Fingerprints the reader has dismissed by hand — `ignoredFingerprints(...)`.
   *
   * Defaulted to empty rather than required, unlike `PlanContext.ignored`, and the asymmetry is
   * deliberate: a caller here that forgot it would show a row that should be hidden, which is
   * visible on the screen and one tap from being fixed, where the same omission in the collector
   * is a notification at 7am about the concert you already said no to.
   */
  ignored?: ReadonlySet<string>;
}

/**
 * The feed: matched events, deduped, grouped by how soon they are.
 *
 * `forPush: false` — a muted interest still puts things here. Muting says "do not wake me", not
 * "hide it from me", and conflating the two is how a muted interest becomes indistinguishable from
 * a deleted one.
 *
 * Ignoring is the opposite instruction and is applied here rather than in the matcher, because it
 * is not a fact about whether the event matches: it matched, and was dismissed anyway. Folding it
 * into `matchReason` would make an ignored row indistinguishable from one no interest ever wanted,
 * and there would be nothing left to draw the `ignored` view from.
 */
export function buildFeed(
  events: EventRecord[],
  interests: Interest[],
  now: number,
  opts: FeedOptions = {},
): FeedSection[] {
  const mode = opts.mode ?? 'matched';
  const ignoredSet = opts.ignored ?? NO_IGNORES;

  const items: FeedItem[] = [];
  for (const event of dedupeByFingerprint(events)) {
    // Something that finished yesterday is not "coming up", whatever matched it. A sale
    // announcement expires the same way, on the day the sale it announced opens.
    const at = actionableAt(event);
    if (at !== null && daysUntil(at, now) < 0) continue;
    /*
     * Dedupe first, then ask. The fingerprint is what an ignore is keyed on, so the survivor of two
     * copies of one night carries the dismissal however the dedupe went — which is the whole reason
     * the key is not an event id.
     */
    const ignored = ignoredSet.has(event.fingerprint);

    // The one view that is *only* the dismissed rows, and the only route back to them.
    if (mode === 'ignored') {
      if (!ignored) continue;
      items.push({
        event,
        matched: matchingInterests(event, interests, { forPush: false }),
        ignored: true,
      });
      continue;
    }

    // Everywhere else a dismissal hides the row — except in `all`, which claims to be everything.
    if (ignored && mode !== 'all') continue;

    const matched = matchingInterests(event, interests, { forPush: false });

    if (mode === 'rejected-place') {
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

    if (mode === 'matched' && matched.length === 0) continue;
    items.push({ event, matched, ...(ignored ? { ignored: true } : {}) });
  }

  items.sort(compareItems);

  const sections: Record<FeedGroup, FeedItem[]> = { week: [], month: [], later: [], undated: [] };
  for (const item of items) sections[groupOf(item.event, now)].push(item);

  return (['week', 'month', 'later', 'undated'] as FeedGroup[])
    .map((group) => ({ group, items: sections[group] }))
    .filter((section) => section.items.length > 0);
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
export function actionableAt(event: Pick<EventRecord, 'startsAt' | 'onSaleAt'>): number | null {
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
 * The match score is only a tiebreak within one day — it exists so that on a night when a broad
 * interest and a specific keyword both matched, the specific one is read first. Undated events
 * fall to the end and order by when they were announced.
 */
function compareItems(a: FeedItem, b: FeedItem): number {
  const at = actionableAt(a.event);
  const bt = actionableAt(b.event);
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
 * The city an event is in, as the one key its spellings agree on — `''` when the source never said.
 *
 * `cityKey` rather than a fold done here: it is the same function the matcher compares
 * `Interest.cities` with, so the picker and that rule cannot disagree about what one city is. It
 * absorbs both halves of the problem — `Kraków`, `KRAKOW` and `Krakow` fold together, and `Warsaw`
 * is mapped onto `Warszawa`, which folding alone will never do.
 */
export function cityKeyOf(event: { city?: string }): string {
  return cityKey(event.city);
}

export interface CityOption {
  /** Folded. What a selection is stored and compared as. */
  key: string;
  /** The spelling to show, chosen from the sources' own words. */
  label: string;
  count: number;
}

/**
 * The cities present in a built feed, with how many rows each holds.
 *
 * Counts rather than a bare list, because a picker is the one control here that can empty the
 * screen: `Warszawa (12)` says what pressing it does, and a city that has fallen to zero says that
 * too rather than looking like a filter that broke. It is computed over the *unfiltered* sections
 * for the view being looked at, so the numbers are what the reader would see, not what the corpus
 * holds.
 *
 * Rows with no city are deliberately not an option. They are the RSS articles, which are pieces of
 * writing rather than nights out, and "somewhere unspecified" is not a place anyone picks — the
 * `Anywhere` count staying larger than the sum of the cities is where they show up.
 *
 * Alphabetical, because the picker is scanned for a name that is already known. The label is the
 * city's own name where the corpus holds it — `Warszawa` over `Warsaw` — then the commonest
 * spelling, then alphabetical, so two equally common spellings do not swap between renders.
 */
export function cityOptions(events: Array<{ city?: string }>): CityOption[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const event of events) {
    const key = cityKeyOf(event);
    if (!key) continue;
    const entry = byKey.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    const spelling = (event.city ?? '').trim();
    entry.count += 1;
    entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? 0) + 1);
    byKey.set(key, entry);
  }

  return [...byKey]
    .map(([key, { count, spellings }]) => ({
      key,
      count,
      label: [...spellings].sort(
        (a, b) =>
          Number(isEndonym(b[0])) - Number(isEndonym(a[0])) ||
          b[1] - a[1] ||
          a[0].localeCompare(b[0]),
      )[0][0],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One city's rows out of a built feed.
 *
 * A lens over the finished list rather than an argument to `buildFeed`, and that is the whole
 * design of this filter: it is a **view preference on one device**, not a fact about what matches.
 * An interest's `cities` is the durable form of "only Warsaw" and it is what the collector reads,
 * so narrowing the picker never quietly stops a notification — which is the failure a persisted
 * filter would otherwise cause months later, on a phone whose owner has forgotten it is set.
 *
 * Grouping survives untouched: filtering after `buildFeed` cannot reorder anything, and a section
 * left with nothing in it is dropped rather than drawn as an empty heading.
 */
export function filterSectionsByCity(sections: FeedSection[], cityKey: string): FeedSection[] {
  if (!cityKey) return sections;
  return sections
    .map((section) => ({
      group: section.group,
      items: section.items.filter((item) => cityKeyOf(item.event) === cityKey),
    }))
    .filter((section) => section.items.length > 0);
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
