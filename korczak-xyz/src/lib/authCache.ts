/*
 * Last-known **approved** signed-in user, mirrored to localStorage.
 *
 * Firebase persists the session in IndexedDB, which is async: `onAuthStateChanged` does not
 * fire until a round-trip completes, so anything that waits for it renders blank first. That
 * is what made the status-bar email appear a beat late on every page. This cache is the
 * synchronously-readable copy - `useAuth` seeds its state from it, and an inline script in
 * the navbar paints the email from it before React has even downloaded.
 *
 * It is optimistic by nature. Signing out clears it directly (see useAuth), so the case
 * that remains is a session revoked *elsewhere*: the old address shows until Firebase says
 * otherwise, a moment later. That is an acceptable trade for a label showing the user their
 * own address, and nothing is authorised on the strength of it.
 *
 * **Only an approved account is ever written here**, which is why the word is in the first line.
 * `useAuth` seeds its state from this cache and every app treats that state as "signed in", so
 * caching an account still waiting on the owner's decision would paint a session that Firestore
 * is about to refuse everything for. An account whose approval has not been seen yet simply has
 * no cache entry: the first paint shows it signed out, and a beat later the account row arrives
 * and says which of the two it is.
 */

export interface CachedUser {
  uid: string;
  email: string | null;
}

// Also read by the inline pre-paint script in Navbar.astro - keep the two in step.
export const AUTH_CACHE_KEY = 'auth:last-user';

// localStorage throws rather than degrades in a few real situations (Safari private mode,
// storage disabled by policy), and none of them should take the navbar down with them.
function store<T>(fn: (s: Storage) => T): T | null {
  try {
    return fn(window.localStorage);
  } catch {
    return null;
  }
}

export function readCachedUser(): CachedUser | null {
  return store((s) => {
    const raw = s.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedUser>;
    if (!parsed || typeof parsed.uid !== 'string') return null;
    return { uid: parsed.uid, email: typeof parsed.email === 'string' ? parsed.email : null };
  });
}

export function writeCachedUser(user: CachedUser): void {
  store((s) => s.setItem(AUTH_CACHE_KEY, JSON.stringify({ uid: user.uid, email: user.email })));
}

export function clearCachedUser(): void {
  store((s) => s.removeItem(AUTH_CACHE_KEY));
}
