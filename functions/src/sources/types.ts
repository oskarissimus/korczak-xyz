/*
 * What a source adapter has to provide, and — more importantly — what it does not.
 *
 * An adapter returns `RawEvent[]` and nothing derived: the id, the haystack, the fingerprint and
 * the day are all computed by the orchestrator, so a new adapter never re-implements normalisation
 * and cannot get it subtly different. Adding a source is one file plus one line in `index.ts`.
 */

export interface SourceContext {
  now: number;
  fetch: typeof globalThis.fetch;
  /** Reads a secret. Returns undefined when it was never set, which is not an error for every source. */
  secret: (name: string) => string | undefined;
}

export interface RawEvent {
  /**
   * Which publication this row came off, where the adapter reads more than one.
   *
   * Absent means the adapter's own label, which is right for the four sources that are one place:
   * a Teatr Wielki night comes from Teatr Wielki. The RSS adapter is the exception it exists for —
   * it is one adapter over a list of unrelated magazines, and without this every item from
   * historia.org.pl, the Jewish Culture Festival and Maraton Warszawski is stored as `Watched
   * feeds`, which is the name of a *mechanism* and tells a reader nothing about where the words
   * came from. `EventRecord.sourceName` always meant the publication — its own comment gives
   * `historia.org.pl` as the example — so this is the adapter finally supplying it.
   *
   * Deliberately **not** used by the entry-platform scrape, whose several pages are disciplines of
   * one platform rather than different publications, and whose labels are URLs rather than names.
   * A race comes from Elektroniczne Zapisy whichever listing page it was on.
   */
  sourceName?: string;
  /**
   * The source's own stable identifier, or null to have one synthesised from title + day + venue.
   *
   * Whatever goes here must not move when the price, the description or the availability does: a
   * key that changes mints a second document, `firstSeenAt` is fresh, and the event is announced
   * all over again.
   */
  sourceKey: string | null;
  title: string;
  subtitle?: string;
  url: string;
  /** Epoch ms, or null for something announced before its dates are known. */
  startsAt: number | null;
  endsAt?: number;
  allDay?: boolean;
  /** The source's own words, kept when the date could not be parsed. */
  dateText?: string;
  /**
   * When the source says it published this. Epoch ms.
   *
   * Only where the source states it — `<time datetime>`, an RSS `pubDate` — and never guessed at
   * from the run's clock, which would make every row look published the day it was scraped and is
   * precisely the confusion this field exists to end. It is not `startsAt` and must never be put
   * there: see the header of `rss.ts`.
   */
  publishedAt?: number;
  city?: string;
  venue?: string;
  /**
   * ISO-3166-1 alpha-2, where the source knows it for certain.
   *
   * Only where it is a fact rather than a reading: Teatr Wielki is in Warsaw, and Ticketmaster is
   * queried `countryCode=PL`. Left absent otherwise — the classifier fills it in, and one field
   * with two derivations is how the app comes to disagree with itself about where something is.
   */
  country?: string;
  tags?: string[];
  ticketUrl?: string;
  onSaleAt?: number;
  description?: string;
}

export interface EventSource {
  /** Becomes the first half of every event id this adapter produces. Never change it in place. */
  id: string;
  label: string;
  /**
   * Throws to fail the whole source (recorded as a failure, and reported after three in a row);
   * returns `[]` to mean "ran fine, nothing on", which is a real answer for a quiet week.
   */
  fetchEvents(ctx: SourceContext): Promise<RawEvent[]>;
}

/** A small fetch helper every adapter wants: a deadline, and a readable failure. */
export async function fetchText(
  ctx: SourceContext,
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await ctx.fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        // Some of these sites serve a different page, or none, to an unidentified client.
        'user-agent': 'korczak.xyz event watch (+https://korczak.xyz)',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
