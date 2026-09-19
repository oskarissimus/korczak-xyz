import { useCallback, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { decideAccess, type AccessStatus } from '../lib/access';
import { auth, firebaseEnabled } from '../lib/firebase';
import {
  getAccountState,
  loadIsAdmin,
  subscribeAccountState,
  watchAccount,
  type AccountRecord,
  type AccountState,
} from '../lib/account';
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

/**
 * Sign-in and sign-up failures, as codes rather than sentences.
 *
 * They used to be English strings built here, which put English on the Polish login page — the one
 * page where somebody is most likely to be stuck and reading carefully. The mapping to words is
 * `LoginForm`'s, in both languages; what this hook knows is which of a handful of things went
 * wrong.
 */
export type AuthErrorCode =
  | 'invalid-credential'
  | 'too-many-requests'
  | 'email-in-use'
  | 'weak-password'
  | 'invalid-email'
  | 'signup-disabled'
  | 'failed';

/**
 * Where this session stands with the owner.
 *
 *   signed-out  nobody is signed in
 *   checking    signed in; whether the account has been let in is still being read
 *   pending     signed in, and waiting on a decision. Opens nothing — see `firestore.rules`
 *   approved    signed in and let in. The only state in which `user` is non-null
 *
 * Which of the four it is, from three answers that arrive at three different times, is
 * `decideAccess` in `src/lib/access.ts` — pure, and with the whole table in a test beside it.
 */
export type { AccessStatus };

export interface AuthApi {
  enabled: boolean;
  /**
   * The **approved** signed-in user, or null.
   *
   * Every app on the site reads this and nothing else, which is deliberate: an account the owner
   * has not admitted yet is refused by the rules on every path, so the honest thing for a trainer
   * or a sleep log to do with one is exactly what it does when nobody is signed in — work locally
   * and offer to sync later. Keeping the approval out of thirty components and in one line here is
   * what makes that true without thirty edits.
   */
  user: AuthUser | null;
  /** Signed in, admitted or not. Only the login page and the admissions panel have a use for it. */
  identity: AuthUser | null;
  status: AccessStatus;
  account: AccountRecord | null;
  /** The account row could not be read. Shown on the login page; treated as "not approved". */
  accountError: string | null;
  isAdmin: boolean;
  loading: boolean;
  error: AuthErrorCode | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Send the verification mail again. Resolves false when there is nobody to send it to. */
  resendVerification: () => Promise<boolean>;
}

function codeOf(e: unknown): AuthErrorCode {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'invalid-credential';
    case 'auth/too-many-requests':
      return 'too-many-requests';
    case 'auth/email-already-in-use':
      return 'email-in-use';
    case 'auth/weak-password':
      return 'weak-password';
    case 'auth/invalid-email':
      return 'invalid-email';
    // Both of these mean the same thing from the outside: Identity Platform is refusing to create
    // accounts at all. `admin-restricted-operation` is what it answers while "user actions → create"
    // is switched off, which is the state this whole feature replaced — if it ever comes back, the
    // sign-up form says so instead of failing with a shrug.
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'signup-disabled';
    default:
      return 'failed';
  }
}

export function useAuth(): AuthApi {
  // Start from the cached user rather than from nothing. Firebase's own session lives in
  // IndexedDB and takes a round-trip to read, and consumers that render nothing while
  // `loading` is true would show a hole for the whole of it. A returning user is therefore
  // signed in from the first paint, and `onAuthStateChanged` only ever confirms it.
  //
  // The cache holds approved accounts only (see authCache.ts), so a hit is also a statement
  // about admission — which is what lets the first paint skip the account read as well.
  const [cachedUser] = useState(() => {
    const cached = readCachedUser();
    // Seed the logger from the cache too, so entries recorded before Firebase resolves are
    // still attributable - and uploadable - rather than stranded as anonymous.
    if (cached) setLogUid(cached.uid);
    return cached;
  });
  const [identity, setIdentity] = useState<AuthUser | null>(cachedUser);
  const [authResolved, setAuthResolved] = useState<boolean>(!firebaseEnabled);
  const [account, setAccount] = useState<AccountState>(() => getAccountState());
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);

  useEffect(() => {
    installLogDebug();
    installFirestoreWatchdog();
    if (!firebaseEnabled || !auth) {
      setAuthResolved(true);
      log.info('auth.disabled', {});
      return;
    }
    log.info('auth.state', { source: 'cache', uid: cachedUser?.uid ?? null });
    const unsubscribe = onAuthStateChanged(auth, (u: User | null) => {
      setIdentity(u ? { uid: u.uid, email: u.email } : null);
      setAuthResolved(true);
      setLogUid(u?.uid ?? null);
      log.info('auth.state', {
        source: 'firebase',
        uid: u?.uid ?? null,
        // The cached uid and the resolved one disagreeing is the interesting case; matching
        // is the norm and only worth recording because "it matched" is itself evidence.
        matchedCache: (cachedUser?.uid ?? null) === (u?.uid ?? null),
      });
      // Whether this account has been let in is a Firestore document, and this is the one place
      // that knows a sign-in has happened. The watcher is module-level and idempotent per uid —
      // every mounted copy of this hook calls it with the same answer.
      watchAccount(u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified } : null);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => subscribeAccountState(setAccount), []);

  useEffect(() => {
    const uid = identity?.uid;
    if (!uid) {
      setAdmin(false);
      return;
    }
    let cancelled = false;
    void loadIsAdmin(uid).then((is) => {
      if (!cancelled) setAdmin(is);
    });
    return () => {
      cancelled = true;
    };
  }, [identity?.uid]);

  // Has the account row for *this* identity arrived? A row left over from the account that was
  // signed in a moment ago answers a question nobody is asking.
  const accountReady = account.resolved && account.uid === (identity?.uid ?? null);

  const status: AccessStatus = decideAccess({
    enabled: firebaseEnabled,
    authResolved,
    cachedUid: cachedUser?.uid ?? null,
    identityUid: identity?.uid ?? null,
    accountReady,
    approved: account.record?.approved === true,
  });

  const user = status === 'approved' ? identity : null;
  const loading = status === 'checking';

  useEffect(() => {
    if (status === 'approved' && identity) {
      writeCachedUser({ uid: identity.uid, email: identity.email });
      onAuthResolved(); // ship anything buffered while signed out
    } else if (status === 'pending' || status === 'signed-out') {
      // A pending account must not leave an address behind for the navbar's pre-paint script to
      // put on screen: it would show a session that Firestore refuses everything for.
      clearCachedUser();
    }
  }, [status, identity?.uid, identity?.email]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!firebaseEnabled || !auth) return;
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      log.warn('auth.signin.fail', describeError(e));
      setError(codeOf(e));
      throw e;
    }
  }, []);

  /**
   * Create an account.
   *
   * It signs the new account in — Firebase does that as part of creating it, and there is nothing
   * to be gained by signing them straight back out. They land on the waiting screen, which is the
   * truthful place to be: the token is real and opens nothing.
   *
   * The verification mail is sent on a best-effort basis. It is not what admits anybody — the
   * owner is — but it is what lets the panel show a verified address, and it is the difference
   * between a household share that can be claimed by whoever types the address first and one that
   * cannot. A mail that fails to send must not fail the sign-up: the account exists by then.
   */
  const signUp = useCallback(async (email: string, password: string) => {
    if (!firebaseEnabled || !auth) return;
    setError(null);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      log.info('auth.signup.ok', { uid: credential.user.uid });
      try {
        await sendEmailVerification(credential.user);
      } catch (e) {
        log.warn('auth.signup.verifyMailFailed', describeError(e));
      }
    } catch (e) {
      log.warn('auth.signup.fail', describeError(e));
      setError(codeOf(e));
      throw e;
    }
  }, []);

  const resendVerification = useCallback(async () => {
    if (!firebaseEnabled || !auth?.currentUser) return false;
    try {
      await sendEmailVerification(auth.currentUser);
      return true;
    } catch (e) {
      log.warn('auth.verify.resendFailed', describeError(e));
      return false;
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

  return {
    enabled: firebaseEnabled,
    user,
    identity,
    status,
    account: accountReady ? account.record : null,
    accountError: accountReady ? account.error : null,
    isAdmin: admin,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resendVerification,
  };
}
