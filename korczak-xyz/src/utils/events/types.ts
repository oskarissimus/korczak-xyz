/*
 * The shapes the events app is built on.
 *
 * Everything in `src/utils/events/` is pure and **portable**: it runs unchanged in the browser and
 * in a Cloud Function on Node, because the collector and the feed have to agree exactly about what
 * reaches a reader. If they ever disagree, the feed shows things you were never told about and
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
 * A judgement, like `reach`, and made by the same call. Absent means unclassified.
 *
 * **It filters nothing.** `Interest.includeCoverage` was the opt-in that let `coverage` through,
 * and it went with the interests (Sep 2026): the feed is what the enabled sources collected, and
 * which of a source's rows are worth reading is that source's own business — a scrape yielding
 * sponsor posts is fixed in its adapter or switched off on the Sources tab. What the field still
 * does is put a word on the card, so an article among the listings says it is one.
 */
export type EventKind = 'listing' | 'announcement' | 'coverage';

export const KINDS: readonly EventKind[] = ['listing', 'announcement', 'coverage'];

export interface EventRecord {
  /** `${source}_${slugKey(sourceKey)}` — derived, never random, so two runs converge. */
  id: string;
  source: SourceId;
  /** The source's own stable identifier, unnormalized. Kept for debugging a bad id. */
  sourceKey: string;
  /**
   * Human name of the origin, shown on the card: 'Teatr Wielki', 'historia.org.pl'.
   *
   * The **publication**, not the adapter — `source` above is the adapter, and one of them reads a
   * list of unrelated magazines. `RawEvent.sourceName` is how an adapter that knows the difference
   * says so; `toRecord` falls back to the adapter's label for the four sources that are one place.
   */
  sourceName: string;
  title: string;
  /** Composer, genre, artist — whatever the source offers as a second line. */
  subtitle?: string;
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
   * otherwise. Absent means nobody has worked it out yet — which is a third state and not a fourth
   * country. Nothing filters on it since the interests went; it is read on the card, where `?` is
   * how "not labelled yet" is said.
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
   * else. Absent means unclassified — which is not `listing`, and is its own state for the same
   * reason an absent `reach` is one.
   */
  kind?: EventKind;
  /** Why the classifier called it that. Kept beside the verdict, like `reachReason`. */
  kindReason?: string;
  /**
   * Whether the **newsroom reader** found a stated ticket-sale date on this article.
   *
   * A different question from `kind` directly above, and the two are worth keeping straight.
   * `kind` asks whether a row belongs in an event feed at all, over the whole corpus, from
   * `classify.ts`. This asks the one thing worth knowing about a theatre's own news item — do
   * tickets go on sale on a date it states — over the dozen rows a source tagged `newsroom`, from
   * `readNewsroom.ts`, a separate pass on a separate version for the reasons in that file's header.
   *
   * Stored rather than inferred from `onSaleAt`, because the two can disagree and the disagreement
   * is the thing worth being able to see: `true` here with no `onSaleAt` beside it is the reader
   * saying "this announces a sale" and its date failing the guards — a sale already open, or a
   * year the model misread. Inferring the boolean from the date would make that case look
   * identical to a parking notice.
   *
   * `tagsWithTicketSale` turns a *dated* verdict into the tag an interest can match, and is the
   * one place that union is made.
   */
  newsroomTicketSale?: boolean;
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

/**
 * One of the two apps that send push. See `pushApps.ts` for what a subscription's claim means.
 */
export type PushApp = 'events' | 'transit';

/**
 * A browser's push registration, keyed by a hash of the endpoint.
 *
 * **Not one per device.** It was written as one per device and that was wrong: on iOS every
 * installed app is its own storage container with its own service worker registration, so a phone
 * with both Event Watch and Metro Watch on its home screen registers *two* subscriptions with two
 * endpoints, and a collector that fans out to every row on the account delivers each app's
 * notifications to both. `apps` is what stops that; `pushApps.ts` has the whole argument.
 */
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
  /**
   * Which apps may push to this endpoint.
   *
   * A map rather than an array so a merge-write from one app cannot drop the other's claim: a
   * `setDoc(..., { merge: true })` replaces an array wholesale but merges a map key by key, and on
   * a desktop browser — where one registration really does serve both apps — both write this same
   * field from two different tabs. Absent means "every app", which is what every row written before
   * this field existed has to mean; see `claimsApp`.
   */
  apps?: Partial<Record<PushApp, boolean>>;
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
  /**
   * How many `soon` reminders one run may send.
   *
   * It had no cap while the interests existed, and did not need one: a reminder fired only for a
   * row somebody had asked about by name, so the ceiling was the size of a hand-written list. The
   * feed is now everything the enabled sources collect, and the entry platform alone lists a
   * hundred-odd races nationally — a fortnight's lead over that is a morning of buzzing about
   * events in towns nobody named. So it is capped like the other two, and looser than `announced`
   * because a date arriving is the thing being watched for rather than a scrape twitching.
   */
  maxSoonPerRun: number;
}

export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  armedAt: null,
  maxPerRun: 3,
  maxOnSalePerRun: 10,
  maxSoonPerRun: 5,
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
