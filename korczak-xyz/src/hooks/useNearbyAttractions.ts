/*
 * The pins, kept in step with whatever rectangle the map is showing.
 *
 * Every pan and every zoom is a new question for Overpass, which is a free, shared, rate-limited
 * public endpoint. Three things keep that from being rude, and all three are here rather than in
 * `overpass.ts`, because they are about when to ask rather than how:
 *
 *  - **The debounce.** A drag fires `moveend` once, but a pinch-zoom followed by a nudge fires
 *    three or four in a second. Half a second of quiet before asking turns a fidget into one
 *    request.
 *  - **The abort.** Moving again while a request is in flight abandons it. Overpass takes
 *    seconds to answer a dense box, and without this the answers arrive out of order and the map
 *    settles on the pins for a rectangle nobody is looking at any more.
 *  - **The unmount.** Leaving the page aborts too, so a navigation does not leave a request
 *    running against a component that no longer exists.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { fetchAttractions, MAX_MARKERS, OverpassBusyError } from '../utils/audioGuide/overpass';
import type { Attraction, Bounds } from '../utils/audioGuide/types';

const DEBOUNCE_MS = 500;

export type AttractionsError = 'busy' | 'too-big' | 'failed';

export interface NearbyAttractions {
  attractions: Attraction[];
  loading: boolean;
  /** True when the last answer was empty — a different thing from not having asked yet. */
  empty: boolean;
  error: AttractionsError | null;
  /** Hand it the map's current rectangle; it decides whether and when to ask. */
  setBounds: (bounds: Bounds) => void;
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
  const [error, setError] = useState<AttractionsError | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const lastBounds = useRef<Bounds | null>(null);

  const load = useCallback(async (bounds: Bounds) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);

    try {
      const found = await fetchAttractions(bounds, controller.signal);
      if (controller.signal.aborted) return;

      setAttractions(found.slice(0, MAX_MARKERS));
      setEmpty(found.length === 0);
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
  }, []);

  const setBounds = useCallback(
    (bounds: Bounds) => {
      lastBounds.current = bounds;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(bounds), DEBOUNCE_MS);
    },
    [load],
  );

  const retry = useCallback(() => {
    if (lastBounds.current) void load(lastBounds.current);
  }, [load]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  return { attractions, loading, empty, error, setBounds, retry };
}
