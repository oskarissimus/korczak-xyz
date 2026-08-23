/*
 * The two entry points.
 *
 * Everything that decides anything lives elsewhere — in the site's `src/utils/events/`, compiled in
 * from there — so this file is schedule, secrets and glue.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  db,
  REGION,
  TICKETMASTER_API_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
} from './runtime';
import { runCollection } from './collect';
import { configureWebPush, sendTo } from './push';
import type { PushSub } from '../../korczak-xyz/src/utils/events/types';

const SECRETS = [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, TICKETMASTER_API_KEY];

function secretReader(): (name: string) => string | undefined {
  return (name) => {
    // `.value()` throws when a secret was never set; an unset Ticketmaster key is a configuration
    // state the collector handles by skipping that source, not an error worth failing the run for.
    try {
      if (name === 'TICKETMASTER_API_KEY') return TICKETMASTER_API_KEY.value() || undefined;
      if (name === 'VAPID_PUBLIC_KEY') return VAPID_PUBLIC_KEY.value() || undefined;
      if (name === 'VAPID_PRIVATE_KEY') return VAPID_PRIVATE_KEY.value() || undefined;
    } catch {
      return undefined;
    }
    return undefined;
  };
}

export const collectEvents = onSchedule(
  {
    // The sources move on a scale of days. Six hours keeps `soon` reminders landing at a sane hour
    // without spending the Ticketmaster quota on nothing.
    schedule: 'every 6 hours',
    timeZone: 'Europe/Warsaw',
    region: REGION,
    secrets: SECRETS,
    memory: '512MiB',
    timeoutSeconds: 540,
    /*
     * No retries. A retry re-runs the whole collection — which the notice `create()` latch makes
     * safe, but which doubles the Ticketmaster quota for nothing. Six hours to the next run is a
     * better answer than an immediate repeat.
     */
    retryCount: 0,
  },
  async () => {
    configureWebPush(VAPID_SUBJECT, VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
    const summary = await runCollection(db, {
      now: Date.now(),
      fetch: globalThis.fetch,
      secret: secretReader(),
    });
    console.log('collectEvents', JSON.stringify(summary));
  },
);

/**
 * The test button on the Alerts tab.
 *
 * Every layer between that button and a banner on the phone is invisible — the two VAPID keys
 * matching, the secrets being set, Apple accepting the JWT, the payload parsing, the worker being
 * the build you think it is. Without this there is no way to tell a working setup from a dead one
 * until something is missed, which by then is weeks later.
 */
export const sendTestPush = onCall(
  { region: REGION, secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = request.auth.uid;
    const subId = String((request.data as { subId?: unknown })?.subId ?? '');
    if (!subId) throw new HttpsError('invalid-argument', 'No device given.');

    const snap = await db.collection('users').doc(uid).collection('pushSubs').doc(subId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'That device is not registered.');

    configureWebPush(VAPID_SUBJECT, VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
    const outcome = await sendTo(db, uid, { ...(snap.data() as PushSub), id: subId }, {
      title: 'Event Watch',
      body: 'Notifications are working.',
      url: '/apps/events/alerts',
      tag: 'test',
      kind: 'test',
    });

    if (!outcome.ok) {
      // The status code is the whole value: "Apple returned 403" is debuggable in a way that
      // "something went wrong" is not.
      throw new HttpsError(
        'internal',
        `Push service returned ${outcome.statusCode ?? '?'}${outcome.pruned ? ' (device removed)' : ''}`,
      );
    }
    return { ok: true, statusCode: outcome.statusCode };
  },
);
