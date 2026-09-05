/*
 * The shapes the events app is built on.
 *
 * Everything in `src/utils/events/` is pure and **portable**: it runs unchanged in the browser and
 * in a Cloud Function on Node, because the collector and the feed have to agree exactly about what
 * matches an interest. If they ever disagree, the feed shows things you were never told about and
 * pushes arrive for things the feed does not list.
 *
 * That portability is a real constraint and it is load-bearing: no DOM, no `import.meta.env`, no
 * `firebase/*`, no React. These modules import nothing but each other. `functions/tsconfig.json`
 * compiles this directory straight into the deploy bundle rather than keeping a copy, and
 * `portable.test.ts` fails the build the moment an import reaches outside `./`.
 */

import type { NewsroomKind } from './newsroom';

/** Which adapter produced a record. Also the first half of its id. */
export type SourceId =
  | 'ticketmaster'
  | 'teatr-wielki'
  | 'python-org'
  | 'elektroniczne-zapisy'
  | 'feed';

/**
 * How far an event pulls its audience from.
 *
 * `local` is a night at the opera or a town's medieval fair; `national` is a conference the host
 * country attends, which is what PyCon NL and PyCon Cameroon are; `international` is one people
 * fly in for, which is what EuroPython and PyCon US are. Nothing in a listing states this — it is
 * a judgement, which is why it is the one field here a language model produces.
 */
export type Reach = 'local' | 'national' | 'international';

export const REACHES: readonly Reach[] = ['local', 'national', 'international'];

/**
 * Whether this row **is** an event, or is writing about one.
 *
 * The RSS adapter's honest null dates were only half the problem it names in its own header: a feed
 * item is an article, and most of what a running organiser or a festival publishes is not an
 * announcement of anything. Three sponsor posts and a pacer-times piece about the 48th Warsaw
 * Marathon are four cards for a race that is already in the corpus once, under its own listing.
 *
 * `listing` is the thing itself — a night, a race, a conference, something with a door to walk
 * through. `announcement` is an article whose news *is* an event: entries opening, a date fixed, a
 * calendar published. That is the case the RSS adapter was built to keep, and it is why this is not
 * a boolean — "the 2027 tournament calendar is out" carries no date of its own and is still exactly
 * what an announcement feed is for. `coverage` is everything else written about events: results,
 * interviews, race reports, gear, and the sponsor post that is the reason this field exists.
 *
 * A judgement, like `reach`, and made by the same call. Absent means unclassified, and the matcher
 * treats it the way it treats an absent reach — see `passesKind`.
 */
export type EventKind = 'listing' | 'announcement' | 'coverage';

export const KINDS: readonly EventKind[] = ['listing', 'announcement', 'coverage'];

export interface EventRecord {
  /** `${source}_${slugKey(sourceKey)}` — derived, never random, so two runs converge. */
  id: string;
  source: SourceId;
  /** The source's own stable identifier, unnormalized. Kept for debugging a bad id. */
  sourceKey: string;
  /** Human name of the origin, shown on the card: 'Teatr Wielki', 'historia.org.pl'. */
  sourceName: string;
  title: string;
  /** Composer, genre, artist — whatever the source offers as a second line. */
  subtitle?: string;
  /**
   * Folded title + subtitle + venue + tags + the head of any description. What the matcher reads.
   *
   * Precomputed by the collector so the browser never folds diacritics across two thousand
   * documents per render, and — more importantly — so both sides match against a byte-identical
   * string rather than two independently derived ones.
   */
  haystack: string;
  url: string;
  /** May appear later than the event itself, which is what `onsale` watches for. */
  ticketUrl?: string;
  /** Epoch ms, UTC. Null when the source gives only prose (a season with no dates yet). */
  startsAt: number | null;
  endsAt?: number;
  /**
   * Local calendar day in Europe/Warsaw, `YYYY-MM-DD`. Stored as a string as well as `startsAt`
   * as a number because `YYYY-MM-DD` sorts lexically, which is what lets an interest's date
   * window be a string comparison.
   */
  day: string | null;
  allDay?: boolean;
  /** The raw date string, kept when it could not be parsed, so a card is never dateless-and-mute. */
  dateText?: string;
  /**
   * When the **source published** this, where it says so. Not when the collector first saw it.
   *
   * The two are the same thing for a listing that appears the day it is announced, and nothing
   * like each other for an article: a news page holds ten items and a feed holds twenty, so the
   * run that first reaches one is reading a back catalogue. A festival written up in July was
   * first seen in September, and a card saying `Announced 2 d ago` about it is stating the
   * collector's history as though it were the theatre's.
   *
   * Stated by the source and never inferred — `<time datetime>` on the theatre's news list, the
   * `pubDate` of a feed item — so it is a fact rather than a reading, and it is deliberately
   * **not** put in `startsAt`: that would file every article as happening on its publication day
   * and let `soon` fire about it, which is the rule the RSS adapter is built on.
   *
   * It is what the card prints, what the undated rows sort by, and what the reader resolves a
   * yearless date against. It is not read by `isFresh`: `announced` is about when *this app*
   * learnt of something, and an article discovered late is still news to a reader who has never
   * seen it.
   */
  publishedAt?: number;
  city?: string;
  venue?: string;
  /**
   * ISO-3166-1 alpha-2, or `ONLINE`. Supplied by the adapter where the source knows it for free
   * (Teatr Wielki is in Warsaw; Ticketmaster is queried `countryCode=PL`) and by the classifier
   * otherwise. Absent means nobody has worked it out yet — which is a third state, not a fourth
   * country, and `matchesInterest` treats it as such.
   */
  country?: string;
  /**
   * Who this draws. Set by the classifier and by nothing else.
   *
   * The distinction a country cannot make: PyCon NL and EuroPython can be in the same country in
   * the same year and are not the same kind of event, and no field a scrape produces says which is
   * which. Absent means unclassified.
   */
  reach?: Reach;
  /** The classifier's one line of reasoning, so its verdict can be argued with rather than obeyed. */
  reachReason?: string;
  /**
   * Whether this row is an event or an article about one. Set by the classifier and by nothing
   * else. Absent means unclassified — which is not `listing`, and `passesKind` reads it as its own
   * state for the same reason an absent `reach` is one.
   */
  kind?: EventKind;
  /** Why the classifier called it that. Printed on a filtered-out card, like `reachReason`. */
  kindReason?: string;
  /**
   * What the **newsroom reader** made of this article, which is a different question from `kind`
   * directly above and the two are worth keeping straight.
   *
   * `kind` asks whether a row belongs in an event feed at all, over the whole corpus, from
   * `classify.ts`. This asks what one of the theatre's own news items actually says, over the
   * dozen rows a source tagged `newsroom`, from `readNewsroom.ts` — a separate pass on a separate
   * version, for the reasons in that file's header. A ticket-sale item is `announcement` on the
   * first axis and `ticket-sale` on this one; both are true and neither implies the other.
   *
   * `newsroomTag` turns this into the tag an interest can match, and `tagsWithNewsroomKind` is the
   * one place that union is made.
   */
  newsroomKind?: NewsroomKind;
  /**
   * What the article says, in one line, as the model read it.
   *
   * The counterpart of `reachReason` and `kindReason`: the verdict beside it is a single word, and
   * without the sentence there is no way to tell a correct reading from a confident wrong one. On
   * rows whose title and teaser are the theatre's Polish, it is also the only thing on the card in
   * the reader's own language.
   */
  newsroomSummary?: string;
  /**
   * When the event this article is **about** takes place, as the reader understood it.
   *
   * The gap this fills is the one an article has by construction: `startsAt` is null on every
   * newsroom row, because the row is a piece of writing rather than a night out — and until now
   * that meant a piece about a festival held in July and one announcing next season's premiere
   * were the same shape of card, filed together under *announced, no dates yet*, both of them
   * looking equally like news. The date is usually stated plainly in the prose, in Polish, in
   * whatever phrasing the press office chose, which is exactly the sort of fact `readNewsroom.ts`
   * exists to read.
   *
   * Kept in its own field rather than written into `startsAt`, for two reasons that pull the same
   * way. It is a **reading**, not a fact the source stated in a field, and this app keeps those
   * apart everywhere else (`reach` beside `country`, `newsroomKind` beside `tags`); and `startsAt`
   * is what `noticesFor` counts down to, so a model that misreads a year would put a `soon`
   * notification on a stranger's calendar. Here the blast radius is a card: the feed groups,
   * orders and expires by it through `actionableAt`, so an article about something already over
   * drops out of the list the way a past concert does, and nothing wakes anybody up.
   *
   * Unlike `onSaleAt` a **past** value is kept and is the whole point — it is what says this is old
   * news. See `parseEventMoment` for the window that separates old news from a misread year.
   */
  newsroomEventAt?: number;
  newsroomReadAt?: number;
  /** What the reading was computed from — see `newsroomHashOf`. Unchanged, no second call. */
  newsroomHash?: string;
  classifiedAt?: number;
  /**
   * What the classification was computed from — see `classifyHashOf` in `functions/src/classify.ts`.
   * Unchanged hash, no second call; that is what keeps a run over 1,100 events costing nothing.
   */
  classifyHash?: string;
  /** Normalised topics, folded lowercase: 'music', 'opera', 'theatre', 'tech', 'festival'. */
  tags: string[];
  /**
   * The race distances on offer, in **metres**, ascending. Only ever set on `running` events.
   *
   * Derived from the title by `distancesOf`, so it is recomputed every run and never merged
   * forward — unlike the classifier's fields, nothing here is a verdict that cost something to
   * reach. Metres rather than kilometres because they are integers: 21,097 m is exact where
   * 21.0975 km is a float compared against a stored one on every collector run.
   *
   * Absent means the title did not say, which is the common case — roughly four races in five
   * are titled with a name and no number. It is not "no distance", and a card that stays quiet
   * about it is the point: see the precision note at the top of `distance.ts`.
   */
  distancesM?: number[];
  /**
   * When tickets go on sale, where the source states it **in advance**.
   *
   * The one date in this record that is not about the performance. Teatr Wielki announces a
   * season's sale weeks ahead ("Sprzedaż biletów od 1 września, g. 11.00") and Ticketmaster
   * carries `sales.public.startDateTime` — and a sale you find out about afterwards is a sale you
   * missed, so this is what the `presale` notice counts down to. `onsale` is the opposite half:
   * the moment a link appeared, observed rather than foretold.
   */
  onSaleAt?: number;
  /**
   * When the collector first observed a ticket link on this event. The `onsale` transition cannot
   * be recomputed from the merged document — only the upsert knows what changed — so it is
   * recorded here at the moment it happens.
   */
  onSaleSeenAt?: number;
  /**
   * Equal for two documents that are the same real-world event from two sources. Ticketmaster and
   * the Teatr Wielki scrape will both list the same Nozze; this is what stops that being two
   * cards and two notifications.
   */
  fingerprint: string;
  /** Set once, on create, never rewritten. This is what makes "announced" mean anything. */
  firstSeenAt: number;
  updatedAt: number;
}

/**
 * A saved interest. Not a category — a matcher, so "medieval fairs at castles" and "everything the
 * Opera announces" are both expressible without the app shipping a taxonomy.
 *
 * Extends `Versioned` structurally (id / rev / updatedAt / writerId / deleted) so the sleep log's
 * reconciler merges these without being told anything about them. Declared here rather than
 * imported because this directory may not import outside itself; `interests.test.ts` asserts the
 * two shapes stay compatible.
 */
export interface Interest {
  id: string;
  rev: number;
  updatedAt: number;
  writerId: string;
  deleted?: boolean;

  label: string;
  /**
   * Any-of, folded, matched on word boundaries. **An empty array is no constraint, not "matches
   * nothing"** — the Opera Narodowa interest is `tags: ['opera']` with no keywords at all, and
   * reading empty as unsatisfiable silently kills it.
   */
  keywords: string[];
  /** Any hit vetoes. How 'Pink Floyd' stops matching guitar-hardware listings. */
  excludeKeywords?: string[];
  /** All-of against `EventRecord.tags`. Absent or empty is no constraint. */
  tags?: string[];
  /** Any-of against `EventRecord.city`. Absent or empty means anywhere. */
  cities?: string[];
  /**
   * Any-of against `EventRecord.country`, as ISO-2 codes. Absent or empty means anywhere.
   *
   * Read together with `internationalAnywhere` as **one** rule rather than as two constraints —
   * see the `places` case in `matchReason`. Two independent all-of constraints would mean "in
   * Poland AND international", which is nobody's question.
   */
  countries?: string[];
  /**
   * Whether an `international` event passes wherever it is held.
   *
   * This is the half `countries` cannot express. "Conferences in Poland, plus the ones worth
   * flying to" is a single thought, and a country list alone answers it by dropping EuroPython
   * along with PyCon NL.
   */
  internationalAnywhere?: boolean;
  /**
   * Whether articles *about* events count as matches — see `EventKind`.
   *
   * Off by default, and it is the one filter here that is on without being asked for: a feed of
   * sponsor posts about a race is not a feed of races, and nobody sets up an event watcher wanting
   * one. It is an opt-in rather than an opt-out because the interest that wants coverage is the
   * unusual one — "everything the Maraton Warszawski blog says" is a readable thing to ask for,
   * and this is how it is asked for.
   *
   * `announcement` is never filtered by this: an article announcing an event is the case the RSS
   * adapter exists to carry, and dropping it would take the ticket-sale and calendar posts with it.
   */
  includeCoverage?: boolean;
  /** `YYYY-MM-DD` window, compared lexically against `EventRecord.day`. */
  fromDay?: string;
  toDay?: string;
  /** How much warning is wanted before the date. Days. */
  leadDays: number;
  /** Matches the feed, never pushes. */
  muted?: boolean;
  /**
   * Distinct from `updatedAt` on purpose: `announced` only fires for events first seen after the
   * interest existed, so a new interest surfaces its backlog in the feed and pushes about nothing.
   * Were this `updatedAt`, editing an interest's keywords would re-arm its whole backlog.
   */
  createdAt: number;
}

/**
 * One event the reader has dismissed by hand.
 *
 * The app's other two ways of not seeing something are rules — an interest's `excludeKeywords`
 * turn away a *kind* of event, and the countries filter turns away a *place*. Neither can say "yes,
 * this is exactly what I asked for, and I am not going to that one": a keyword narrow enough to
 * remove a single concert usually removes the next one by the same artist too, and writing one per
 * dismissal turns the interest into a blocklist that nobody can read afterwards.
 *
 * **Keyed by fingerprint, not by event id.** Ticketmaster and the Teatr Wielki scrape both list the
 * same night; the feed already collapses them with `dedupeByFingerprint`, so ignoring the row you
 * are looking at has to ignore the twin behind it, or the card comes back the day the other source
 * wins the dedupe. That is the same argument `noticeIdFor` is keyed on the fingerprint for.
 *
 * Extends `Versioned` structurally, like `Interest` — so `mergeById` reconciles two devices without
 * being told anything about it. `deleted` here means **un-ignored**: not-ignored is the resting
 * state, so lifting an ignore is a tombstone rather than a field. The id is derived from the
 * fingerprint, which makes re-ignoring meet its own tombstone — exactly the case `versioned.ts`
 * documents, and what its causal rule (a live row past the tombstone's rev wins) exists for.
 */
export interface Ignore {
  /** `slugKey(fingerprint)`. Derived, so two devices dismissing the same card write one document. */
  id: string;
  rev: number;
  updatedAt: number;
  writerId: string;
  /** Tombstone, meaning un-ignored. */
  deleted?: boolean;
  fingerprint: string;
  /**
   * The title at the moment it was dismissed. Denormalised for the same reason `Notice.title` is:
   * so this collection can be read in a console without a join back to `events/`. The UI never
   * uses it — an ignored row is drawn from the corpus copy, which is the current one.
   */
  title: string;
}

/**
 * Why a notification fired.
 *
 * `presale` and `onsale` are the two halves of one question asked at two different times, and only
 * one of them is any use for a season that sells out in a morning: `presale` is "the sale opens on
 * a date the source has already told us", counted down to like `soon` counts down to a curtain,
 * where `onsale` is "a ticket link has appeared", which can only ever be observed once it is too
 * late to have planned for it.
 */
export type NoticeKind = 'announced' | 'onsale' | 'soon' | 'presale';

export interface Notice {
  /** `${slugKey(fingerprint)}|${kind}` — see noticeIdFor. */
  id: string;
  kind: NoticeKind;
  fingerprint: string;
  /** Whichever document won the fingerprint. */
  eventId: string;
  /** Why it fired. Rendered in the alerts history. */
  interestIds: string[];
  /** Set by the create() that claims the send. */
  claimedAt: number;
  /** Set once web-push resolves. Null means claimed-but-not-delivered. */
  sentAt: number | null;
  failed?: string;
  /** Denormalised so the history renders without a join back to `events/`. */
  title: string;
  startsAt: number | null;
  /** Denormalised for the same reason `startsAt` is — a `presale` row's date is this one, not that. */
  onSaleAt?: number;
  url: string;
  /** Denormalised for the same reason, and because the push body is built from this shape. */
  distancesM?: number[];
}

/** A browser's push registration. One per device, keyed by a hash of the endpoint. */
export interface PushSub {
  id: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
  lang: 'en' | 'pl';
  /** Truncated user agent — the only way to tell the phone from the laptop in the device list. */
  ua: string;
  createdAt: number;
  /** Heartbeat, written on app launch. Lets a dead device be pruned without waiting for a 410. */
  lastSeenAt: number;
  lastPushAt?: number;
  lastError?: string;
  retiredAt?: number;
}

/** Per-user notification settings. `armedAt` is the first line of defence against the storm. */
export interface PushSettings {
  /**
   * When notifications were first armed. `announced` fires only for events first seen after it,
   * so arming does not replay the whole corpus into your lock screen.
   */
  armedAt: number | null;
  maxPerRun: number;
  maxOnSalePerRun: number;
}

export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  armedAt: null,
  maxPerRun: 3,
  maxOnSalePerRun: 10,
};

/** Health of one collector source, so a scrape that quietly returns nothing is visible. */
export interface SourceHealth {
  id: string;
  label: string;
  lastRunAt: number;
  lastOkAt: number | null;
  lastCount: number;
  consecutiveFailures: number;
  lastError?: string;
}
