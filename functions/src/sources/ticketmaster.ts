/*
 * Ticketmaster's Discovery API, for Poland.
 *
 * The only source here with a real API: free key, JSON, 5000 calls a day at 5 a second. It covers
 * the ticketed end of what is being watched for — touring acts, tribute shows, the bigger festivals
 * — which is also the end where `onsale` matters most.
 *
 * Note this source can never produce an `onsale` transition: a Ticketmaster listing IS its ticket
 * page, so `ticketUrl` is set from the first sighting. That is correct rather than a gap — it only
 * lists what is already on sale.
 */

import type { EventSource, RawEvent, SourceContext } from './types';
import {
  TICKETMASTER_COUNTRY,
  TICKETMASTER_ENDPOINT as ENDPOINT,
} from '../../../korczak-xyz/src/utils/events/sources';
const PAGE_SIZE = 200;
/** Their deep-paging cap is 1000 items whatever we ask for, so more pages than this buy nothing. */
const MAX_PAGES = 5;

interface TmEvent {
  id?: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string; noSpecificTime?: boolean };
  };
  sales?: { public?: { startDateTime?: string } };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  _embedded?: {
    venues?: Array<{ name?: string; city?: { name?: string } }>;
    attractions?: Array<{ name?: string }>;
  };
}

/**
 * Their classification tree as our tags.
 *
 * Lowercased and folded to the same vocabulary the other sources use, so an interest asking for
 * `opera` matches a Ticketmaster listing and a Teatr Wielki one alike. The raw genre is kept too —
 * it costs nothing and lets a keyword reach something the fixed vocabulary missed.
 */
export function tagsOf(event: TmEvent): string[] {
  const tags = new Set<string>(['ticketed']);
  for (const c of event.classifications ?? []) {
    const segment = (c.segment?.name ?? '').toLowerCase();
    const genre = (c.genre?.name ?? '').toLowerCase();
    const sub = (c.subGenre?.name ?? '').toLowerCase();

    if (segment.includes('music')) tags.add('music');
    if (segment.includes('arts') || segment.includes('theatre')) tags.add('theatre');
    if (segment.includes('sports')) tags.add('sports');
    /*
     * `opera` only where they really say opera. Mapping `classical` onto it as well was wrong twice
     * over: a Chopin recital by candlelight is not opera, and the Opera Narodowa interest is
     * keyword-less by design (`tags: ['opera']`, no constraint), so every classical listing in the
     * country landed in it — 202 matches where 7 were the opera house. Their Polish catalogue has
     * no `opera` genre at all as of Aug 2026, so this mapping never bought anything either.
     * `classical` still reaches the feed: the raw genre slug is added below.
     */
    if (genre.includes('opera') || sub.includes('opera')) tags.add('opera');
    if (genre.includes('rock')) tags.add('rock');
    if (genre.includes('folk') || genre.includes('world')) tags.add('folk');

    for (const raw of [genre, sub]) {
      const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug) tags.add(slug);
    }
  }
  return [...tags];
}

export function toRawEvent(event: TmEvent): RawEvent | null {
  if (!event.id || !event.name) return null;

  const start = event.dates?.start;
  const startsAt = start?.dateTime
    ? Date.parse(start.dateTime)
    : start?.localDate
      ? Date.parse(`${start.localDate}T${start.localTime ?? '19:00:00'}+02:00`)
      : null;

  const venue = event._embedded?.venues?.[0];
  const attractions = (event._embedded?.attractions ?? [])
    .map((a) => a.name)
    .filter((n): n is string => Boolean(n));

  return {
    // Their event id is stable and documented, which is exactly what we want a key to be.
    sourceKey: event.id,
    title: event.name,
    subtitle: attractions.filter((n) => n !== event.name).join(', ') || undefined,
    url: event.url ?? `https://www.ticketmaster.pl/event/${event.id}`,
    startsAt: Number.isFinite(startsAt) ? (startsAt as number) : null,
    allDay: start?.noSpecificTime === true,
    city: venue?.city?.name,
    // The query is `countryCode=PL`, so this is the request's own constraint read back, not a guess.
    country: TICKETMASTER_COUNTRY,
    venue: venue?.name,
    tags: tagsOf(event),
    // A Ticketmaster listing is its own ticket page.
    ticketUrl: event.url,
    onSaleAt: event.sales?.public?.startDateTime
      ? Date.parse(event.sales.public.startDateTime)
      : undefined,
    description: [event.name, ...attractions, venue?.name].filter(Boolean).join(' '),
  };
}

export const ticketmaster: EventSource = {
  id: 'ticketmaster',
  label: 'Ticketmaster (PL)',
  async fetchEvents(ctx: SourceContext): Promise<RawEvent[]> {
    const key = ctx.secret('TICKETMASTER_API_KEY');
    /*
     * No key is a configuration state, not a failure. The app is useful without this source, and
     * reporting it as broken would put a red row on the alerts tab that no amount of fixing the
     * code would clear.
     */
    if (!key) return [];

    const out: RawEvent[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${ENDPOINT}?countryCode=${TICKETMASTER_COUNTRY}&size=${PAGE_SIZE}&page=${page}` +
        `&sort=date,asc&startDateTime=${new Date(ctx.now).toISOString().slice(0, 19)}Z` +
        `&apikey=${encodeURIComponent(key)}`;

      const response = await ctx.fetch(url);
      if (!response.ok) throw new Error(`ticketmaster page ${page} -> ${response.status}`);
      const body = (await response.json()) as {
        _embedded?: { events?: TmEvent[] };
        page?: { totalPages?: number };
      };

      for (const event of body._embedded?.events ?? []) {
        const raw = toRawEvent(event);
        if (raw) out.push(raw);
      }

      const total = body.page?.totalPages ?? 0;
      if (page + 1 >= total) break;
      // Their limit is 5 requests a second; one page every 250ms is comfortably inside it.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return out;
  },
};
