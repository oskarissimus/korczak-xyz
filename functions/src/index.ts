/*
 * The two entry points.
 *
 * Everything that decides anything lives elsewhere — in the site's `src/utils/events/`, compiled in
 * from there — so this file is schedule, secrets and glue.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  db,
  PROJECT_ID,
  REGION,
  TICKETMASTER_API_KEY,
  VERTEX_LOCATION,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
} from './runtime';
import { runCollection } from './collect';
import { runTransitCollection } from './transit/collect';
import { configureWebPush, sendTo } from './push';
import { handleAssembleVideo } from './sloper/handler';
import { flushSentry, initSentry, reportError, withSentry } from './sentry';
import type { PushSub } from '../../korczak-xyz/src/utils/events/types';

// At module load, so it is running before any handler body does — including the cold-start path,
// which is where the configuration failures worth catching actually happen.
initSentry();

const SECRETS = [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, TICKETMASTER_API_KEY];

/**
 * The sentinel for "this source is deliberately not configured".
 *
 * Secret Manager rejects an empty payload outright (`400 Secret Payload cannot be empty`), and a
 * secret declared in a function's `secrets` array has to exist for the deploy to succeed. So a
 * source we have no key for yet needs *some* value, and it must not be one that reaches the API —
 * a placeholder sent as a real `apikey` earns a 401, which the adapter reports as a broken source
 * and puts a red row on the alerts tab that no amount of fixing the code would clear.
 *
 * Read here rather than in the adapter because this function is already the seam that turns a
 * secret into "undefined if unset"; the adapter's job is to know what to do about that, not to
 * know how the absence is spelt.
 */
const UNSET = 'none';

function secretReader(): (name: string) => string | undefined {
  const read = (param: { value: () => string }): string | undefined => {
    // `.value()` throws when a secret was never set at all.
    try {
      const value = param.value().trim();
      return value && value !== UNSET ? value : undefined;
    } catch {
      return undefined;
    }
  };

  return (name) => {
    if (name === 'TICKETMASTER_API_KEY') return read(TICKETMASTER_API_KEY);
    if (name === 'VAPID_PUBLIC_KEY') return read(VAPID_PUBLIC_KEY);
    if (name === 'VAPID_PRIVATE_KEY') return read(VAPID_PRIVATE_KEY);
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
  async () =>
    withSentry('collectEvents', async () => {
      configureWebPush(VAPID_SUBJECT, VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
      const summary = await runCollection(db, {
        now: Date.now(),
        fetch: globalThis.fetch,
        secret: secretReader(),
        project: PROJECT_ID,
        location: VERTEX_LOCATION,
      });
      console.log('collectEvents', JSON.stringify(summary));
    }),
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
    /*
     * Not wrapped in `withSentry`, because most of what this throws is not a failure.
     * `unauthenticated`, `invalid-argument` and `not-found` are this function answering the
     * caller correctly — reporting them would fill the project with events describing a button
     * pressed while signed out. Only the two genuine failures below are reported: the push
     * service rejecting a send, and anything unexpected.
     */
    try {
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
        /*
         * This one is worth an event. The whole point of the test button is to prove the chain
         * from VAPID keys to Apple's servers is intact, so a failure here is the answer somebody
         * pressed it to get — and the status code is what makes it actionable.
         */
        reportError('sendTestPush', new Error(`push service returned ${outcome.statusCode ?? '?'}`), {
          statusCode: outcome.statusCode ?? null,
          pruned: outcome.pruned ?? false,
        });
        await flushSentry();
        // The status code is the whole value: "Apple returned 403" is debuggable in a way that
        // "something went wrong" is not.
        throw new HttpsError(
          'internal',
          `Push service returned ${outcome.statusCode ?? '?'}${outcome.pruned ? ' (device removed)' : ''}`,
        );
      }
      await flushSentry();
      return { ok: true, statusCode: outcome.statusCode };
    } catch (error) {
      // An HttpsError has already been decided about above; anything else got here by surprise
      // (a Firestore outage, a secret that will not read) and is exactly what this is for.
      if (!(error instanceof HttpsError)) {
        reportError('sendTestPush', error);
        await flushSentry();
      }
      throw error;
    }
  },
);

/**
 * The Warsaw metro watcher.
 *
 * A second scheduled function rather than more work inside `collectEvents`, and the schedule is
 * why: an opera season moves on a scale of days and is read every six hours, where "is the metro
 * broken right now" is worth nothing if the answer is five hours old. WTP's own community bot
 * settled on five minutes for the impediment feed; ten is the compromise here, because every run
 * costs two HTTP requests and a Firestore read of the corpus, and the difference between five and
 * ten minutes of warning is smaller than it looks when the alternative is finding out on the
 * platform.
 *
 * Both feeds are read every run. The planned-changes feed does not need ten-minute freshness — it
 * is announced days ahead — but reading it costs one more request against a feed that returns the
 * same twenty items, and a second schedule would be a second thing to reason about for nothing.
 *
 * `retryCount: 0`, like the events collector: the claim latch makes a retry safe, but the next run
 * is ten minutes away, which is a better answer than an immediate repeat.
 */
export const collectTransit = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'Europe/Warsaw',
    region: REGION,
    secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY],
    memory: '512MiB',
    timeoutSeconds: 300,
    retryCount: 0,
  },
  async () =>
    withSentry('collectTransit', async () => {
      configureWebPush(VAPID_SUBJECT, VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
      const summary = await runTransitCollection(db, {
        now: Date.now(),
        fetch: globalThis.fetch,
        project: PROJECT_ID,
        location: VERTEX_LOCATION,
      });
      console.log('collectTransit', JSON.stringify(summary));
    }),
);

/**
 * The slop video assembler.
 *
 * `/apps/sloper/` does everything else itself — the script, the images, the narration all come
 * straight from the browser to OpenAI, Google and ElevenLabs. This is the one step a page cannot
 * do: FFmpeg, turning N stills and N narrations into an MP4.
 *
 * `onRequest` rather than `onCall`, and 2 GiB rather than 512 MiB, for reasons that are in
 * sloper/handler.ts and sloper/ffmpeg.ts respectively. The timeout is nine minutes because a
 * dozen 1024x1536 scenes is a few minutes of libx264 on a shared core and a request that dies at
 * five has thrown away every API call that paid for it.
 *
 * It holds no secrets: the caller's Firebase ID token is the only credential involved, and it is
 * verified inside the handler. The public invoker binding it needs is in terraform/functions.tf,
 * beside `sendTestPush`'s and for the same reason.
 */
export const assembleVideo = onRequest(
  {
    region: REGION,
    memory: '2GiB',
    timeoutSeconds: 540,
    // One request per instance: ffmpeg will take every core it is given, so a second concurrent
    // assembly on the same instance makes both slower and doubles peak memory and /tmp.
    concurrency: 1,
    // Bounded so an idle evening costs nothing and a burst cannot quietly scale into a bill.
    maxInstances: 3,
    // CORS is answered by the handler, which has the allowlist. Letting the platform do it too
    // would mean two places deciding, and the platform's cannot vary the header by origin.
    cors: false,
  },
  handleAssembleVideo,
);
