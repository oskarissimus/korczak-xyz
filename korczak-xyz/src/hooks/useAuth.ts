import { useCallback, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, firebaseEnabled } from '../lib/firebase';
import { clearCachedUser, readCachedUser, writeCachedUser } from '../lib/authCache';
import { installFirestoreWatchdog } from '../lib/firestoreHealth';
import { installLogDebug } from '../lib/logDebug';
import { onAuthResolved } from '../lib/logSink';
import { describeError, log, setLogUid } from '../lib/logger';

// Minimal user shape we pass around (subset of the Firebase User).
export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthApi {
  enabled: boolean;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthApi {
  // Start from the cached user rather than from nothing. Firebase's own session lives in
  // IndexedDB and takes a round-trip to read, and consumers that render nothing while
  // `loading` is true would show a hole for the whole of it. A returning user is therefore
  // signed in from the first paint, and `onAuthStateChanged` only ever confirms it.
  const [cachedUser] = useState(() => {
    const cached = readCachedUser();
    // Seed the logger from the cache too, so entries recorded before Firebase resolves are
    // still attributable - and uploadable - rather than stranded as anonymous.
    if (cached) setLogUid(cached.uid);
    return cached;
  });
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [loading, setLoading] = useState<boolean>(firebaseEnabled && !cachedUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    installLogDebug();
    installFirestoreWatchdog();
    if (!firebaseEnabled || !auth) {
      setLoading(false);
      log.info('auth.disabled', {});
      return;
    }
    log.info('auth.state', { source: 'cache', uid: cachedUser?.uid ?? null });
    const unsubscribe = onAuthStateChanged(auth, (u: User | null) => {
      setUser(u ? { uid: u.uid, email: u.email } : null);
      setLoading(false);
      setLogUid(u?.uid ?? null);
      log.info('auth.state', {
        source: 'firebase',
        uid: u?.uid ?? null,
        // The cached uid and the resolved one disagreeing is the interesting case; matching
        // is the norm and only worth recording because "it matched" is itself evidence.
        matchedCache: (cachedUser?.uid ?? null) === (u?.uid ?? null),
      });
      if (u) {
        writeCachedUser({ uid: u.uid, email: u.email });
        onAuthResolved(); // ship anything buffered while signed out
      } else {
        clearCachedUser();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!firebaseEnabled || !auth) return;
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      log.warn('auth.signin.fail', describeError(e));
      setError(
        code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found'
          ? 'Invalid email or password.'
          : code === 'auth/too-many-requests'
            ? 'Too many attempts. Try again later.'
            : 'Sign-in failed.'
      );
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!firebaseEnabled || !auth) return;
    log.info('auth.signout', {});
    await firebaseSignOut(auth);
    // Also cleared by the listener above, but not necessarily before the caller acts on
    // this promise - NavAuth reloads the page on the next line. Clearing it here removes
    // the ordering question, so a logout can never leave the address behind to be painted
    // over the page that comes back.
    clearCachedUser();
  }, []);

  return { enabled: firebaseEnabled, user, loading, error, signIn, signOut };
}
