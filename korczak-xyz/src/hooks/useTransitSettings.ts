/*
 * The transport app's notification settings, and the moment they are armed.
 *
 * Its own document (`users/{uid}/transitSettings/push`) rather than a few more fields on the events
 * app's, and `armedAt` is why. That field means "nothing already in the corpus when this was
 * switched on may fire", and the two apps are switched on at different moments over different
 * corpora — sharing it would mean turning on metro alerts silently re-arms, or silently suppresses,
 * a fortnight of opera announcements.
 *
 * The *subscription* is shared, and correctly so: one origin, one service worker, one endpoint per
 * device. `useWebPush` owns that, and this hook only watches for the moment it goes `ready`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullTransitSettings, pushTransitSettings } from '../utils/transit/browser/cloud';
import { loadSettings, saveSettings } from '../utils/transit/browser/storage';
import { DEFAULT_TRANSIT_SETTINGS, type TransitSettings } from '../utils/transit/types';
import type { AuthUser } from './useAuth';
import type { PushUiState } from '../utils/events/pushState';

export interface TransitSettingsData {
  settings: TransitSettings;
  ready: boolean;
  update: (patch: Partial<TransitSettings>) => void;
}

export function useTransitSettings(
  user: AuthUser | null,
  pushState: PushUiState,
): TransitSettingsData {
  const [settings, setSettings] = useState<TransitSettings>(DEFAULT_TRANSIT_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef<TransitSettings>(DEFAULT_TRANSIT_SETTINGS);
  const armingRef = useRef(false);

  const publish = useCallback((next: TransitSettings) => {
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next);
  }, []);

  useEffect(() => {
    publish(loadSettings());
    setReady(true);
  }, [publish]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const remote = await pullTransitSettings(uid);
        if (cancelled || !remote) return;
        /*
         * The cloud copy wins on `armedAt` specifically, and by `Math.min` of the two non-null
         * values. Arming is a one-way door: the *earliest* arming any device recorded is the honest
         * one, and taking the later would re-open a window of history that has already been
         * decided about.
         */
        publish({
          ...settingsRef.current,
          ...remote,
          armedAt: earliest(settingsRef.current.armedAt, remote.armedAt),
        });
      } catch (e) {
        log.warn('transit.settings.pull.failed', describeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publish, user]);

  const update = useCallback(
    (patch: Partial<TransitSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      publish(next);
      const uid = user?.uid;
      if (uid) void pushTransitSettings(uid, next).catch((e) => log.warn('transit.settings.push.failed', describeError(e)));
    },
    [publish, user],
  );

  /*
   * Arming, the first time push is actually working.
   *
   * Not on the button press: a press that ends in a denied permission has armed nothing, and a
   * corpus marked armed with no subscription behind it would silently consume the whole backlog the
   * first time a device did subscribe. `ready` is the state that means an endpoint exists.
   */
  useEffect(() => {
    if (!ready || !user || pushState !== 'ready') return;
    if (settingsRef.current.armedAt !== null || armingRef.current) return;
    armingRef.current = true;
    const armed = { ...settingsRef.current, armedAt: Date.now() };
    publish(armed);
    void pushTransitSettings(user.uid, armed)
      .then(() => log.info('transit.push.armed', { armedAt: armed.armedAt }))
      .catch((e) => {
        armingRef.current = false;
        log.warn('transit.push.arm.failed', describeError(e));
      });
  }, [publish, pushState, ready, user]);

  return { settings, ready, update };
}

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}
