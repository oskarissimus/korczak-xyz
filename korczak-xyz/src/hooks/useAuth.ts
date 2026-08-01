import { useCallback, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, firebaseEnabled } from '../lib/firebase';
import { clearCachedUser, readCachedUser, writeCachedUser } from '../lib/authCache';

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
  const [cachedUser] = useState(readCachedUser);
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [loading, setLoading] = useState<boolean>(firebaseEnabled && !cachedUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseEnabled || !auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u: User | null) => {
      setUser(u ? { uid: u.uid, email: u.email } : null);
      setLoading(false);
      if (u) writeCachedUser({ uid: u.uid, email: u.email });
      else clearCachedUser();
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!firebaseEnabled || !auth) return;
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      const code = (e as { code?: string })?.code;
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
    await firebaseSignOut(auth);
  }, []);

  return { enabled: firebaseEnabled, user, loading, error, signIn, signOut };
}
