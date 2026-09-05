/*
 * Arranging matched events for reading.
 *
 * Pure, and in the portable set — the collector does not use it today, but nothing here needs a
 * browser and keeping it beside the matcher is what stops "what the feed shows" and "what the
 * collector notifies about" drifting into two different ideas of the same list.
 */

import type { EventKind, EventRecord, Interest } from './types';
import { KINDS } from './types';
import { NEWSROOM_KINDS, type NewsroomKind } from './newsroom';
import { NO_IGNORES } from './ignores';
import type { MatchReason } from './match';
import { interestsRejectingFor, matchingInterests, scoreMatch } from './match';
import { cityKey, isEndonym } from './cities';
import { foldText } from './normalize';
import { daysUntil } from './normalize';

export interface FeedItem {
  event: EventRecord;
  /** Why it is here. Empty when the reader asked to see everything. */
  matched: Interest[];
  /**
   * Which interests turned it away on the `kind` or `places` rule alone. Only ever populated in
   * `rejected` mode, where it is the whole point of the row.
   */
  rejectedBy?: Interest[];
  /**
   * Which of the two rules did it, so the card can print the right sentence — the classifier writes
   * one line about the reach and another about the kind, and showing the geography reasoning under
   * a row removed for being a press release is worse than showing nothing.
   */
  rejectedFor?: MatchReason;
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
 * `rejected` is the verification view: events that satisfied everything an interest asked about
 * their *content* and were turned away only by one of the two rules a language model decides —
 * what sort of thing it is, or where it is and who it is for. It exists because either filter is
 * otherwise unfalsifiable from the outside: a thing that stopped appearing and a thing that was
 * never announced look identical, and the whole question being asked of both features is which of
 * the two just happened.
 *
 * Built from the same `matchReason` call the real filter makes, so this view cannot show a
 * different set from the one being filtered on. See `matchReason`'s header.
 *
 * `ignored` is the same argument reaching the hand-dismissed rows: hiding something with no list
 * that says what is hidden is a filter you cannot check and cannot undo, and the only way back to
 * an ignored event would be remembering it existed. It is also the *only* way back — the Ignore
 * button is on the card, so the card has to be reachable.
 */
export type FeedMode = 'matched' | 'rejected' | 'all' | 'ignored';

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

    if (mode === 'rejected') {
      /*
       * An event another interest already lets through is not something the filter is keeping from
       * you, so it does not belong in a list of what the filter removed — however near a miss it
       * was for this one.
       */
      if (matched.length > 0) continue;
      /*
       * Asked one rule at a time rather than for both at once, because the row has to say which
       * one did it. `kind` first: it is the earlier rule, so an interest that rejects on it was
       * never going to reach `places`, and where two different interests disagree the stronger
       * statement — this is not an event — is the one worth printing.
       */
      const byKind = interestsRejectingFor(event, interests, 'kind', { forPush: false });
      const rejectedFor: MatchReason = byKind.length > 0 ? 'kind' : 'places';
      const rejectedBy =
        byKind.length > 0
          ? byKind
          : interestsRejectingFor(event, interests, 'places', { forPush: false });
      if (rejectedBy.length === 0) continue;
      items.push({ event, matched, rejectedBy, rejectedFor });
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
export function actionableAt(
  event: Pick<EventRecord, 'startsAt' | 'onSaleAt' | 'newsroomEventAt'>,
): number | null {
  if (event.startsAt !== null) return event.startsAt;
  /*
   * The sale first, and only then the date of the thing being sold. Both can be on one row — the
   * theatre announces a season and the morning its tickets go — and of the two it is the sale you
   * can be late for.
   *
   * `newsroomEventAt` is a reading rather than a stated fact, and this is the whole of what it
   * moves: an article about a festival held in July stops being *undated* and starts being *over*,
   * so the feed drops it exactly as it drops a concert that has been and gone. Nothing counts down
   * to it — `noticesFor` reads `startsAt` and `onSaleAt`, and neither is written by a model.
   */
  return event.onSaleAt ?? event.newsroomEventAt ?? null;
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
 * fall to the end and order by when they were announced — by `announcedAt`, which is the source's
 * publication date where there is one and not the day the collector happened to meet the row.
 */
function compareItems(a: FeedItem, b: FeedItem): number {
  const at = actionableAt(a.event);
  const bt = actionableAt(b.event);
  if (at === null && bt === null) return announcedAt(b.event) - announcedAt(a.event);
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return at - bt;
  return bestScore(b) - bestScore(a) || a.event.id.localeCompare(b.event.id);
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
 * What the classifier called a row, as the one value a filter can be keyed on.
 *
 * `unlabelled` is a key of its own rather than being folded into `listing`, and that is the whole
 * care in this file. An unclassified row *passes* every rule the classifier feeds — it is in the
 * feed because nothing has judged it, not because something judged it an event — so counting it as
 * a listing would let a reader narrow to listings and be shown rows that may be press releases,
 * with nothing on the screen saying so. It is the same distinction `classificationCoverage` exists
 * to make visible in the rejected view.
 */
export type KindKey = EventKind | 'unlabelled';

/**
 * Every kind, in the order they are drawn in.
 *
 * Fixed rather than by count, unlike `countryTally`: these are buttons rather than a line of
 * prose, and a row whose buttons swap places as the corpus changes is one you press the wrong half
 * of. `listing` first because it is what the app is mostly for, `unlabelled` last because it is the
 * absence of an answer rather than one of them.
 */
export const KIND_KEYS: readonly KindKey[] = [...KINDS, 'unlabelled'];

export function kindKeyOf(event: { kind?: EventKind }): KindKey {
  return event.kind ?? 'unlabelled';
}

export interface KindOption {
  key: KindKey;
  count: number;
}

/**
 * The kinds present in a built feed, with how many rows each holds.
 *
 * Counts for `cityOptions`' reason — this control can empty the screen, and a choice should say
 * what pressing it does. In `KIND_KEYS` order, which is fixed; see there.
 *
 * A kind with nothing behind it is left out. There are four at most and the reader is choosing
 * from what is actually there — the selected-but-empty case is kept on screen by
 * `withSelectedKeys` in the component, which is where it belongs: it is a fact about the
 * selection, not the corpus.
 */
export function kindOptions(events: Array<{ kind?: EventKind }>): KindOption[] {
  const counts = new Map<KindKey, number>();
  for (const event of events) {
    const key = kindKeyOf(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return KIND_KEYS.map((key) => ({ key, count: counts.get(key) ?? 0 })).filter(
    (option) => option.count > 0,
  );
}

/**
 * What the **newsroom reader** made of an article, as the one value a filter can be keyed on — and
 * `''` for every row it never read.
 *
 * The opposite policy from `kindKeyOf`, deliberately. The classifier judges the whole corpus, so a
 * row without its verdict is one nothing has looked at and `unlabelled` is a state worth seeing.
 * The reader's queue is one page of one theatre, so a row without *its* verdict is overwhelmingly
 * just a concert — not an article the reader gave up on, which is what `other` is for. A bucket
 * holding every listing in the corpus is not a kind of article anyone picks, and `cityOptions`
 * already declines to offer the same bucket for the rows no source placed.
 */
export type NewsroomKey = NewsroomKind;

/** Every newsroom verdict, in the order they are drawn in — `KIND_KEYS`' argument. */
export const NEWSROOM_KEYS: readonly NewsroomKey[] = NEWSROOM_KINDS;

export function newsroomKeyOf(event: { newsroomKind?: NewsroomKind }): NewsroomKey | '' {
  return event.newsroomKind ?? '';
}

export interface NewsroomOption {
  key: NewsroomKey;
  count: number;
}

/**
 * The newsroom verdicts present in a built feed, with how many rows each holds.
 *
 * `kindOptions`' contract, over the other field. `other` is offered where the corpus holds it,
 * although the card draws it no chip: the chip would be a claim about the article where the reader
 * made none, and a filter is a question rather than a claim — it is how you go and look at the
 * rows the reader could not read, which is the only way that failure is visible from this tab.
 */
export function newsroomOptions(
  events: Array<{ newsroomKind?: NewsroomKind }>,
): NewsroomOption[] {
  const counts = new Map<NewsroomKey | '', number>();
  for (const event of events) {
    const key = newsroomKeyOf(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return NEWSROOM_KEYS.map((key) => ({ key, count: counts.get(key) ?? 0 })).filter(
    (option) => option.count > 0,
  );
}

/**
 * Every filter in the toolbar, applied in one pass — an unset field is no constraint.
 *
 * A lens over the finished list rather than arguments to `buildFeed`, and that is the whole design
 * of all three of them: they are **view preferences on one device**, not facts about what matches.
 * `Interest.cities`, `Interest.includeCoverage` and `Interest.tags` are the durable forms and they
 * are what the collector reads, so narrowing anything here can never quietly stop a notification —
 * which is the failure a persisted filter would otherwise cause months later, on a phone whose
 * owner has forgotten it is set.
 *
 * **An empty selection is no constraint, not "matches nothing"** — the rule `match.ts` states for
 * a keyword-less interest, and the same reasoning: nothing chosen is a reader who has not chosen,
 * and reading it as unsatisfiable would open the tab on a blank feed.
 *
 * One function rather than three lenses chained, because they are asked four different questions
 * per render: what the feed shows, and what each control's counts would be with every filter *but
 * its own* applied. Chaining those combinations builds a pile of intermediate arrays to answer
 * what is one predicate per row. The identity return when nothing is set is not an optimisation
 * either — it is what keeps the component's `useMemo` chain from rebuilding its option lists for
 * filters nobody has touched.
 *
 * Grouping survives untouched: filtering after `buildFeed` cannot reorder anything, and a section
 * left with nothing in it is dropped rather than drawn as an empty heading.
 */
export interface FeedNarrowing {
  /** Folded, as `cityKeyOf` returns it. Empty or absent for every city. */
  city?: string;
  kinds?: ReadonlySet<KindKey>;
  newsroom?: ReadonlySet<NewsroomKey>;
}

export function narrowSections(sections: FeedSection[], narrowing: FeedNarrowing): FeedSection[] {
  const { city = '', kinds, newsroom } = narrowing;
  const byKind = kinds && kinds.size > 0 ? kinds : null;
  // Read as strings, so the `''` a row the reader never saw returns is simply a key no chosen set
  // holds — rather than a cast, or a second branch saying the same thing.
  const byNewsroom: ReadonlySet<string> | null =
    newsroom && newsroom.size > 0 ? newsroom : null;
  if (!city && !byKind && !byNewsroom) return sections;
  return sections
    .map((section) => ({
      group: section.group,
      items: section.items.filter(
        (item) =>
          (!city || cityKeyOf(item.event) === city) &&
          (!byKind || byKind.has(kindKeyOf(item.event))) &&
          (!byNewsroom || byNewsroom.has(newsroomKeyOf(item.event))),
      ),
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
  // `classifiedAt` rather than any one verdict field: the call answers three questions and can come
  // back with two of them, so counting on `reach` alone would report a working classifier as
  // partly stopped whenever it declined to guess.
  for (const event of events) if (event.classifiedAt !== undefined) classified += 1;
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
  event: {
    startsAt: number | null;
    dateText?: string;
    allDay?: boolean;
    newsroomEventAt?: number;
  },
  locale: string,
  timeZone = 'Europe/Warsaw',
): string {
  if (event.startsAt === null) {
    /*
     * The date the reader found in the article, where the row has no date of its own.
     *
     * Ahead of `dateText`, which on these rows is the theatre's Polish sale sentence, and well
     * ahead of the em dash that was there before — a card reading `—` for something that happened
     * in July is the app declining to say the one thing that would place it. The year is printed
     * with it, because past is a state this label can now be in and `6 Jul` alone would read as
     * next summer.
     *
     * No clock, and no weekday. The hour was never in the sentence (see `DEFAULT_EVENT_HOUR`), and
     * printing one would claim a precision the article did not have.
     */
    if (event.newsroomEventAt !== undefined) {
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone,
      }).format(new Date(event.newsroomEventAt));
    }
    return event.dateText ?? '—';
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    ...(event.allDay ? {} : { hour: '2-digit' as const, minute: '2-digit' as const }),
    timeZone,
  }).format(new Date(event.startsAt));
}
