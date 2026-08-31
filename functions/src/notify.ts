/*
 * Deciding what to send, claiming it, and sending it.
 *
 * The decision itself is not here — it is `planRun` in the site's `notices.ts`, compiled into this
 * bundle so the feed and the collector cannot come to disagree. What is here is the I/O around it,
 * and one ordering rule that matters more than anything else in this file.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type {
  EventRecord,
  Ignore,
  Interest,
  Notice,
  PushSettings,
  PushSub,
} from '../../korczak-xyz/src/utils/events/types';
import { DEFAULT_PUSH_SETTINGS } from '../../korczak-xyz/src/utils/events/types';
import { ignoredFingerprints } from '../../korczak-xyz/src/utils/events/ignores';
import { planRun, type PendingNotice } from '../../korczak-xyz/src/utils/events/notices';
import { noticeIdFor } from '../../korczak-xyz/src/utils/events/normalize';
import { sendToAll, type PushPayload } from './push';
import { stripUndefined } from './upsert';

export interface NotifyResult {
  uid: string;
  claimed: number;
  delivered: number;
  suppressed: number;
  pruned: number;
}

/** Reads everything one account's decision needs. */
async function loadAccount(
  db: Firestore,
  uid: string,
): Promise<{
  interests: Interest[];
  settings: PushSettings;
  subs: PushSub[];
  seen: Set<string>;
  ignored: ReadonlySet<string>;
}> {
  const user = db.collection('users').doc(uid);
  const [interestsSnap, settingsSnap, subsSnap, noticesSnap, ignoresSnap] = await Promise.all([
    user.collection('eventInterests').get(),
    user.collection('eventSettings').doc('push').get(),
    user.collection('pushSubs').get(),
    /*
     * Every notice id already claimed. Read whole rather than queried per event: this is the set
     * `planRun` needs in memory anyway, and a few thousand ids is far cheaper than one lookup per
     * candidate. It is the only thing standing between a re-run and a repeat notification.
     */
    user.collection('eventNotices').select().get(),
    /*
     * The events dismissed by hand in the feed.
     *
     * Read here, not skipped as a client-side nicety: an ignore the collector never sees is a card
     * that is gone from the screen and still rings the phone at 7am, which is the reading of
     * "ignore" nobody means. Whole rather than filtered on `deleted` in the query — a `where` on a
     * field an un-ignored row may not carry excludes exactly the tombstones that decide the answer,
     * and `ignoredFingerprints` is the one place that flag is read.
     */
    user.collection('eventIgnores').get(),
  ]);

  return {
    interests: interestsSnap.docs.map((d) => ({ ...(d.data() as Interest), id: d.id })),
    settings: settingsSnap.exists
      ? { ...DEFAULT_PUSH_SETTINGS, ...(settingsSnap.data() as PushSettings) }
      : DEFAULT_PUSH_SETTINGS,
    subs: subsSnap.docs.map((d) => ({ ...(d.data() as PushSub), id: d.id })),
    seen: new Set(noticesSnap.docs.map((d) => d.id)),
    ignored: ignoredFingerprints(
      ignoresSnap.docs.map((d) => ({ ...(d.data() as Ignore), id: d.id })),
    ),
  };
}

export function payloadFor(notice: PendingNotice): PushPayload {
  const prefix =
    notice.kind === 'onsale' ? 'Tickets: ' : notice.kind === 'soon' ? 'Coming up: ' : '';
  return {
    title: `${prefix}${notice.title}`.slice(0, 110),
    body: bodyFor(notice),
    url: '/apps/events',
    tag: notice.noticeId,
    kind: notice.kind,
  };
}

function bodyFor(notice: PendingNotice): string {
  if (notice.startsAt === null) return 'Announced — no dates yet.';
  const when = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(notice.startsAt));
  return notice.kind === 'onsale' ? `On sale now · ${when}` : when;
}

/**
 * One account's notifications for one collector run.
 *
 * **The notice document is a lock taken BEFORE sending, not a receipt written after.**
 *
 * `create()` fails on an existing document, which is the atomic latch. Written after the send, a
 * crash between sending and writing repeats the push on the next run — the worst thing this app can
 * do. Written before, a crash loses one notification, which is invisible and recoverable: `soon`
 * will still fire, and the event is in the feed regardless. Lose one rather than send two.
 */
export async function notifyAccount(
  db: Firestore,
  uid: string,
  events: EventRecord[],
  now: number,
): Promise<NotifyResult> {
  const { interests, settings, subs, seen, ignored } = await loadAccount(db, uid);

  const plan = planRun(events, interests, seen, {
    now,
    armedAt: settings.armedAt,
    maxPerRun: settings.maxPerRun,
    maxOnSalePerRun: settings.maxOnSalePerRun,
    ignored,
  });

  let claimed = 0;
  let delivered = 0;
  let pruned = 0;
  const notices = db.collection('users').doc(uid).collection('eventNotices');

  const claim = async (notice: PendingNotice, send: boolean): Promise<void> => {
    const record: Notice = {
      id: notice.noticeId,
      kind: notice.kind,
      fingerprint: notice.fingerprint,
      eventId: notice.eventId,
      interestIds: notice.interestIds,
      claimedAt: now,
      sentAt: null,
      title: notice.title,
      startsAt: notice.startsAt,
      url: notice.url,
    };
    try {
      await notices.doc(notice.noticeId).create(stripUndefined(record));
    } catch {
      // ALREADY_EXISTS: a previous or concurrent run owns this one. Nothing to do, and nothing
      // wrong — this is the latch working.
      return;
    }
    claimed += 1;

    if (!send || subs.length === 0) return;
    const outcome = await sendToAll(db, uid, subs, payloadFor(notice));
    delivered += outcome.delivered;
    pruned += outcome.pruned;
    await notices.doc(notice.noticeId).set(
      outcome.delivered > 0
        ? { sentAt: Date.now() }
        : { failed: (outcome.lastError ?? 'no devices').slice(0, 300) },
      { merge: true },
    );
  };

  for (const notice of plan.send) await claim(notice, true);

  /*
   * Suppressed notices are claimed too, and deliberately never sent individually — leaving them
   * unclaimed would only postpone the flood to the next run.
   */
  for (const notice of plan.suppressed) await claim(notice, false);

  if (plan.summary && subs.length > 0) {
    const outcome = await sendToAll(db, uid, subs, {
      title: `${plan.summary.count} new events match your interests`,
      body: 'Open Event Watch to see them.',
      url: plan.summary.url,
      tag: `summary-${new Date(now).toISOString().slice(0, 13)}`,
      kind: 'summary',
    });
    delivered += outcome.delivered;
    pruned += outcome.pruned;
  }

  return { uid, claimed, delivered, suppressed: plan.suppressed.length, pruned };
}

/**
 * Every account with something to notify.
 *
 * `listDocuments` rather than a query: `users/{uid}` is an empty parent over subcollections in this
 * database, so a `get()` returns nothing while `listDocuments` returns the refs. It needs no index
 * and is one round trip on an account count in the single digits.
 */
export async function listAccounts(db: Firestore): Promise<string[]> {
  const refs = await db.collection('users').listDocuments();
  return refs.map((ref) => ref.id);
}

export { noticeIdFor };
