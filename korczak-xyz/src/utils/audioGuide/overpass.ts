/*
 * Where the pins come from: Overpass, the query service over OpenStreetMap's own data.
 *
 * Two halves, split so the half worth testing can be. `overpassQuery` and `transformAttractions`
 * are pure; `fetchAttractions` is the request around them.
 *
 * There is no API key and no account here, which is the whole reason this runs in the browser
 * rather than behind the site's own backend. The public endpoint is shared and rate limited by
 * IP, so the two things that keep this polite are both here: the viewport is debounced before a
 * request is made at all (see `useAttractions`), and a 429 backs off rather than retrying at once.
 */

import type { Attraction, Bounds } from './types';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

/**
 * Raised when Overpass says it is busy. Worth its own name because it is the one failure the
 * reader can do something about - wait, or zoom in - and the one the retry loop treats specially.
 */
export class OverpassBusyError extends Error {
  constructor(readonly kind: 'rate-limited' | 'timeout') {
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
 * pins nobody wants a story about.
 */
export function overpassQuery(bounds: Bounds): string {
  const { south, west, north, east } = bounds;
  const box = `${south},${west},${north},${east}`;

  // `out center` rather than `out geom`: a way or a relation is a polygon, and all this app can
  // do with a cathedral's outline is drop one pin in the middle of it.
  return `[out:json][timeout:25];
(
  nwr["tourism"~"museum|attraction|gallery|viewpoint|artwork|information"](${box});
  nwr["historic"](${box});
  nwr["amenity"="place_of_worship"](${box});
);
out center;`;
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
    // 429 is "you are asking too often", 504 is "this box was too big to answer in time". They
    // read the same to a reader and mean opposite things about what to do next.
    if (response.status === 429) throw new OverpassBusyError('rate-limited');
    if (response.status === 504) throw new OverpassBusyError('timeout');
    throw new Error(`Overpass ${response.status}`);
  }

  return response.json();
}

/** How long to wait before attempt `n`. Exported so the test does not have to wait for it. */
export function backoffMs(attempt: number): number {
  return BACKOFF_BASE_MS * 2 ** attempt;
}

/**
 * Overpass with a retry, for rate limiting only.
 *
 * A timeout is not retried: the box that was too big to answer will be too big to answer again,
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
      const busy = e instanceof OverpassBusyError && e.kind === 'rate-limited';
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
