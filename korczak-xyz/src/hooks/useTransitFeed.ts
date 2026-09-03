/*
 * The shared communiqué corpus, as this browser sees it.
 *
 * Read-only: `transitItems` is written by the collector on the Admin SDK and nothing here can touch
 * it. So this is the simple half — no push queue, no reconciler, no tombstones.
 *
 * The cache matters more here than it does for the events app, and for a reason specific to the
 * subject: **the place you most want to know whether the metro is broken is underground.**
 * Firestore's web client keeps no disk cache, so without the localStorage copy an installed app
 * opened on a platform shows nothing at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullFeedHealth, pullItems } from '../utils/transit/browser/cloud';
import { loadFeedCache, saveFeedCache } from '../utils/transit/browser/storage';
import type { FeedFetch, TransitItem } from '../utils/transit/types';
import type { AuthUser } from './useAuth';

export interface TransitFeedData {
  ready: boolean;
  items: TransitItem[];
  /** The two feeds' last fetch. Empty until a pull succeeds; drawn on the Alerts and Raw tabs. */
  health: FeedFetch[];
  /** True once a network pull has succeeded this page load; false means these are cached rows. */
  fresh: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTransitFeed(user: AuthUser | null): TransitFeedData {
  const [items, setItems] = useState<TransitItem[]>([]);
  const [health, setHealth] = useState<FeedFetch[]>([]);
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // Cached rows first, so something is on screen before the network answers — or instead of it.
  useEffect(() => {
    setItems(loadFeedCache());
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!user || loadingRef.current) return;
    loadingRef.current = true;
    try {
      /*
       * `allSettled`, not `all`. The health rows are a diagnostic and the corpus is the app; one of
       * them failing is not a reason to show neither — and the health rows are exactly what a
       * reader is looking for on the day something is failing.
       */
      const [corpus, feeds] = await Promise.allSettled([pullItems(Date.now()), pullFeedHealth()]);

      if (corpus.status === 'rejected') throw corpus.reason;
      setItems(corpus.value);
      saveFeedCache(corpus.value);
      setFresh(true);
      setError(null);

      if (feeds.status === 'fulfilled') setHealth(feeds.value);
      else log.warn('transit.health.pull.failed', describeError(feeds.reason));
    } catch (e) {
      log.warn('transit.feed.pull.failed', describeError(e));
      setError(String(describeError(e).message ?? 'could not load notices'));
    } finally {
      loadingRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ready, items, health, fresh, error, refresh };
}
