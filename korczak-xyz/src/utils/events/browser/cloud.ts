/*
 * Firestore for the events app.
 *
 * Two very different collections, and the difference is the whole design:
 *
 *   - `users/{uid}/eventInterests` is his, read and written from here. Covered by the
 *     `users/{uid}/{document=**}` catch-all, so it needed no rules change.
 *   - `events/` is a SHARED corpus, written only by the collector (a Cloud Function on the Admin
 *     SDK, which bypasses rules) and read by any signed-in account. That one needed a new rules
 *     block, and until `firebase deploy --only firestore:rules` has been run the feed reads
 *     nothing — which looks exactly like "the collector has not run yet".
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`. Holding the handle is what leaves
 * an app talking to a client that died mid-session, and skipping `runCloud` is what leaves a
 * promise unsettled forever rather than rejected. Both are written up in CLAUDE.md.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../../../lib/firebase';
import { runCloud } from '../../../lib/firestoreHealth';
import { log } from '../../../lib/logger';
import type { EventRecord, Interest, Notice, PushSettings, PushSub, SourceHealth } from '../types';
import { normalizeInterest } from './storage';

/**
 * How much of the shared corpus one pull takes.
 *
 * The feed matches locally — Firestore cannot express "any of these keywords" — so this is the
 * window the client reasons over. 2000 rows at ~300 bytes is about 600 kB, which is a lot for a
 * phone on a train and is why `saveFeedCache` keeps only the top 200.
 */
const EVENT_PULL_LIMIT = 2000;
const INTEREST_PULL_LIMIT = 500;
const DAY = 86400000;

// --- interests ------------------------------------------------------------------------------

function interestsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'eventInterests');
}

/**
 * The whole collection, every time.
 *
 * No `updatedAt` cursor, for the reason the sleep log documents: the timestamps come off client
 * clocks, so a device running a few seconds fast writes rows that slip under a bookmark taken from
 * a slower one and are never seen again. A few hundred small rows is cheap; a lost interest is not.
 */
export async function pullInterests(uid: string): Promise<Interest[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.interests.pull', () =>
    getDocs(query(interestsCollection(uid), orderBy('createdAt'), limit(INTEREST_PULL_LIMIT))),
  );
  const out: Interest[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const interest = normalizeInterest({ ...document.data(), id: document.id });
    if (interest) out.push(interest);
    else rejected += 1;
  }
  if (rejected > 0) log.warn('events.interests.pull.rejected', { rejected, kept: out.length });
  return out;
}

/** Never a deleteDoc — a delete has to reach the other device, so it travels as a tombstone. */
export async function pushInterest(uid: string, interest: Interest): Promise<void> {
  if (!getDb()) return;
  await runCloud('events.interests.push', () =>
    setDoc(doc(interestsCollection(uid), interest.id), stripUndefined(interest)),
  );
}

// --- the shared corpus ----------------------------------------------------------------------

/**
 * Upcoming events, oldest first.
 *
 * A single-field range plus an order on the *same* field, so Firestore's automatic index covers
 * this one — unlike `pullUndatedEvents` below, which needed a declared composite. Resist
 * `array-contains-any` on tags: it forces a composite index too and still cannot express what an
 * interest actually is.
 *
 * The window starts two days back so something happening tonight does not vanish at midnight.
 */
export async function pullEvents(now: number): Promise<EventRecord[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.corpus.pull', () =>
    getDocs(
      query(
        collection(getDb()!, 'events'),
        where('startsAt', '>=', now - 2 * DAY),
        orderBy('startsAt'),
        limit(EVENT_PULL_LIMIT),
      ),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as EventRecord), id: d.id }));
}

/**
 * Events with no date yet — a season announced before its nights are scheduled.
 *
 * A separate query because `where('startsAt', '>=', …)` excludes nulls outright, and these are
 * exactly the Teatr Wielki repertoire announcements the app exists for. Small, so no window.
 *
 * This one DOES need a declared index (`firestore.indexes.json`): an equality filter plus an order
 * on a different field is not something the automatic single-field indexes cover. Missing it is not
 * quiet — the feed renders "nothing matches your interests yet" over a raw Firestore error, which
 * is a sentence about the interests and a lie about the index.
 */
export async function pullUndatedEvents(): Promise<EventRecord[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.corpus.pull.undated', () =>
    getDocs(
      query(
        collection(getDb()!, 'events'),
        where('startsAt', '==', null),
        orderBy('firstSeenAt', 'desc'),
        limit(200),
      ),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as EventRecord), id: d.id }));
}

// --- push subscriptions ---------------------------------------------------------------------

function subsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'pushSubs');
}

export async function pullPushSubs(uid: string): Promise<PushSub[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.subs.pull', () =>
    getDocs(query(subsCollection(uid), orderBy('createdAt', 'desc'), limit(50))),
  );
  return snap.docs.map((d) => ({ ...(d.data() as PushSub), id: d.id }));
}

export async function pushPushSub(uid: string, sub: PushSub): Promise<void> {
  if (!getDb()) return;
  await runCloud('events.subs.push', () =>
    setDoc(doc(subsCollection(uid), sub.id), stripUndefined(sub), { merge: true }),
  );
}

/**
 * A real delete, unlike everything else here.
 *
 * A subscription is not a record of anything — it is a live capability, and a tombstone would
 * leave the collector pushing to an endpoint the owner asked it to stop using.
 */
export async function removePushSub(uid: string, subId: string): Promise<void> {
  if (!getDb()) return;
  await runCloud('events.subs.remove', () => deleteDoc(doc(subsCollection(uid), subId)));
}

// --- settings, notices, source health ---------------------------------------------------------

export async function pushSettings(uid: string, settings: PushSettings): Promise<void> {
  if (!getDb()) return;
  await runCloud('events.settings.push', () =>
    setDoc(doc(getDb()!, 'users', uid, 'eventSettings', 'push'), stripUndefined(settings), {
      merge: true,
    }),
  );
}

export async function pullSettings(uid: string): Promise<PushSettings | null> {
  if (!getDb()) return null;
  const snap = await runCloud('events.settings.pull', () =>
    getDocs(query(collection(getDb()!, 'users', uid, 'eventSettings'), limit(5))),
  );
  const found = snap.docs.find((d) => d.id === 'push');
  return found ? (found.data() as PushSettings) : null;
}

/** What has already been sent, newest first. Read-only here; the collector writes it. */
export async function pullNotices(uid: string): Promise<Notice[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.notices.pull', () =>
    getDocs(
      query(
        collection(getDb()!, 'users', uid, 'eventNotices'),
        orderBy('claimedAt', 'desc'),
        limit(100),
      ),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as Notice), id: d.id }));
}

/** Collector health, so a scrape that quietly returns nothing is visible on the Alerts tab. */
export async function pullSourceHealth(): Promise<SourceHealth[]> {
  if (!getDb()) return [];
  const snap = await runCloud('events.sources.pull', () =>
    getDocs(query(collection(getDb()!, 'eventSources'), limit(20))),
  );
  return snap.docs.map((d) => ({ ...(d.data() as SourceHealth), id: d.id }));
}

/**
 * Drops keys whose value is `undefined`.
 *
 * `setDoc` rejects an explicit `undefined` outright rather than treating it as absent, and these
 * records are full of optional fields — so a interest with no city would fail to save at all.
 */
function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}
