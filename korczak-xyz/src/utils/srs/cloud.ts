/*
 * Firestore for a spaced-repetition trainer, used when someone is signed in.
 *
 * One document per sitting, under `users/{uid}/{sessions}/{sessionId}`, holding the sitting and
 * every answer given in it. Documents are written once and never edited, which is the whole
 * reason this file has no transactions and no conflict handling: two devices cannot write the
 * same document, so merging is a union and the deck is refolded from it.
 *
 * Settings are the exception — a single mutable document, last-write-wins, because a preference
 * has no history to lose.
 *
 * Every call goes through `runCloud`, and `getDb()` is read per call rather than held. A
 * Firestore client that has died mid-session leaves its promises unsettled forever instead of
 * rejecting them, and recovery replaces the instance — see `src/lib/firestoreHealth.ts` and the
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
import type { ReviewEvent, SessionRecord } from './types';

interface SessionDoc {
  session: SessionRecord;
  events: ReviewEvent[];
}

/**
 * Ceiling on one pull. A sitting is a few kilobytes, so this is generous for the incremental
 * case and a guard against dragging years of history over a phone connection in the full one.
 */
const PULL_LIMIT = 500;

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

export interface SrsCloud<S> {
  /** Sittings that finished after `since`. Pass 0 to take the lot. */
  pullSessions(uid: string, since: number): Promise<PullResult>;
  pushSession(uid: string, session: SessionRecord, events: ReviewEvent[]): Promise<void>;
  loadCloudSettings(uid: string): Promise<S | null>;
  saveCloudSettings(uid: string, settings: S): Promise<void>;
}

/**
 * @param sessionsCollection the subcollection under `users/{uid}` holding one document per
 *   sitting, e.g. `fretboardSessions`.
 * @param settingsPath the two path segments under `users/{uid}` naming the settings document,
 *   e.g. `['fretboard', 'settings']`. Firestore alternates collection and document, so a
 *   settings document needs a collection to live in.
 * @param label what a call is reported under in the frontend log, e.g. `fretboard`.
 */
export function createSrsCloud<S>(
  sessionsCollection: string,
  settingsPath: [string, string],
  label: string
): SrsCloud<S> {
  const sessions = (uid: string) => collection(getDb()!, 'users', uid, sessionsCollection);
  const settings = (uid: string) => doc(getDb()!, 'users', uid, ...settingsPath);

  return {
    async pullSessions(uid, since) {
      if (!getDb()) return EMPTY_PULL;
      const snap = await runCloud(`${label}.pull`, () =>
        getDocs(
          since > 0
            ? query(
                sessions(uid),
                where('session.endedAt', '>', since),
                orderBy('session.endedAt'),
                limit(PULL_LIMIT)
              )
            : query(sessions(uid), orderBy('session.endedAt'), limit(PULL_LIMIT))
        )
      );
      const docs = snap.docs.map((d) => d.data() as SessionDoc);
      // A pull from the beginning that did not hit the ceiling has the whole account in it, which
      // is what lets the caller rebuild the deck from scratch rather than fold onto a stale one.
      return collect(docs, since === 0 && docs.length < PULL_LIMIT);
    },

    async pushSession(uid, session, events) {
      if (!getDb()) return;
      await runCloud(`${label}.push`, () =>
        setDoc(doc(sessions(uid), session.id), { session, events } satisfies SessionDoc)
      );
    },

    async loadCloudSettings(uid) {
      if (!getDb()) return null;
      const snap = await runCloud(`${label}.loadSettings`, () => getDoc(settings(uid)));
      return snap.exists() ? (snap.data() as S) : null;
    },

    async saveCloudSettings(uid, value) {
      if (!getDb()) return;
      await runCloud(`${label}.saveSettings`, () => setDoc(settings(uid), value as object));
    },
  };
}
