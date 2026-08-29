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
export type SourceId = 'ticketmaster' | 'teatr-wielki' | 'python-org' | 'feed';

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

export type NoticeKind = 'announced' | 'onsale' | 'soon';

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
  url: string;
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
