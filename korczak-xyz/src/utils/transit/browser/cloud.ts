/*
 * Firestore for the transport app.
 *
 * The same two-collection split the events app has, and for the same reason:
 *
 *   - `users/{uid}/transitSegments`, `.../transitSettings` and `.../transitAlerts` are the
 *     reader's, under the `users/{uid}/{document=**}` catch-all, so no rules change was needed.
 *   - `transitItems/`, `transitRaw/` and `transitFeeds/` are a SHARED corpus written only by the
 *     collector, which runs on the Admin SDK and bypasses rules entirely. Those three needed new
 *     rules blocks, and until they are deployed the app reads nothing — which looks exactly like a
 *     collector that has not run yet.
 *
 * Every call reads `getDb()` afresh and goes through `runCloud`, per CLAUDE.md: holding the handle
 * leaves an app talking to a client that died mid-session, and skipping `runCloud` leaves a promise
 * unsettled forever rather than rejected.
 */

import {
  collection,
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
import type {
  FeedFetch,
  RawFeedItem,
  TransitAlert,
  TransitItem,
  TransitSettings,
  WatchedSegment,
} from '../types';
import { normalizeSegmentRecord } from './storage';

/**
 * How much of the corpus one pull takes.
 *
 * Far smaller than the events app's 2000. The window is fourteen days of a feed that publishes a
 * few dozen items a day, the matching happens locally, and every row carries prose — so this is
 * about a megabyte at the very top end and is the number to lower first if a phone on a platform
 * feels slow.
 */
const ITEM_PULL_LIMIT = 600;
const SEGMENT_PULL_LIMIT = 100;
const DAY = 86400000;
const WINDOW_DAYS = 14;

// --- the watched segments ---------------------------------------------------------------------

function segmentsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'transitSegments');
}

/**
 * The whole collection, every time, tombstones included.
 *
 * No `updatedAt` cursor and no `orderBy`, for the two reasons the events app documents: timestamps
 * come off client clocks so a bookmark loses rows written by a device running fast, and an
 * `orderBy` silently excludes any document missing the field it names — which for a tombstone
 * written by another build is the row that decides the answer.
 */
export async function pullSegments(uid: string): Promise<WatchedSegment[]> {
  if (!getDb()) return [];
  const snap = await runCloud('transit.segments.pull', () =>
    getDocs(query(segmentsCollection(uid), limit(SEGMENT_PULL_LIMIT))),
  );
  const out: WatchedSegment[] = [];
  let rejected = 0;
  for (const document of snap.docs) {
    const segment = normalizeSegmentRecord({ ...document.data(), id: document.id });
    if (segment) out.push(segment);
    else rejected += 1;
  }
  if (rejected > 0) log.warn('transit.segments.pull.rejected', { rejected, kept: out.length });
  return out;
}

/** Never a deleteDoc — a delete has to reach the other device, so it travels as a tombstone. */
export async function pushSegment(uid: string, segment: WatchedSegment): Promise<void> {
  if (!getDb()) return;
  await runCloud('transit.segments.push', () =>
    setDoc(doc(segmentsCollection(uid), segment.id), stripUndefined(segment)),
  );
}

// --- the shared corpus ---------------------------------------------------------------------

/**
 * The last fortnight of communiqués, newest first.
 *
 * A single-field range plus an order on the *same* field, so Firestore's automatic index covers it
 * and nothing has to be declared. That is worth keeping: the events app needed a composite for its
 * undated query and the symptom of forgetting it was a feed that rendered "nothing matches" over a
 * raw Firestore error.
 */
export async function pullItems(now: number): Promise<TransitItem[]> {
  if (!getDb()) return [];
  const snap = await runCloud('transit.items.pull', () =>
    getDocs(
      query(
        collection(getDb()!, 'transitItems'),
        where('publishedAt', '>=', now - WINDOW_DAYS * DAY),
        orderBy('publishedAt', 'desc'),
        limit(ITEM_PULL_LIMIT),
      ),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as TransitItem), id: d.id }));
}

/** How each feed's last fetch went. Two rows. The whole of the "is this thing on?" question. */
export async function pullFeedHealth(): Promise<FeedFetch[]> {
  if (!getDb()) return [];
  const snap = await runCloud('transit.feeds.pull', () =>
    getDocs(query(collection(getDb()!, 'transitFeeds'), limit(10))),
  );
  return snap.docs.map((d) => ({ ...(d.data() as FeedFetch), id: d.id }));
}

/**
 * The raw archive, newest first.
 *
 * Read on demand by the Raw tab and by nothing else — it is several times the size of the parsed
 * corpus and exists to be looked at when a reading has gone wrong, not to be carried around.
 */
export async function pullRaw(max = 60): Promise<RawFeedItem[]> {
  if (!getDb()) return [];
  const snap = await runCloud('transit.raw.pull', () =>
    getDocs(
      query(collection(getDb()!, 'transitRaw'), orderBy('publishedAt', 'desc'), limit(max)),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as RawFeedItem), id: d.id }));
}

/** One archived item by id, for the "show me the source of this card" link. */
export async function pullRawFor(itemId: string): Promise<RawFeedItem | null> {
  if (!getDb()) return null;
  const snap = await runCloud('transit.raw.pull.one', () =>
    getDocs(query(collection(getDb()!, 'transitRaw'), where('__name__', '==', itemId), limit(1))),
  );
  const found = snap.docs[0];
  return found ? { ...(found.data() as RawFeedItem), id: found.id } : null;
}

// --- settings and history --------------------------------------------------------------------

export async function pushTransitSettings(uid: string, settings: TransitSettings): Promise<void> {
  if (!getDb()) return;
  await runCloud('transit.settings.push', () =>
    setDoc(doc(getDb()!, 'users', uid, 'transitSettings', 'push'), stripUndefined(settings), {
      merge: true,
    }),
  );
}

export async function pullTransitSettings(uid: string): Promise<TransitSettings | null> {
  if (!getDb()) return null;
  const snap = await runCloud('transit.settings.pull', () =>
    getDocs(query(collection(getDb()!, 'users', uid, 'transitSettings'), limit(5))),
  );
  const found = snap.docs.find((d) => d.id === 'push');
  return found ? (found.data() as TransitSettings) : null;
}

/** What has already been sent, newest first. Read-only here; the collector writes it. */
export async function pullAlerts(uid: string): Promise<TransitAlert[]> {
  if (!getDb()) return [];
  const snap = await runCloud('transit.alerts.pull', () =>
    getDocs(
      query(
        collection(getDb()!, 'users', uid, 'transitAlerts'),
        orderBy('claimedAt', 'desc'),
        limit(100),
      ),
    ),
  );
  return snap.docs.map((d) => ({ ...(d.data() as TransitAlert), id: d.id }));
}

/**
 * Drops keys whose value is `undefined`.
 *
 * `setDoc` rejects an explicit `undefined` outright rather than treating it as absent, and these
 * records are full of optional fields — so a segment with no `muted` flag would fail to save at all.
 */
function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
