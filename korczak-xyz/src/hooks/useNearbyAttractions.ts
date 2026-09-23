/*
 * The pins, kept in step with whatever rectangle the map is showing.
 *
 * Every pan and every zoom is a question, but most of them are answered from `AttractionCache`
 * (see `utils/audioGuide/tiles.ts`) at once and without a request: zooming in, and panning back
 * over ground already covered, draw their pins on the same frame. Only the squares not yet seen
 * go to Overpass, which is a free, shared, rate-limited public endpoint. Four things keep that
 * from being rude, and all of them are here rather than in `overpass.ts`, because they are about
 * when to ask rather than how:
 *
 *  - **The debounce.** A drag fires `moveend` once, but a pinch-zoom followed by a nudge fires
 *    three or four in a second. A quarter of a second of quiet before asking turns a fidget into
 *    one request. It was half a second, which was mostly dead time: the abort below already
 *    discards whatever a fidget does get sent. The cache is read without waiting for it.
 *  - **The zoom floor.** Below `MIN_ZOOM` nothing is asked for. A whole city is too big a box
 *    for the public instance and more pins than the map may draw; what is cached still shows,
 *    with a line saying to zoom in for more.
 *  - **The abort.** Moving again while a request is in flight abandons it. Overpass takes
 *    seconds to answer a dense box, and without this the answers arrive out of order and the map
 *    settles on the pins for a rectangle nobody is looking at any more.
 *  - **The unmount.** Leaving the page aborts too, so a navigation does not leave a request
 *    running against a component that no longer exists.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { fetchAttractions, MAX_MARKERS, OverpassBusyError } from '../utils/audioGuide/overpass';
import {
  AttractionCache,
  boundsOfTiles,
  nearestToCentre,
  type TileRange,
} from '../utils/audioGuide/tiles';
import type { Attraction, Bounds } from '../utils/audioGuide/types';

const DEBOUNCE_MS = 250;

/**
 * The widest the map may be before it stops asking. At 13 a phone's screen is a few kilometres
 * across - an old town and its surroundings - which the public instance answers comfortably.
 */
export const MIN_ZOOM = 13;

export type AttractionsError = 'busy' | 'too-big' | 'failed';

export interface NearbyAttractions {
  attractions: Attraction[];
  loading: boolean;
  /** True when the whole viewport has been answered and holds nothing - not "not asked yet". */
  empty: boolean;
  /** True when the map is zoomed out past `MIN_ZOOM` and nothing new will be asked for. */
  zoomedOut: boolean;
  error: AttractionsError | null;
  /** Hand it the map's current rectangle and zoom; it decides whether and when to ask. */
  setBounds: (bounds: Bounds, zoom: number) => void;
  retry: () => void;
}

function classify(e: unknown): AttractionsError {
  if (e instanceof OverpassBusyError) return e.kind;
  return 'failed';
}

export function useNearbyAttractions(): NearbyAttractions {
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [error, setError] = useState<AttractionsError | null>(null);

  const cache = useRef(new AttractionCache());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const last = useRef<{ bounds: Bounds; zoom: number } | null>(null);

  /** Draw what the cache holds for a viewport, and say what it does not. */
  const show = useCallback((bounds: Bounds): TileRange | null => {
    const { attractions: known, missing } = cache.current.lookup(bounds);
    setAttractions(nearestToCentre(known, bounds, MAX_MARKERS));
    setEmpty(missing === null && known.length === 0);
    return missing;
  }, []);

  const load = useCallback(
    async (range: TileRange) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setLoading(true);
      setError(null);

      try {
        const found = await fetchAttractions(boundsOfTiles(range), controller.signal);
        if (controller.signal.aborted) return;

        cache.current.store(range, found);
        if (last.current) show(last.current.bounds);
        log.debug('audioGuide.attractions.loaded', { found: found.length });
      } catch (e) {
        // An abort is the map having moved on, not a failure. Reporting it would put an error
        // toast on the screen every time somebody pans twice quickly.
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          return;
        }
        setError(classify(e));
        log.warn('audioGuide.attractions.failed', describeError(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [show],
  );

  const setBounds = useCallback(
    (bounds: Bounds, zoom: number) => {
      last.current = { bounds, zoom };
      if (timer.current) clearTimeout(timer.current);

      const missing = show(bounds);
      const tooWide = zoom < MIN_ZOOM;
      setZoomedOut(tooWide && missing !== null);

      // Nothing to ask: whatever is in flight is for a place the map has left.
      if (!missing || tooWide) {
        inFlight.current?.abort();
        setLoading(false);
        setError(null);
        return;
      }
      timer.current = setTimeout(() => void load(missing), DEBOUNCE_MS);
    },
    [load, show],
  );

  const retry = useCallback(() => {
    if (last.current) setBounds(last.current.bounds, last.current.zoom);
  }, [setBounds]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  return { attractions, loading, empty, zoomedOut, error, setBounds, retry };
}
