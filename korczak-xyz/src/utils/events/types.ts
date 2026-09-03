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
