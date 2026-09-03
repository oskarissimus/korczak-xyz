/*
 * Deciding what to send, claiming it, and sending it.
 *
 * The decision is `planAlerts`, in the site's `transit/notices.ts`, compiled into this bundle so the
 * app and the collector cannot disagree. What is here is the I/O around it, and the one ordering
 * rule that matters more than the rest of the file:
 *
 * **The alert document is a lock taken BEFORE sending, not a receipt written after.** `create()`
 * fails on an existing document, which is the atomic latch. Written after the send, a crash between
 * sending and writing repeats the push on the next run — and this collector runs every ten minutes,
 * so "the next run" is soon and the repeat is not one notification but a loop. Written before, a
 * crash loses one alert, which is recoverable: the communiqué is in the feed, and its next edit
 * raises a fresh one.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { PushSub } from '../../../korczak-xyz/src/utils/events/types';
import type {
  TransitAlert,
  TransitItem,
  TransitSettings,
  WatchedSegment,
} from '../../../korczak-xyz/src/utils/transit/types';
import { DEFAULT_TRANSIT_SETTINGS } from '../../../korczak-xyz/src/utils/transit/types';
import { alertRecordFor, planAlerts, type PendingAlert } from '../../../korczak-xyz/src/utils/transit/notices';
import { sendToAll, type PushPayload } from '../push';
import { stripUndefined } from './upsert';

/** Where every notification from this app opens. */
export const APP_URL = '/apps/transit';

export interface NotifyResult {
  uid: string;
  claimed: number;
  delivered: number;
  suppressed: number;
  pruned: number;
}

async function loadAccount(
  db: Firestore,
  uid: string,
): Promise<{
  segments: WatchedSegment[];
  settings: TransitSettings;
  subs: PushSub[];
  seen: Set<string>;
}> {
  const user = db.collection('users').doc(uid);
  const [segmentsSnap, settingsSnap, subsSnap, alertsSnap] = await Promise.all([
    user.collection('transitSegments').get(),
    user.collection('transitSettings').doc('push').get(),
    /*
     * The same `pushSubs` collection the events app registers devices in, deliberately.
     *
     * One subscription per device per browser is what the Push API gives out; two apps on one
     * origin share a service worker and therefore share the endpoint. A second collection would be
     * a second copy of the same rows, going stale independently — and the one that went stale would
     * be pushing at an endpoint Apple stopped honouring months ago.
     */
    user.collection('pushSubs').get(),
    // Every alert id already claimed. The only thing between a re-run and a repeat.
    user.collection('transitAlerts').select().get(),
  ]);

  return {
    segments: segmentsSnap.docs.map((d) => ({ ...(d.data() as WatchedSegment), id: d.id })),
    settings: settingsSnap.exists
      ? { ...DEFAULT_TRANSIT_SETTINGS, ...(settingsSnap.data() as TransitSettings) }
      : DEFAULT_TRANSIT_SETTINGS,
    subs: subsSnap.docs.map((d) => ({ ...(d.data() as PushSub), id: d.id })),
    seen: new Set(alertsSnap.docs.map((d) => d.id)),
  };
}

/**
 * The banner.
 *
 * The title carries the priority, because the priority is the only thing a glance at a lock screen
 * reliably takes in: `⚠️ Twoja trasa` for a route alert and the line for a line one. The stop names
 * go in the body, in front of everything else — `XVII Bieg Ziemi Puckiej` is a name on a lock
 * screen, and so is *"Utrudnienia w komunikacji: M1"*, which is every metro headline WTP writes.
 * What distinguishes tonight's from last week's is which stations are shut.
 *
 * Language-neutral by construction, like every payload this repo sends: the station names, the
 * line codes and the operator's own reason are Polish either way, and the one word of scaffolding
 * is the same in both locales.
 */
export function payloadFor(pending: PendingAlert): PushPayload {
  const { item, verdict, kind } = pending;
  const lines = verdict.lines.join(' + ');

  const title =
    kind === 'route'
      ? `⚠️ ${lines} · Twoja trasa`
      : `${lines} · ${item.feed === 'change' ? 'zmiana' : 'utrudnienie'}`;

  return {
    title: title.slice(0, 110),
    body: bodyFor(pending),
    url: APP_URL,
    tag: pending.alertId,
    /*
     * Reported to `push.ts` as `source-health` rather than as one of the events app's notice kinds.
     * That type is the events app's vocabulary; the only thing it decides here is the TTL, and a
     * week is right for both kinds — a metro closure that has not been delivered in seven days is
     * long over.
     */
    kind: 'source-health',
  };
}

function bodyFor(pending: PendingAlert): string {
  const { item, verdict } = pending;
  const parts: string[] = [];

  /*
   * The uncertain case leads with the fact that it is uncertain. An unread communiqué is escalated
   * to route priority by `impactOf` precisely so it cannot be missed — and a banner that shouts
   * without saying it does not actually know is worse than no banner, because it teaches the reader
   * that the loud kind is unreliable.
   */
  if (!verdict.certain) {
    parts.push('Nie udało się odczytać szczegółów — otwórz komunikat.');
  } else if (item.wholeLine) {
    parts.push('Cała linia wstrzymana');
  } else if (verdict.stops.length > 0) {
    parts.push(verdict.stops.join(', '));
  } else if (item.summary) {
    parts.push(item.summary);
  }

  if (verdict.certain && item.summary && parts.length > 0 && parts[0] !== item.summary) {
    // The stop list answers "does this touch me"; the summary answers "what happened". Both fit.
    parts.push(item.summary);
  }
  if (item.reason) parts.push(item.reason);
  if (item.effectiveFrom !== undefined) parts.push(`od ${when(item.effectiveFrom)}`);

  return parts.join(' · ').slice(0, 300) || item.title;
}

function when(at: number): string {
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(at));
}

export async function notifyAccount(
  db: Firestore,
  uid: string,
  items: TransitItem[],
  now: number,
): Promise<NotifyResult> {
  const { segments, settings, subs, seen } = await loadAccount(db, uid);

  const plan = planAlerts(items, segments, { now, settings, seen, appUrl: APP_URL });

  let claimed = 0;
  let delivered = 0;
  let pruned = 0;
  const alerts = db.collection('users').doc(uid).collection('transitAlerts');

  const claim = async (pending: PendingAlert, send: boolean): Promise<void> => {
    const record: TransitAlert = alertRecordFor(pending, now);
    try {
      await alerts.doc(record.id).create(stripUndefined(record));
    } catch {
      // ALREADY_EXISTS: a previous or concurrent run owns this one. The latch working.
      return;
    }
    claimed += 1;

    if (!send || subs.length === 0) return;
    const outcome = await sendToAll(db, uid, subs, payloadFor(pending));
    delivered += outcome.delivered;
    pruned += outcome.pruned;
    await alerts.doc(record.id).set(
      outcome.delivered > 0
        ? { sentAt: Date.now() }
        : { failed: (outcome.lastError ?? 'no devices').slice(0, 300) },
      { merge: true },
    );
  };

  for (const pending of plan.send) await claim(pending, true);
  // Claimed but never sent individually — leaving them unclaimed would postpone the flood by ten
  // minutes rather than prevent it.
  for (const pending of plan.suppressed) await claim(pending, false);

  if (plan.summary && subs.length > 0) {
    const outcome = await sendToAll(db, uid, subs, {
      title: `${plan.summary.count} dalszych komunikatów o Twoich liniach`,
      body: 'Otwórz aplikację, żeby je zobaczyć.',
      url: plan.summary.url,
      tag: `transit-summary-${new Date(now).toISOString().slice(0, 13)}`,
      kind: 'summary',
    });
    delivered += outcome.delivered;
    pruned += outcome.pruned;
  }

  return { uid, claimed, delivered, suppressed: plan.suppressed.length, pruned };
}

/**
 * A feed that has stopped answering is worth a notification of its own.
 *
 * The one notification this app sends about itself, and it is the counterweight to the whole
 * design: everything else here is arranged so that not knowing is never mistaken for nothing being
 * wrong, and this is what says so when the not-knowing is total.
 */
export async function reportBrokenFeeds(
  db: Firestore,
  accounts: string[],
  broken: string[],
): Promise<void> {
  for (const uid of accounts) {
    const subs = await db.collection('users').doc(uid).collection('pushSubs').get();
    if (subs.empty) continue;
    await sendToAll(
      db,
      uid,
      subs.docs.map((d) => ({ ...(d.data() as PushSub), id: d.id })),
      {
        title: 'Nie można odczytać komunikatów WTP',
        body: `${broken.join(', ')} — aplikacja nie wie, co dzieje się na liniach.`,
        url: `${APP_URL}/raw`,
        tag: `transit-feed-health-${broken.join('-')}`,
        kind: 'source-health',
      },
    );
  }
}
