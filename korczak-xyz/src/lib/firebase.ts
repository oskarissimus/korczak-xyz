// Firebase initialization. Reads public config from PUBLIC_FIREBASE_* env vars.
// If the config is absent (e.g. before it's wired up), Firebase stays disabled
// and the app falls back to localStorage-only behavior.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

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
}

export const auth = authInstance;
export const db = dbInstance;
