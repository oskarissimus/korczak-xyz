// Firestore-backed persistence for the typing trainer, used when a user is
// signed in. Documents are scoped under users/{uid} and secured by rules so
// only the account owner can read/write them.
//
// Every call goes through `runCloud`, which puts a deadline on it. A Firestore client that has
// died mid-session leaves its promises unsettled forever rather than rejecting them, and the
// sync engine's single-flight guard would wedge on the first such call - see firestoreHealth.ts.
// The Firestore handle is read per call for the same reason: recovery replaces the instance.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDb } from '../../lib/firebase';
import { runCloud } from '../../lib/firestoreHealth';
import type { SyncBookmark } from './reconcile';
import type { TypingProgress, TypingSession } from './types';

function progressDoc(uid: string, bookId: string) {
  return doc(getDb()!, 'users', uid, 'progress', bookId);
}

function sessionDoc(uid: string, sessionId: string) {
  return doc(getDb()!, 'users', uid, 'sessions', sessionId);
}

export async function loadCloudProgress(
  uid: string,
  bookId: string
): Promise<TypingProgress | null> {
  if (!getDb()) return null;
  const snap = await runCloud('loadProgress', () => getDoc(progressDoc(uid, bookId)));
  return snap.exists() ? (snap.data() as TypingProgress) : null;
}

export async function saveCloudProgress(uid: string, progress: TypingProgress): Promise<void> {
  if (!getDb()) return;
  await runCloud('saveProgress', () => setDoc(progressDoc(uid, progress.bookId), progress));
}

export type CheckedWriteResult =
  | { ok: true }
  // The document moved under us: another device (or another tab) wrote a revision this
  // client has not seen. The caller must reconcile rather than overwrite.
  | { ok: false; conflict: TypingProgress };

/**
 * Write progress only if the cloud still holds the revision the caller last saw.
 *
 * The unconditional `saveCloudProgress` is last-write-wins, which makes a second device's
 * work vanish without trace. Reading and comparing inside a transaction is what turns that
 * silent loss into a conflict the user gets to resolve.
 *
 * `expected` is null when the caller believes there is no document yet.
 */
export async function saveCloudProgressChecked(
  uid: string,
  progress: TypingProgress,
  expected: SyncBookmark | null
): Promise<CheckedWriteResult> {
  const db = getDb();
  if (!db) return { ok: true };
  return runCloud('saveProgressChecked', () =>
    runTransaction(db, async (tx) => {
      const ref = progressDoc(uid, progress.bookId);
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const remote = snap.data() as TypingProgress;
        const remoteRev = typeof remote.rev === 'number' ? remote.rev : 0;
        const remoteWriter = typeof remote.writerId === 'string' ? remote.writerId : '';
        const matches =
          expected != null && remoteRev === expected.rev && remoteWriter === expected.writerId;
        // A document with no writer predates lineage entirely; there is no revision to have
        // moved past, so the caller's own reconcile decision stands.
        if (!matches && remoteWriter !== '') {
          return { ok: false, conflict: remote } as CheckedWriteResult;
        }
      }
      tx.set(ref, progress);
      return { ok: true } as CheckedWriteResult;
    })
  );
}

// Sessions are append-only keystroke logs, immutable once the sitting ends, so they have no
// divergence to reconcile and stay on the plain last-write-wins path.
export async function saveCloudSession(uid: string, session: TypingSession): Promise<void> {
  if (!getDb()) return;
  await runCloud('saveSession', () => setDoc(sessionDoc(uid, session.id), session));
}

export async function loadCloudSessions(uid: string): Promise<TypingSession[]> {
  const db = getDb();
  if (!db) return [];
  const snap = await runCloud('loadSessions', () =>
    getDocs(collection(db, 'users', uid, 'sessions'))
  );
  return snap.docs.map((d) => d.data() as TypingSession);
}

// One book's sittings. The stats views want every book's, but a caller asking about a single
// book should not download the rest - a session document carries a whole keystroke log, so the
// difference is megabytes. Filtered server-side on one field, which Firestore's automatic
// single-field index already covers (no firestore.indexes.json entry needed).
export async function loadCloudSessionsForBook(
  uid: string,
  bookId: string
): Promise<TypingSession[]> {
  const db = getDb();
  if (!db) return [];
  const snap = await runCloud('loadSessionsForBook', () =>
    getDocs(query(collection(db, 'users', uid, 'sessions'), where('bookId', '==', bookId)))
  );
  return snap.docs.map((d) => d.data() as TypingSession);
}
