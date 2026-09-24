/*
 * The Sources tab's switches, and their cloud sync.
 *
 * The only writing hook this app has left, and deliberately not built like the two it outlived
 * (`useEventInterests`, `useEventIgnores`) or like `useTransitSegments` next door: those reconcile
 * a *collection* of mutable records, so they need derived ids, tombstones and a per-record
 * revision. This is one document holding five booleans. There is nothing to
 * delete — a source switched back on is a switch that says so, not a row that is gone — so the
 * whole reconciler collapses into `mergeSourcePrefs`, which settles each switch by whichever
 * device flipped it later.
 *
 * What it keeps from them is the one rule that matters: **pull before push**. The phone and the
 * laptop write the same document, so a blind `setDoc` from one of them lands on top of the other's
 * switch — and the failure is silent and long-lived, a source the reader turned off weeks ago
 * quietly back on.
 *
 * It also keeps the local-first shape. The boxes have to be drawn on the first paint and the feed
 * has to know what is off before it builds, so localStorage is the source of truth for rendering
 * and the cloud is what makes the phone and the laptop agree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { adoptOwner, loadSourcePrefs, saveSourcePrefs } from '../utils/events/browser/storage';
import { pullSourcePrefs, pushSourcePrefs } from '../utils/events/browser/cloud';
import {
  disabledSourceIds,
  mergeSourcePrefs,
  setSourceCity,
  setSourceCountry,
  setSourceEnabled,
  sourceCity,
  sourceCountry,
  sourceEnabled,
  type SourcePrefs,
} from '../utils/events/sourcePrefs';
import type { SourceId } from '../utils/events/types';
import type { AuthUser } from './useAuth';

export interface EventSourcePrefsData {
  ready: boolean;
  prefs: SourcePrefs;
  /** The ids currently switched off, sorted. What the feed's empty state counts. */
  disabled: string[];
  enabled: (id: string) => boolean;
  setEnabled: (id: SourceId, enabled: boolean) => void;
  /** The town a source is narrowed to, if any. */
  city: (id: string) => string | undefined;
  /** Narrow a source to one town, or `undefined` for all of them. */
  setCity: (id: SourceId, city: string | undefined) => void;
  /** The country a source is narrowed to, if any. */
  country: (id: string) => string | undefined;
  /** Narrow a source to one country, or `undefined` for all of them. */
  setCountry: (id: SourceId, country: string | undefined) => void;
  /** The last sync failure, or null. Shown on the tab — a switch that did not save must say so. */
  error: string | null;
}

export function useEventSourcePrefs(user: AuthUser | null): EventSourcePrefsData {
  const [prefs, setPrefs] = useState<SourcePrefs>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefsRef = useRef<SourcePrefs>({});
  const syncingRef = useRef(false);
  const uidRef = useRef<string | null>(null);

  const publish = useCallback((next: SourcePrefs) => {
    prefsRef.current = next;
    setPrefs(next);
  }, []);

  useEffect(() => {
    publish(loadSourcePrefs());
    setReady(true);
  }, [publish]);

  /**
   * Pull, merge, then push whatever this device still holds that the cloud does not.
   *
   * Single-flight: two taps in a second would otherwise race, and the loser would push a map
   * built before the winner's merge — putting a switch back exactly the way the reader had just
   * moved it away from.
   */
  const sync = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const remote = await pullSourcePrefs(uid);
      const merged = mergeSourcePrefs(remote, prefsRef.current);
      publish(merged);
      saveSourcePrefs(merged);
      await pushSourcePrefs(uid, merged);
      setError(null);
    } catch (e) {
      /*
       * Never swallowed. The local copy is already applied, so the feed and the boxes are right on
       * this device and wrong on the other one — which is the state most worth saying out loud,
       * because nothing on the screen would otherwise distinguish it from having worked.
       */
      log.warn('events.sourcePrefs.sync.failed', describeError(e));
      setError(String(describeError(e).message ?? 'sync failed'));
    } finally {
      syncingRef.current = false;
    }
  }, [publish]);

  const setEnabled = useCallback(
    (id: SourceId, enabled: boolean) => {
      // Applied and stored before any await, so a switch survives the tab being closed the instant
      // after it — the rule every write in this app follows.
      const next = setSourceEnabled(prefsRef.current, id, enabled, Date.now());
      publish(next);
      saveSourcePrefs(next);
      void sync();
    },
    [publish, sync],
  );

  const setCity = useCallback(
    (id: SourceId, city: string | undefined) => {
      // Same order as a flip: applied and stored locally before the sync awaits anything.
      const next = setSourceCity(prefsRef.current, id, city, Date.now());
      publish(next);
      saveSourcePrefs(next);
      void sync();
    },
    [publish, sync],
  );

  const setCountry = useCallback(
    (id: SourceId, country: string | undefined) => {
      const next = setSourceCountry(prefsRef.current, id, country, Date.now());
      publish(next);
      saveSourcePrefs(next);
      void sync();
    },
    [publish, sync],
  );

  useEffect(() => {
    if (!user) {
      uidRef.current = null;
      return;
    }
    // Clears every per-account cache on a switch, so it may have emptied the store out from under
    // the state we are holding.
    if (adoptOwner(user.uid)) {
      log.info('events.cache.reset', { uid: user.uid });
      publish(loadSourcePrefs());
    }
    uidRef.current = user.uid;
    void sync();
  }, [user, ready, sync, publish]);

  useEffect(() => {
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [sync]);

  const disabled = useMemo(() => disabledSourceIds(prefs), [prefs]);
  const enabled = useCallback((id: string) => sourceEnabled(prefs, id), [prefs]);

  const city = useCallback((id: string) => sourceCity(prefs, id), [prefs]);
  const country = useCallback((id: string) => sourceCountry(prefs, id), [prefs]);

  return {
    ready,
    prefs,
    disabled,
    enabled,
    setEnabled,
    city,
    setCity,
    country,
    setCountry,
    error,
  };
}
