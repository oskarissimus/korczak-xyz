/*
 * The shapes the public-transport app is built on.
 *
 * Everything in `src/utils/transit/` is pure and **portable**: it runs unchanged in the browser and
 * in a Cloud Function on Node, for the reason `src/utils/events/types.ts` gives at length — the
 * collector decides what to push and the app decides what to draw, and if the two ever answer
 * "does this communiqué touch my route?" differently then the notifications and the screen stop
 * describing the same world.
 *
 * `transit/portable.test.ts` enforces it, with one allowance the events directory does not have:
 * these modules may import from `../events/`, which is itself proven portable by its own copy of
 * that test. That is how `foldText` and `slugKey` are shared rather than written twice — the repo's
 * rule being that a copy is identical only until the first bug fix.
 */

/**
 * Which of WTP's two feeds an item came from.
 *
 * They are the same publication mechanism and two genuinely different promises:
 *
 * - `impediment` (`/utrudnienia/`) is something wrong *now* — a failure, an accident, a station
 *   shut this afternoon. WTP's own bot re-reads it every five minutes.
 * - `change` (`/zmiany/`) is a planned alteration to how the line runs — roadworks, a concert at
 *   the Narodowy, a weekend closure. Announced in advance, re-read every two hours.
 *
 * Kept as a field rather than collapsed into one stream because the difference is the first thing
 * you want off a lock screen: "the metro is broken" and "the metro will be rerouted a week on
 * Saturday" are not the same message even when they name the same stations.
 */
export type FeedKind = 'impediment' | 'change';

export const FEED_KINDS: readonly FeedKind[] = ['impediment', 'change'];

/** The two metro lines. The only lines this app extracts stop-level detail for — see `EXTRACTED_LINES`. */
export type MetroLine = 'M1' | 'M2';

export const METRO_LINES: readonly MetroLine[] = ['M1', 'M2'];

/**
 * One communiqué, as stored in the shared `transitItems` corpus.
 *
 * Two layers, and the split is the whole design. Everything down to `contentHash` is **read off the
 * feed** and is true whether or not a language model ever ran; everything after it is the model's
 * reading of the prose, and may be absent, stale or wrong. The UI and the notifier both have to be
 * able to say which half they are looking at, because "the metro is fine" and "nothing could be
 * extracted" are the two states this app must never confuse.
 */
export interface TransitItem {
  /** `${feed}_${slugKey(guid)}` — derived from the feed's own permalink, so two runs converge. */
  id: string;
  feed: FeedKind;
  /** The feed's `<guid>`, unnormalised. Kept for joining an item to its raw archive row. */
  guid: string;
  /** WTP's own headline, e.g. `Utrudnienia w komunikacji: 189, 401, 402`. */
  title: string;
  url: string;
  /** The article prose, tags stripped, capped. What the extractor is shown. */
  body?: string;
  /** `pubDate` as epoch ms. A communiqué is an article, so this is the only date the feed states. */
  publishedAt: number;
  /**
   * Every line named in the **title**, verbatim: `['189', '401', '402']`, `['M1']`, `['742', 'M1']`.
   *
   * WTP puts the affected line list in the headline of every item in both feeds, which is what
   * makes this app cheap: the decision "is this worth a model call?" is answered from a string that
   * came free with the feed, so a week of bus roadworks costs nothing at all. See `linesInTitle`.
   */
  titleLines: string[];
  /**
   * A digest of exactly what the extractor was shown. Unchanged content, no second call — the same
   * bargain `classifyHash` makes in the events app, and the same reason: WTP edits a live
   * communiqué as a closure develops, and re-reading it then is the point, while re-reading it
   * every ten minutes because `updatedAt` moved is a bill for nothing.
   */
  contentHash: string;

  /* --- the extractor's reading, absent until it has run ------------------------------------- */

  /** Which of the two metro lines the prose is actually about. */
  lines?: MetroLine[];
  /**
   * The stations trains do not call at, canonicalised to `STATIONS` spelling.
   *
   * Empty is a real answer and is not the same as absent: a communiqué can affect a line without
   * closing a station (a reduced frequency, a lift out of order), and `closedStops: []` says the
   * extractor read the prose and found no closure. Absent says nobody has read it.
   */
  closedStops?: string[];
  /** True where the prose describes the whole line stopping rather than named stations. */
  wholeLine?: boolean;
  /** When the disruption starts, epoch ms. Absent where the prose gives no time — which is common. */
  effectiveFrom?: number;
  /** When it ends. Absent means open-ended, which for an `impediment` is the usual case. */
  effectiveUntil?: number;
  /** The reason, in the source's own words, short. Absent means the communiqué stated none. */
  reason?: string;
  /** The extractor's one-line summary in English, for a lock screen that has no room for prose. */
  summary?: string;
  extractedAt?: number;
  /** The `contentHash` the fields above were computed from. See `needsExtracting`. */
  extractHash?: string;
  /** Why the last extraction attempt produced nothing, so the Raw tab can say. */
  extractError?: string;

  firstSeenAt: number;
  updatedAt: number;
}

/**
 * A stretch of one metro line the reader actually travels.
 *
 * Not a filter over stations but an **interval**, because that is what a journey is: naming Rondo
 * Daszyńskiego and Świętokrzyska has to mean the six stops between them as well, or a closure at
 * Rondo ONZ — squarely in the middle of the trip — reads as somebody else's problem.
 *
 * Extends `Versioned` structurally (id / rev / updatedAt / writerId / deleted) so the sleep log's
 * reconciler merges these without being told anything about them, exactly as `Interest` does.
 */
export interface WatchedSegment {
  id: string;
  rev: number;
  updatedAt: number;
  writerId: string;
  deleted?: boolean;

  label: string;
  line: MetroLine;
  /** Canonical station names, as spelt in `STATIONS`. Order is irrelevant; the interval is unordered. */
  from: string;
  to: string;
  /** Matches the feed and the line-level alerts, but never raises one to route priority. */
  muted?: boolean;
  createdAt: number;
}

/**
 * How much a communiqué matters to this reader.
 *
 * Two levels, which is what was asked for: something happened on a line you ride, and something
 * happened on the stretch of it you ride. They are different notifications because they prompt
 * different acts — one is worth knowing, the other is worth leaving early for.
 */
export type Impact = 'route' | 'line';

export const IMPACTS: readonly Impact[] = ['route', 'line'];

/**
 * The result of asking "does this touch me?", with its own uncertainty attached.
 *
 * `certain` is the field that keeps this honest. An item whose prose the extractor could not read
 * is **not** evidence that the route is fine — it is no evidence at all, and the difference has to
 * survive all the way to the lock screen or a failed extraction becomes a quiet all-clear. See
 * `impactOf`, which resolves the unknown case upward rather than downward.
 */
export interface ImpactVerdict {
  impact: Impact;
  certain: boolean;
  /** Which watched segments it lands on. Empty for a `line` verdict. */
  segmentIds: string[];
  /** Which watched lines it names. Never empty — an item touching none of them yields no verdict. */
  lines: MetroLine[];
  /** The stations that put it on the route, for the card and the push body. */
  stops: string[];
}

/** Why a notification fired. The impact, verbatim: the two levels are the two kinds. */
export type AlertKind = Impact;

/**
 * One notification, claimed before it is sent.
 *
 * Same lock-not-receipt rule as the events app's `Notice`: `create()` fails on an existing
 * document, so the claim is the latch, and a crash between claiming and sending loses one alert
 * rather than repeating it.
 */
export interface TransitAlert {
  /** `${slugKey(guid)}|${kind}|${contentHash}` — see `alertIdFor`. */
  id: string;
  kind: AlertKind;
  itemId: string;
  guid: string;
  feed: FeedKind;
  /** The content revision this alert was raised for, so an edited communiqué can raise a second. */
  contentHash: string;
  segmentIds: string[];
  lines: MetroLine[];
  stops: string[];
  certain: boolean;
  claimedAt: number;
  sentAt: number | null;
  failed?: string;
  /** Denormalised so the history renders without a join back to `transitItems`. */
  title: string;
  url: string;
  publishedAt: number;
  summary?: string;
}

/** Per-user notification settings for this app. Deliberately its own document, not Event Watch's. */
export interface TransitSettings {
  /**
   * When alerts were first armed. Nothing already in the corpus at that moment may fire, or the
   * first launch replays a fortnight of metro history into the lock screen.
   */
  armedAt: number | null;
  /** Alerts about a watched line that miss every watched segment. The lower of the two kinds. */
  lineAlerts: boolean;
  /** Planned changes, as opposed to things going wrong now. */
  changeAlerts: boolean;
  maxPerRun: number;
}

export const DEFAULT_TRANSIT_SETTINGS: TransitSettings = {
  armedAt: null,
  lineAlerts: true,
  changeAlerts: true,
  /*
   * Higher than Event Watch's three. A single tram closure can produce a dozen communiqués in an
   * afternoon, but the metro-only filter has already cut this to the two lines the reader rides —
   * so what is left is genuinely about their commute, and collapsing six of those into a summary
   * would throw away the stop names that are the whole content.
   */
  maxPerRun: 6,
};

/**
 * One fetch of one feed, recorded whether or not it worked.
 *
 * This exists because of how WTP fails. The site is behind AWS WAF, and a challenged request comes
 * back **HTTP 202 with an empty body** — which a naive reader parses as a feed containing no items,
 * i.e. as "nothing is wrong with the metro today". That is the single worst outcome available to
 * this app, so the adapter treats a non-XML body as an error and this row records what actually
 * came back, headers and first bytes included.
 */
export interface FeedFetch {
  /** `${feed}` — one row per feed, overwritten each run. The history lives in `transitRaw`. */
  id: string;
  feed: FeedKind;
  url: string;
  fetchedAt: number;
  ok: boolean;
  status?: number;
  bytes: number;
  itemCount: number;
  /** The first bytes of a body that was not a feed. The whole point of the row. */
  bodyHead?: string;
  error?: string;
  /** Consecutive failures, so a dead feed is a notification rather than a silence. */
  consecutiveFailures: number;
  lastOkAt: number | null;
}

/**
 * One feed item, exactly as it arrived.
 *
 * Kept for every item of both feeds, not only the metro ones and not only the ones that parsed —
 * the request was to be able to look at the source when the reading of it goes wrong, and an
 * archive that only keeps what was understood cannot answer that. Keyed by the item's guid, so a
 * communiqué WTP edits overwrites its own row rather than accumulating.
 */
export interface RawFeedItem {
  /** `${feed}_${slugKey(guid)}`, the same id as the `TransitItem` it produced. */
  id: string;
  feed: FeedKind;
  guid: string;
  title: string;
  url: string;
  publishedAt: number;
  /** The item element's XML, capped. */
  xml: string;
  fetchedAt: number;
  /** Whether a `TransitItem` was successfully derived from it. */
  parsed: boolean;
}
