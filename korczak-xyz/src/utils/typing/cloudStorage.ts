// Firestore-backed persistence for the typing trainer, used when a user is
// signed in. Documents are scoped under users/{uid} and secured by rules so
// only the account owner can read/write them.
import { collection, doc, getDoc, getDocs, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { SyncBookmark } from './reconcile';
import type { TypingProgress, TypingSession } from './types';

function progressDoc(uid: string, bookId: string) {
  return doc(db!, 'users', uid, 'progress', bookId);
}

function sessionDoc(uid: string, sessionId: string) {
  return doc(db!, 'users', uid, 'sessions', sessionId);
}

export async function loadCloudProgress(
  uid: string,
  bookId: string
): Promise<TypingProgress | null> {
  if (!db) return null;
  const snap = await getDoc(progressDoc(uid, bookId));
  return snap.exists() ? (snap.data() as TypingProgress) : null;
}

export async function saveCloudProgress(uid: string, progress: TypingProgress): Promise<void> {
  if (!db) return;
  await setDoc(progressDoc(uid, progress.bookId), progress);
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
  if (!db) return { ok: true };
  return runTransaction(db, async (tx) => {
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
  });
}

// Sessions are append-only keystroke logs, immutable once the sitting ends, so they have no
// divergence to reconcile and stay on the plain last-write-wins path.
export async function saveCloudSession(uid: string, session: TypingSession): Promise<void> {
  if (!db) return;
  await setDoc(sessionDoc(uid, session.id), session);
}

export async function loadCloudSessions(uid: string): Promise<TypingSession[]> {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'users', uid, 'sessions'));
  return snap.docs.map((d) => d.data() as TypingSession);
}
