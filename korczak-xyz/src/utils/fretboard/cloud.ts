/*
 * Firestore for the fretboard trainer, used when someone is signed in.
 *
 * One document per sitting, under `users/{uid}/fretboardSessions/{sessionId}`, holding the
 * sitting and every answer given in it. Documents are written once and never edited, which is
 * the whole reason this file has no transactions and no conflict handling: two devices cannot
 * write the same document, so merging is a union and the deck is refolded from it.
 *
 * Settings are the exception - a single mutable document, last-write-wins, because a preference
 * has no history to lose.
 *
 * Every call goes through `runCloud`, and `getDb()` is read per call rather than held. A
 * Firestore client that has died mid-session leaves its promises unsettled forever instead of
 * rejecting them, and recovery replaces the instance - see `src/lib/firestoreHealth.ts` and the
 * client-health note in CLAUDE.md.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import type { ReviewEvent, SessionRecord, Settings } from './types';

interface SessionDoc {
  session: SessionRecord;
  events: ReviewEvent[];
}

/**
 * Ceiling on one pull. A sitting is a few kilobytes, so this is generous for the incremental
 * case and a guard against dragging years of history over a phone connection in the full one.
 */
const PULL_LIMIT = 500;

function sessionsCollection(uid: string) {
  return collection(getDb()!, 'users', uid, 'fretboardSessions');
}

function settingsDoc(uid: string) {
  return doc(getDb()!, 'users', uid, 'fretboard', 'settings');
}

export interface PullResult {
  sessions: SessionRecord[];
  events: ReviewEvent[];
  /** The newest `endedAt` seen, to resume an incremental pull from. */
  newestEndedAt: number;
  /** Whether this pull returned the account's entire history. */
  complete: boolean;
}

const EMPTY_PULL: PullResult = { sessions: [], events: [], newestEndedAt: 0, complete: false };

function collect(docs: SessionDoc[], complete: boolean): PullResult {
  const sessions: SessionRecord[] = [];
  const events: ReviewEvent[] = [];
  let newestEndedAt = 0;
  for (const entry of docs) {
    if (!entry?.session) continue;
    sessions.push(entry.session);
    if (Array.isArray(entry.events)) events.push(...entry.events);
    newestEndedAt = Math.max(newestEndedAt, entry.session.endedAt ?? 0);
  }
  return { sessions, events, newestEndedAt, complete };
}

/** Sittings that finished after `since`. Pass 0 to take the lot. */
export async function pullSessions(uid: string, since: number): Promise<PullResult> {
  if (!getDb()) return EMPTY_PULL;
  const snap = await runCloud('fretboard.pull', () =>
    getDocs(
      since > 0
        ? query(
            sessionsCollection(uid),
            where('session.endedAt', '>', since),
            orderBy('session.endedAt'),
            limit(PULL_LIMIT)
          )
        : query(sessionsCollection(uid), orderBy('session.endedAt'), limit(PULL_LIMIT))
    )
  );
  const docs = snap.docs.map((d) => d.data() as SessionDoc);
  // A pull from the beginning that did not hit the ceiling has the whole account in it, which
  // is what lets the caller rebuild the deck from scratch rather than fold onto a stale one.
  return collect(docs, since === 0 && docs.length < PULL_LIMIT);
}

export async function pushSession(
  uid: string,
  session: SessionRecord,
  events: ReviewEvent[]
): Promise<void> {
  if (!getDb()) return;
  await runCloud('fretboard.push', () =>
    setDoc(doc(sessionsCollection(uid), session.id), { session, events } satisfies SessionDoc)
  );
}

export async function loadCloudSettings(uid: string): Promise<Settings | null> {
  if (!getDb()) return null;
  const snap = await runCloud('fretboard.loadSettings', () => getDoc(settingsDoc(uid)));
  return snap.exists() ? (snap.data() as Settings) : null;
}

export async function saveCloudSettings(uid: string, settings: Settings): Promise<void> {
  if (!getDb()) return;
  await runCloud('fretboard.saveSettings', () => setDoc(settingsDoc(uid), settings));
}
