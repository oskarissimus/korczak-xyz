/*
 * Which app a push subscription belongs to.
 *
 * The design this corrects assumed *one origin, one service worker, one endpoint per device*, and
 * therefore that `users/{uid}/pushSubs` was a list of devices both apps could push to. That holds
 * in a desktop browser and is false on the only platform that matters here: iOS gives every
 * home-screen app its own storage container, its own service worker registration and its own push
 * subscription, and it attributes a delivered notification to the app that owns the endpoint. A
 * phone with Event Watch and Metro Watch both installed therefore carries two rows, and a collector
 * fanning out to every row on the account puts a fortnight of opera in the app somebody installed
 * to hear about the metro — under Metro Watch's name and icon, which is what makes it a bug report
 * rather than a curiosity.
 *
 * So a subscription now records which apps armed it, and each collector sends only to the rows that
 * claim it. Two rules keep that from losing notifications:
 *
 *   - **A claim is added, never replaced.** `PushSub.apps` is a map so Firestore's merge writes
 *     each app's claim independently; on a desktop browser one endpoint ends up claimed by both.
 *   - **An unclaimed row belongs to everything.** Every row written before this field existed has
 *     no claim, and reading that as "no app may push here" would silently stop notifications for
 *     every device already registered. It resolves itself: the launch check re-records on the next
 *     open of each app, and until then the reader sees exactly what they see today.
 *
 * Portable — compiled into the Cloud Functions bundle beside the matcher, because the client
 * filters the device list with the same function the collector filters its sends with.
 */

import type { PushApp, PushSub } from './types';

/** Every app that sends push. */
export const PUSH_APPS: readonly PushApp[] = ['events', 'transit'];

/** What one app writes into `PushSub.apps` to claim an endpoint. */
export function claimFor(app: PushApp): Partial<Record<PushApp, boolean>> {
  return { [app]: true };
}

/** The apps a row claims, in a fixed order. Empty for a row that claims none. */
export function claimedApps(sub: Pick<PushSub, 'apps'>): PushApp[] {
  const apps = sub.apps;
  if (!apps || typeof apps !== 'object') return [];
  return PUSH_APPS.filter((app) => apps[app] === true);
}

/**
 * Whether `app` may push to this subscription.
 *
 * A row claiming nothing at all — never stamped, or stamped `{ events: false }` by some future
 * un-arming — answers yes to everything, for the reason in the header: the failure mode of a wrong
 * "no" here is silence nobody can see, and the failure mode of a wrong "yes" is the notification
 * arriving in the app next to the right one.
 */
export function claimsApp(sub: Pick<PushSub, 'apps'>, app: PushApp): boolean {
  const claimed = claimedApps(sub);
  return claimed.length === 0 || claimed.includes(app);
}

/** The rows one app may push to. */
export function subsForApp<T extends Pick<PushSub, 'apps'>>(subs: T[], app: PushApp): T[] {
  return subs.filter((sub) => claimsApp(sub, app));
}
