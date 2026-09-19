/*
 * One question, answered in one place: what may this browser do right now?
 *
 * Four states, and the interesting thing about them is the order they arrive in. A page load with
 * a returning user has *three* sources of truth turning up at different times — the localStorage
 * cache (synchronous), Firebase's own session (a round trip to IndexedDB), and the account row
 * that says whether the owner has admitted this account (a round trip to Firestore) — and every
 * arrangement of "arrived / has not arrived" has to produce something honest to put on screen.
 *
 * It lives apart from `useAuth` and is pure because getting it wrong is silent and expensive in
 * both directions. Too eager and an app treats a revoked account as signed in and writes into a
 * Firestore that refuses it; too cautious and every approved user watches their own apps flicker
 * through "signed out" on every navigation. Neither shows up in a type error, and both show up in
 * a bug report weeks later — so the table is in a test instead.
 */

export type AccessStatus = 'signed-out' | 'checking' | 'pending' | 'approved';

export interface AccessInputs {
  /** Firebase is configured at all. */
  enabled: boolean;
  /** `onAuthStateChanged` has fired at least once. */
  authResolved: boolean;
  /** The uid in the localStorage cache, which holds approved accounts only. */
  cachedUid: string | null;
  /** The signed-in uid, approved or not. */
  identityUid: string | null;
  /** The account row for *this* uid has arrived (it may still be missing — see `approved`). */
  accountReady: boolean;
  /** That row says yes. */
  approved: boolean;
}

export function decideAccess(input: AccessInputs): AccessStatus {
  // No Firebase, no accounts, nothing to wait for. The apps run on localStorage and always have.
  if (!input.enabled) return 'signed-out';

  // Before Firebase has spoken, the cache is the only thing that knows anything. It is written
  // only for an approved account, so a hit is a previous answer to both questions at once — which
  // is what lets a returning user's page paint signed-in in the first frame.
  if (!input.authResolved) return input.cachedUid ? 'approved' : 'checking';

  if (!input.identityUid) return 'signed-out';

  // Signed in, and the verdict is in: it is the verdict.
  if (input.accountReady) return input.approved ? 'approved' : 'pending';

  // Signed in, verdict still in flight. A cache entry for this same uid stands in for it — the
  // stale answer can only be wrong if approval was revoked since the last page load, and then it
  // is wrong for the second or so the read takes. Anything else genuinely is unknown.
  return input.cachedUid === input.identityUid ? 'approved' : 'checking';
}
