/*
 * The shared event corpus, as this browser sees it.
 *
 * Read-only: `events/` is written by the collector on the Admin SDK and nothing here can touch it.
 * That makes this much simpler than `useEventInterests` — no push queue, no reconciler, no
 * tombstones. The only real decisions are what to do offline and how to spend the pull.
 *
 * The cache is what makes an installed app worth having: Firestore's client cache here is
 * memory-only, so without the localStorage copy an app opened on the underground shows nothing at
 * all, and the whole point of the app's precache tier is that it does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullEvents, pullUndatedEvents } from '../utils/events/browser/cloud';
import { loadFeedCache, saveFeedCache } from '../utils/events/browser/storage';
import type { EventRecord } from '../utils/events/types';
import type { AuthUser } from './useAuth';

export interface EventFeedData {
  ready: boolean;
  events: EventRecord[];
  /** True once a network pull has succeeded this page load; false means these are cached rows. */
  fresh: boolean;
  error: string | null;
  refresh: () => void;
}

export function useEventFeed(user: AuthUser | null): EventFeedData {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // Cached rows first, so something is on screen before the network answers — or instead of it.
  useEffect(() => {
    setEvents(loadFeedCache());
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!user || loadingRef.current) return;
    loadingRef.current = true;
    try {
      /*
       * Two queries, because `where('startsAt', '>=', …)` excludes nulls outright — and the undated
       * rows are exactly the Teatr Wielki repertoire announcements this app exists for. A season
       * announced with no nights scheduled yet would otherwise never appear.
       */
      const [dated, undated] = await Promise.all([pullEvents(Date.now()), pullUndatedEvents()]);
      const merged = [...undated, ...dated];
      setEvents(merged);
      setFresh(true);
      setError(null);
      saveFeedCache(merged);
    } catch (e) {
      // Offline is the ordinary case here, not an exception: the cached rows stay on screen and the
      // UI says they are cached rather than pretending the list is current.
      log.warn('events.feed.pull.failed', describeError(e));
      setError(String(describeError(e).message ?? 'load failed'));
    } finally {
      loadingRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  useEffect(() => {
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  return { ready, events, fresh, error, refresh: () => void refresh() };
}
