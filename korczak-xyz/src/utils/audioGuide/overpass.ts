/*
 * Where the pins come from: Overpass, the query service over OpenStreetMap's own data.
 *
 * Two halves, split so the half worth testing can be. `overpassQuery` and `transformAttractions`
 * are pure; `fetchAttractions` is the request around them.
 *
 * There is no API key and no account here, which is the whole reason this runs in the browser
 * rather than behind the site's own backend. The public endpoint is shared and rate limited by
 * IP, so the two things that keep this polite are both here: the viewport is debounced before a
 * request is made at all (see `useNearbyAttractions`), and a 429 backs off rather than retrying at once.
 */

import type { Attraction, Bounds } from './types';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

/**
 * Raised when Overpass declines to answer. Worth its own name because it is the one failure the
 * reader can do something about - wait, or zoom in - and the one the retry loop treats specially.
 *
 * `busy` is the server's state and `too-big` is the question's, and they are told apart by how
 * Overpass says them rather than by guessing: a 429 (this IP is asking too often) and a 504 (the
 * server is too loaded to start the query at all) are both `busy`, while a query that ran out of
 * time or memory comes back **200** with a `remark` saying so - that is the only `too-big`.
 * Reading 504 as "too big" told somebody looking at one city block to zoom in.
 */
export class OverpassBusyError extends Error {
  constructor(readonly kind: 'busy' | 'too-big') {
    super(kind);
    this.name = 'OverpassBusyError';
  }
}

/**
 * The categories worth narrating.
 *
 * `tourism` covers the obvious ones, `historic` the plaques and ruins that make a walk worth
 * taking, and places of worship are here because in most European old towns they are the oldest
 * thing standing. Everything else OSM knows - shops, benches, bus stops - would bury those under
 * pins nobody wants a story about. `tourism=information` is left out for the same reason: it is
 * every guidepost and map board, and a story about a signpost is not one.
 *
 * Every clause asks for `["name"]`. `transformAttractions` drops unnamed elements anyway, and
 * `historic` alone is mostly unnamed walls, boundary stones and plaques - asking Overpass to drop
 * them means it neither serialises nor sends them, which in an old town was most of the answer.
 * `qt` sorts the output by location rather than by id, which Overpass documents as the cheaper
 * of the two; the order means nothing here, since the cache refiles everything by square.
 */
export function overpassQuery(bounds: Bounds): string {
  const { south, west, north, east } = bounds;
  const box = `${south},${west},${north},${east}`;

  // `out center` rather than `out geom`: a way or a relation is a polygon, and all this app can
  // do with a cathedral's outline is drop one pin in the middle of it.
  return `[out:json][timeout:25];
(
  nwr["tourism"~"^(museum|attraction|gallery|viewpoint|artwork)$"]["name"](${box});
  nwr["historic"]["name"](${box});
  nwr["amenity"="place_of_worship"]["name"](${box});
);
out center qt;`;
}

/** The OSM tag that best names what a thing is, for the model's benefit rather than the map's. */
function categoryOf(tags: Record<string, string>): string {
  if (tags.tourism) return tags.tourism;
  if (tags.historic) return `historic:${tags.historic}`;
  if (tags.amenity === 'place_of_worship') return 'place_of_worship';
  return 'attraction';
}

interface OverpassElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Raw Overpass elements to attractions, dropping everything the app could not use.
 *
 * Unnamed elements go first and take most of the response with them: OSM is full of historic
 * walls and untagged ruins, and a pin labelled nothing is a pin nobody taps. What is left must
 * have a position - a node carries one directly, a way or relation only as `center`, and an
 * element with neither is a data error rather than a place.
 */
export function transformAttractions(response: unknown): Attraction[] {
  const elements = (response as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];

  const out: Attraction[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const type = el.type as Attraction['type'];
    if (type !== 'node' && type !== 'way' && type !== 'relation') continue;

    out.push({
      id: el.id,
      type,
      key: `${type}/${el.id}`,
      name,
      lat,
      lon,
      category: categoryOf(el.tags ?? {}),
    });
  }
  return out;
}

/**
 * One Overpass request.
 *
 * POST with a form-encoded body rather than GET with a query string: a bounding box query is
 * comfortably past what some proxies will carry in a URL, and Overpass documents the form body as
 * the way to send a long one.
 */
async function requestAttractions(bounds: Bounds, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(bounds))}`,
    signal,
  });

  if (!response.ok) {
    // 429 is "you are asking too often" and 504 is "the server is too loaded to start" - the
    // public instance's dispatcher answers 504 when its queue is full, whatever the box. Neither
    // says anything about the size of the question, and both are worth waiting out.
    if (response.status === 429 || response.status === 504) throw new OverpassBusyError('busy');
    throw new Error(`Overpass ${response.status}`);
  }

  const body: unknown = await response.json();
  if (ranOutOfRoom(body)) throw new OverpassBusyError('too-big');
  return body;
}

/**
 * Whether a 200 is Overpass saying the query outgrew its `[timeout:25]` or its memory. That arrives
 * as a successful response with a `remark` beside whatever elements it got through, so without this
 * check a box too big to answer would draw a partial set of pins and say nothing.
 */
export function ranOutOfRoom(response: unknown): boolean {
  const remark = (response as { remark?: unknown })?.remark;
  return typeof remark === 'string' && /timed out|out of memory/i.test(remark);
}

/** How long to wait before attempt `n`. Exported so the test does not have to wait for it. */
export function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** attempt;
}

/**
 * Overpass with a retry, for a busy server only.
 *
 * A box too big to answer is not retried: it will be too big to answer again,
 * and three more attempts only spend the shared endpoint's patience on a question it has already
 * refused. The reader is told to zoom in instead.
 */
export async function fetchAttractions(
  bounds: Bounds,
  signal: AbortSignal,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Attraction[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return transformAttractions(await requestAttractions(bounds, signal));
    } catch (e) {
      const busy = e instanceof OverpassBusyError && e.kind === 'busy';
      if (!busy || attempt >= MAX_RETRIES) throw e;
      await sleep(backoffMs(attempt));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    }
  }
}

/**
 * How many pins the map will draw, however many came back.
 *
 * A dense old town answers with several hundred, and every one of them is a Leaflet `DivIcon` -
 * a real DOM node with a label - which is where a phone's map stops panning smoothly. The cut is
 * arbitrary but the ceiling is not: this is the number at which an iPhone still scrolls.
 */
export const MAX_MARKERS = 100;
