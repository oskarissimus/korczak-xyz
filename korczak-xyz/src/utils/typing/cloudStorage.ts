// Firestore-backed persistence for the typing trainer, used when a user is
// signed in. Documents are scoped under users/{uid} and secured by rules so
// only the account owner can read/write them.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
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

export async function saveCloudSession(uid: string, session: TypingSession): Promise<void> {
  if (!db) return;
  await setDoc(sessionDoc(uid, session.id), session);
}
