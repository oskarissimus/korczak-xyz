/*
 * The whole shared corpus, for the pipeline tab.
 *
 * A second hook rather than an option on `useEventFeed`, and the two differences are the reason:
 *
 *   - **It pulls everything**, past rows included, where the feed asks two questions that both mean
 *     "what is still to come". A scrape whose dates have started landing in the past is exactly
 *     what this tab is for, and it is invisible from either of the feed's queries.
 *   - **It does not touch the offline cache.** `events-feed` holds the top 200 rows of the *feed*,
 *     and an installed app opened on the underground draws its list from them. Writing a different
 *     sample over it from a debugging screen would swap that list for whatever happened to be
 *     collected last, which is a worse app for the sake of a tab nobody opens twice a week.
 *
 * The cost of not caching is that this tab needs the network, and it says so rather than drawing an
 * empty list: an inspection tool that quietly shows stale rows is one that will be believed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullAllEvents } from '../utils/events/browser/cloud';
import type { EventRecord } from '../utils/events/types';
import type { AuthUser } from './useAuth';

export interface EventCorpusData {
  /** True once a pull has settled, either way. Nothing is drawn from cache before it. */
  ready: boolean;
  events: EventRecord[];
  error: string | null;
  refresh: () => void;
}

export function useEventCorpus(user: AuthUser | null): EventCorpusData {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!user || loadingRef.current) return;
    loadingRef.current = true;
    try {
      setEvents(await pullAllEvents());
      setError(null);
    } catch (e) {
      // Never swallowed, and never left looking like an empty corpus: on this tab those two are
      // the same picture and only one of them is a reason to go and look at the collector.
      log.warn('events.corpus.pull.failed', describeError(e));
      setError(String(describeError(e).message ?? 'load failed'));
    } finally {
      loadingRef.current = false;
      setReady(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  return { ready, events, error, refresh: () => void refresh() };
}
