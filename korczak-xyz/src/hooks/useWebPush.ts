/*
 * Arming push notifications, and keeping them armed.
 *
 * The keeping is the hard part, and it is the whole reason this is a hook rather than a button.
 * **iOS never fires `pushsubscriptionchange` and reports no `expirationTime`**, and it drops a
 * subscription after a few weeks of the app not being opened. So there is no event to react to and
 * nothing to inspect: the only defence is to look, on every launch, and re-subscribe if the
 * subscription has quietly gone. That check runs from the Feed island as well as this screen,
 * because the Feed is the tab the icon opens.
 *
 * `register-sw.js` cannot host any of this — it is inlined into <head> as a classic script and can
 * import nothing, least of all Firestore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullPushSubs, pushPushSub, pushSettings, removePushSub } from '../utils/events/browser/cloud';
import {
  loadPushSeenAt,
  loadPushSettings,
  loadPushSubId,
  savePushSeenAt,
  savePushSettings,
  savePushSubId,
} from '../utils/events/browser/storage';
import { pushUiState, type PushUiState } from '../utils/events/pushState';
import { subIdFor, urlBase64ToUint8Array } from '../utils/events/vapid';
import type { PushSub } from '../utils/events/types';
import type { AuthUser } from './useAuth';

/** Published at build time. Absent means push was never configured for this deploy. */
const VAPID_PUBLIC_KEY = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY as string | undefined;

/** The heartbeat is throttled: it exists to prune dead devices, not to be precise. */
const HEARTBEAT_MS = 12 * 60 * 60 * 1000;

export interface WebPushApi {
  state: PushUiState;
  /** Devices registered on the account, this one included. */
  devices: PushSub[];
  error: string | null;
  /** Ask for permission and subscribe. Must be called straight from a click. */
  arm: () => Promise<void>;
  removeDevice: (subId: string) => Promise<void>;
  /** This browser's subscription id, so the UI can mark which row is "this device". */
  currentSubId: string | null;
}

interface Options {
  /** Re-verify and record, but skip the device list — for islands that show no push UI. */
  verifyOnly?: boolean;
  /**
   * Whether arming here also stamps Event Watch's `armedAt`. Default true.
   *
   * The subscription is shared — one origin, one service worker, one endpoint per device — but
   * `armedAt` is not: it means "nothing already in this app's corpus may fire", and the two apps
   * are switched on at different moments over different corpora. Left at the default, pressing
   * *Turn on notifications* on the transport app's Alerts tab would also arm Event Watch, and the
   * next collector run would announce a fortnight of opera to somebody who asked about the metro.
   *
   * The transport app passes `false` and stamps its own, in `useTransitSettings`.
   */
  stampArmedAt?: boolean;
}

const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/**
 * Whether this platform refuses push outside an installed app.
 *
 * iOS and iPadOS only. Detected by the touch-capable Mac-shaped user agent as well as the obvious
 * one, because iPadOS reports itself as a Mac.
 */
function requiresInstall(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = /Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
  return iOS || iPadOS;
}

function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useWebPush(user: AuthUser | null, lang: 'en' | 'pl', options: Options = {}): WebPushApi {
  const stampArmedAt = options.stampArmedAt !== false;
  const [hasSubscription, setHasSubscription] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<PushSub[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentSubId, setCurrentSubId] = useState<string | null>(null);
  const verifyingRef = useRef(false);

  const permission =
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null;

  /** Writes the subscription to the account and remembers which one this browser holds. */
  const record = useCallback(
    async (uid: string, subscription: PushSubscription): Promise<void> => {
      const json = subscription.toJSON();
      const id = await subIdFor(subscription.endpoint);
      const now = Date.now();
      const previous = loadPushSubId();

      const record: PushSub = {
        id,
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        authKey: json.keys?.auth ?? '',
        lang,
        ua: (navigator.userAgent || '').slice(0, 180),
        createdAt: now,
        lastSeenAt: now,
      };

      if (previous !== id) {
        await pushPushSub(uid, record);
        /*
         * Retire the old row rather than leaving it. iOS hands out a fresh endpoint fairly often,
         * and every stale one is an endpoint the collector goes on pushing to until it earns a 410
         * — which for an endpoint that is merely unused may never come.
         */
        if (previous) {
          try {
            await removePushSub(uid, previous);
          } catch (e) {
            log.warn('events.push.retire.failed', describeError(e));
          }
        }
        savePushSubId(id);
        savePushSeenAt(now);
      } else if (now - loadPushSeenAt() > HEARTBEAT_MS) {
        // The heartbeat is what lets a device that is simply gone be pruned without waiting for a
        // 410 that may never arrive.
        await pushPushSub(uid, { ...record, lastSeenAt: now });
        savePushSeenAt(now);
      }

      setCurrentSubId(id);
      setSavedAt(now);
      setHasSubscription(true);
    },
    [lang],
  );

  /**
   * The launch check.
   *
   * Runs whenever this hook mounts with a signed-in user. Step 3 is the one that matters: with
   * permission already granted, re-subscribing needs no user gesture, so a subscription iOS
   * dropped can be replaced silently before anybody notices it was gone.
   */
  const verify = useCallback(async () => {
    if (!user || !supported() || verifyingRef.current) return;
    if (Notification.permission !== 'granted') return;
    if (!VAPID_PUBLIC_KEY) {
      setError('push not configured');
      return;
    }
    verifyingRef.current = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        // Worth a line: this is the silent failure the whole hook exists for, and the only
        // evidence it happens at all.
        log.info('events.push.resubscribed', {});
      }
      await record(user.uid, subscription);
      setError(null);
    } catch (e) {
      log.warn('events.push.verify.failed', describeError(e));
      setError(String(describeError(e).message ?? 'push check failed'));
    } finally {
      verifyingRef.current = false;
    }
  }, [user, record]);

  useEffect(() => {
    if (!user) {
      setHasSubscription(false);
      setSavedAt(null);
      setCurrentSubId(null);
      return;
    }
    setCurrentSubId(loadPushSubId());
    void verify();
  }, [user, verify]);

  // The device list is only wanted where there is UI for it.
  useEffect(() => {
    if (!user || options.verifyOnly) return;
    void (async () => {
      try {
        setDevices(await pullPushSubs(user.uid));
      } catch (e) {
        log.warn('events.push.devices.failed', describeError(e));
      }
    })();
  }, [user, options.verifyOnly, savedAt]);

  const arm = useCallback(async () => {
    if (!user || !supported()) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * FIRST statement, before any await.
       *
       * `Notification.requestPermission()` has to be called synchronously from the click for iOS to
       * treat it as user-initiated. Put `await navigator.serviceWorker.ready` ahead of it and the
       * gesture chain is broken: the prompt never appears, and nothing anywhere reports why.
       */
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') {
        setBusy(false);
        return;
      }
      if (!VAPID_PUBLIC_KEY) {
        setError('push not configured');
        setBusy(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      await record(user.uid, subscription);

      /*
       * Arming is what sets `armedAt`, and `armedAt` is the first line of defence against the
       * first-run flood: nothing already in the corpus at this moment can ever be "announced".
       * Written once and never moved, so re-arming a second device does not replay the backlog.
       */
      const settings = loadPushSettings();
      if (stampArmedAt && settings.armedAt === null) {
        const armed = { ...settings, armedAt: Date.now() };
        savePushSettings(armed);
        await pushSettings(user.uid, armed);
        log.info('events.push.armed', { armedAt: armed.armedAt });
      }
    } catch (e) {
      log.warn('events.push.arm.failed', describeError(e));
      setError(String(describeError(e).message ?? 'could not turn on notifications'));
    } finally {
      setBusy(false);
    }
  }, [record, stampArmedAt, user]);

  const removeDevice = useCallback(
    async (subId: string) => {
      if (!user) return;
      await removePushSub(user.uid, subId);
      setDevices((list) => list.filter((d) => d.id !== subId));
      if (subId === loadPushSubId()) {
        savePushSubId(null);
        setCurrentSubId(null);
        setHasSubscription(false);
        setSavedAt(null);
      }
    },
    [user],
  );

  const state = pushUiState({
    supported: supported(),
    installed: isInstalled(),
    requiresInstall: requiresInstall(),
    permission,
    hasSubscription,
    savedAt,
    busy,
  });

  return { state, devices, error, arm, removeDevice, currentSubId };
}
