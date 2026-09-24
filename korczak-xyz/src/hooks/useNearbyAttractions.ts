/*
 * The pins, kept in step with whatever rectangle the map is showing.
 *
 * Every pan and every zoom is a question, but most of them are answered from `AttractionCache`
 * (see `utils/audioGuide/tiles.ts`) at once and without a request: zooming in, and panning back
 * over ground already covered, draw their pins on the same frame. Only the squares not yet seen
 * are fetched, and from one of two places:
 *
 *  - **The weekly archive** (`utils/audioGuide/pins.ts`), first. The whole world's pins, built
 *    ahead of time and read a zoom-13 tile at a time with a range request. Each tile answers
 *    sixteen of the cache's squares, and each is filed the moment it arrives, so a screen that
 *    needs four tiles fills in four steps rather than waiting for the slowest.
 *  - **Overpass**, when there is no archive to read - none built yet, the bucket unreachable, a
 *    tile that failed. It is a free, shared, rate-limited public endpoint and it takes seconds,
 *    which is why it is the fallback now and not the source.
 *
 * Four things keep either from being wasted, and all of them are here rather than in the modules
 * that fetch, because they are about when to ask rather than how:
 *
 *  - **The debounce.** A drag fires `moveend` once, but a pinch-zoom followed by a nudge fires
 *    three or four in a second. A quarter of a second of quiet before asking turns a fidget into
 *    one request. It was half a second, which was mostly dead time: the abort below already
 *    discards whatever a fidget does get sent. The cache is read without waiting for it.
 *  - **The zoom floor.** Below `MIN_ZOOM` nothing is asked for. A whole city is more pins than
 *    the map may draw, and for Overpass too big a box; what is cached still shows, with a line
 *    saying to zoom in for more.
 *  - **The abort.** Moving again while a request is in flight abandons it. Without this the
 *    answers arrive out of order and the map settles on the pins for a rectangle nobody is
 *    looking at any more.
 *  - **The unmount.** Leaving the page aborts too, so a navigation does not leave a request
 *    running against a component that no longer exists.
 *
 * EVERY REQUEST IS MEASURED. Each one that goes out - answered, refused, or abandoned because the
 * map moved - ends in one `audioGuide.pins.load` measurement in Sentry (`recordMeasurement`):
 * how long from the map stopping to the pins being drawn, how much of that was the debounce, the
 * Overpass queue and the download, how many squares were asked for and how many the cache already
 * had. "The pins are slow" is a question about which of those it is, and each has a different fix.
 * `source` says which of the two answered: `archive`, or `overpass` with `archive` saying why the
 * archive did not (`none` - no pointer - or `failed`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { recordMeasurement } from '../lib/sentry';
import {
  fetchAttractions,
  MAX_MARKERS,
  OverpassBusyError,
  type OverpassTrace,
} from '../utils/audioGuide/overpass';
import {
  AttractionCache,
  boundsOfTiles,
  nearestToCentre,
  tilesCovering,
  tilesIn,
  type TileRange,
} from '../utils/audioGuide/tiles';
import { dataTilesFor, forgetPins, openPins, readPinsTile, squaresOf } from '../utils/audioGuide/pins';
import { networkType } from '../utils/audioGuide/telemetry';
import type { Attraction, Bounds } from '../utils/audioGuide/types';

const DEBOUNCE_MS = 250;

/**
 * The widest the map may be before it stops asking. At 13 a phone's screen is a few kilometres
 * across - an old town and its surroundings - which is two to six archive tiles, and a box the
 * public Overpass instance answers comfortably when it has to.
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

const rangeSize = (r: TileRange) => (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);

/** How the archive did with a range: whether it answered it all, and if not, why not. */
type ArchiveResult =
  | { ok: true; found: number; tiles: number }
  | { ok: false; reason: 'none' | 'failed' | 'aborted' };

/** What a load needs to know about the viewport that asked for it, for its measurement. */
interface Ask {
  /** `performance.now()` of the move that asked - the moment the reader started waiting. */
  at: number;
  zoom: number;
  tilesInView: number;
  /** Squares in view that were not in the cache (the request may cover more: it is a rectangle). */
  tilesMissing: number;
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
  // For the measurements: when the app mounted, how many loads have gone out, and how many
  // viewports the cache answered on its own since the last one.
  const mountedAt = useRef(performance.now());
  const loads = useRef(0);
  const cachedViews = useRef(0);

  /** Draw what the cache holds for a viewport, and say what it does not. */
  const show = useCallback((bounds: Bounds): { missing: TileRange | null; missingCount: number; shown: number } => {
    const { attractions: known, missing, missingCount } = cache.current.lookup(bounds);
    const drawn = nearestToCentre(known, bounds, MAX_MARKERS);
    setAttractions(drawn);
    setEmpty(missing === null && known.length === 0);
    return { missing, missingCount, shown: drawn.length };
  }, []);

  /**
   * The archive's answer for a range, filed tile by tile as each arrives. `ok` when every tile was
   * read; otherwise Overpass is asked instead - for the whole range, since a partial answer from
   * here is overwritten by a whole one.
   */
  const fromArchive = useCallback(
    async (range: TileRange, signal: AbortSignal): Promise<ArchiveResult> => {
      const archive = await openPins();
      if (signal.aborted) return { ok: false, reason: 'aborted' };
      if (!archive) return { ok: false, reason: 'none' };
      let found = 0;
      const tiles = [...tilesIn(dataTilesFor(range))];
      try {
        await Promise.all(
          tiles.map(async ([x, y]) => {
            const places = await readPinsTile(archive, x, y, signal);
            if (signal.aborted) return;
            found += places.length;
            cache.current.store(squaresOf(x, y), places);
            if (last.current) show(last.current.bounds);
          }),
        );
        return signal.aborted ? { ok: false, reason: 'aborted' } : { ok: true, found, tiles: tiles.length };
      } catch (e) {
        if (signal.aborted) return { ok: false, reason: 'aborted' };
        forgetPins();
        log.warn('audioGuide.pins.failed', describeError(e));
        return { ok: false, reason: 'failed' };
      }
    },
    [show],
  );

  const load = useCallback(
    async (range: TileRange, ask: Ask) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setLoading(true);
      setError(null);

      const started = performance.now();
      const trace: OverpassTrace = { attempts: [] };
      const nth = ++loads.current;
      const measure = (outcome: string, extra: Record<string, number | string> = {}) => {
        const now = performance.now();
        const lastAttempt = trace.attempts.at(-1);
        recordMeasurement('audioGuide.pins.load', {
          outcome,
          totalMs: Math.round(now - ask.at),
          debounceMs: Math.round(started - ask.at),
          requestMs: Math.round(now - started),
          waitMs: lastAttempt?.waitMs,
          downloadMs: lastAttempt?.downloadMs,
          backoffMs: trace.attempts.reduce((sum, a) => sum + a.backoffMs, 0),
          attempts: trace.attempts.length,
          statuses: trace.attempts.map((a) => a.status).join(','),
          bytes: lastAttempt?.bytes,
          elements: lastAttempt?.elements,
          zoom: Math.round(ask.zoom),
          tilesInView: ask.tilesInView,
          tilesMissing: ask.tilesMissing,
          tilesRequested: rangeSize(range),
          cachedViews: cachedViews.current,
          nth,
          sinceMountMs: Math.round(now - mountedAt.current),
          network: networkType(),
          ...extra,
        });
        cachedViews.current = 0;
      };

      try {
        const pins = await fromArchive(range, controller.signal);
        if (controller.signal.aborted) {
          measure('aborted', { source: 'archive' });
          return;
        }
        if (pins.ok) {
          const shown = last.current ? show(last.current.bounds).shown : 0;
          measure('ok', { source: 'archive', found: pins.found, tilesRead: pins.tiles, shown });
          log.debug('audioGuide.attractions.loaded', { found: pins.found, source: 'archive' });
          return;
        }

        const found = await fetchAttractions(
          boundsOfTiles(range),
          controller.signal,
          undefined,
          trace,
        );
        if (controller.signal.aborted) {
          measure('aborted', { source: 'overpass', archive: pins.reason });
          return;
        }

        cache.current.store(range, found);
        const shown = last.current ? show(last.current.bounds).shown : 0;
        measure('ok', { source: 'overpass', archive: pins.reason, found: found.length, shown });
        log.debug('audioGuide.attractions.loaded', { found: found.length, source: 'overpass' });
      } catch (e) {
        // An abort is the map having moved on, not a failure. Reporting it would put an error
        // toast on the screen every time somebody pans twice quickly.
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          measure('aborted');
          return;
        }
        const kind = classify(e);
        measure(kind, { source: 'overpass' });
        setError(kind);
        log.warn('audioGuide.attractions.failed', describeError(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [fromArchive, show],
  );

  const setBounds = useCallback(
    (bounds: Bounds, zoom: number) => {
      last.current = { bounds, zoom };
      if (timer.current) clearTimeout(timer.current);

      const at = performance.now();
      const { missing, missingCount } = show(bounds);
      if (!missing) cachedViews.current++;
      const tooWide = zoom < MIN_ZOOM;
      setZoomedOut(tooWide && missing !== null);

      // Nothing to ask: whatever is in flight is for a place the map has left.
      if (!missing || tooWide) {
        inFlight.current?.abort();
        setLoading(false);
        setError(null);
        return;
      }
      const ask: Ask = {
        at,
        zoom,
        tilesInView: rangeSize(tilesCovering(bounds)),
        tilesMissing: missingCount,
      };
      timer.current = setTimeout(() => void load(missing, ask), DEBOUNCE_MS);
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
