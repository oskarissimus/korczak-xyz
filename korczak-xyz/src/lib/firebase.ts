// Firebase initialization. Reads public config from PUBLIC_FIREBASE_* env vars.
// If the config is absent (e.g. before it's wired up), Firebase stays disabled
// and the app falls back to localStorage-only behavior.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, terminate, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID as string | undefined,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

if (firebaseEnabled) {
  app = initializeApp({
    apiKey: config.apiKey!,
    authDomain: config.authDomain,
    projectId: config.projectId!,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId!,
  });
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  /*
   * Cloud Storage, for the one app that produces files rather than rows: /apps/sloper/ writes its
   * pictures, narrations and finished MP4 to `korczak-xyz-501720-sloper`. It is built here and not
   * lazily, because `getStorage` is a synchronous lookup on an app that already exists — the
   * bundle cost is the `firebase/storage` import, and that is paid by importing the module at all.
   *
   * There is deliberately no `recycleStorage` beside `recycleDb`. The failure this file exists to
   * work around is Firestore's AsyncQueue poisoning itself, which leaves every waiting promise
   * unsettled for ever. Storage has no such queue: an upload is one HTTPS request, and a request
   * that fails rejects like any other. Nothing to revive.
   */
  storageInstance = config.storageBucket ? getStorage(app) : null;
}

export const auth = authInstance;

/*
 * Firestore is reached through a getter rather than exported once, because the client can die
 * in a way only a replacement can fix.
 *
 * A Firestore client owns an AsyncQueue, and an internal assertion thrown inside it records a
 * permanent `failure`: after that every enqueue re-throws and every promise already waiting on
 * the queue is never settled - not resolved, not rejected. The observed trigger is going
 * offline long enough for the auth token to need refreshing: the refresh fails with
 * `auth/network-request-failed`, that string reaches Firestore's `isPermanentError`, which
 * knows only gRPC codes and calls `fail(0x3c6b)` on anything else. Nothing about restoring the
 * connection revives the client, so a session that hits it stops syncing until a reload.
 *
 * `terminate()` drops the instance from the app's component container synchronously, so the
 * next `getFirestore(app)` builds a fresh client with a fresh queue.
 */
export function getDb(): Firestore | null {
  return dbInstance;
}

/** Discard the current Firestore client and build a fresh one. Returns false if disabled. */
export function recycleDb(): boolean {
  if (!app) return false;
  const dead = dbInstance;
  dbInstance = null;
  if (dead) {
    try {
      // The returned promise rejects when the queue is already poisoned - which is precisely
      // the case being recovered from - but the instance has been removed by then regardless.
      void terminate(dead).catch(() => undefined);
    } catch {
      // Same story, thrown synchronously.
    }
  }
  dbInstance = getFirestore(app);
  return true;
}

/**
 * Cloud Storage, or null when Firebase is off or no bucket is configured.
 *
 * A getter for symmetry with `getDb()`, not because the instance can die — see the note where it
 * is created. Callers must handle null: `PUBLIC_FIREBASE_STORAGE_BUCKET` is absent from a fresh
 * clone's `.env`, and an app that throws there is an app that will not start in development.
 */
export function getStorageClient(): FirebaseStorage | null {
  return storageInstance;
}
