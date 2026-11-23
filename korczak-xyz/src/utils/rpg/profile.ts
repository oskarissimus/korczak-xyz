/*
 * Whose game this browser is showing: a guest's, or one account's (owner, 20 Nov 2026: "signed in and
 * signed out I have the same worlds?").
 *
 * Until then the game's memory was one set of localStorage keys for whoever held the browser. Signing
 * in synced that set both ways (`cloud.ts`), so the guest's worlds went up to the account, and signing
 * out left the account's worlds where they were, so the guest went on seeing all of them. Now each
 * account has its own copy of the keys, suffixed `@<uid>`, and the guest keeps the bare ones:
 *
 *   rpg-worlds, rpg-atlas, rpg-saves, rpg-chronicle, rpg-sync, rpg-clean-slate
 *
 * Everything that reads or writes them asks `rpgKey` for the name, so the store follows the profile
 * with no cache to empty. The profile is kept in `rpg-profile` too, so a page (the game, the model lab)
 * opens on the right store before Firebase has said who is signed in; the game sets it from the auth
 * state once that is known (`Rpg.tsx`).
 *
 * Preferences stay shared (the language, music, the model, the wish, the voices): they are the
 * browser's, not a player's.
 */

const PROFILE_KEY = 'rpg-profile';

function stored(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY) || null;
  } catch {
    return null;
  }
}

let active: string | null = typeof localStorage === 'undefined' ? null : stored();

/** The account whose game this browser is showing, or null for the guest. */
export function profile(): string | null {
  return active;
}

/** The localStorage key of `base` in the active profile. */
export function rpgKey(base: string): string {
  return active ? `${base}@${active}` : base;
}

/** Switches the store to `uid`'s (null: the guest's). True when it changed. */
export function setProfile(uid: string | null): boolean {
  if (uid === active) return false;
  active = uid;
  try {
    if (uid) localStorage.setItem(PROFILE_KEY, uid);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* this page load still uses it; the next one starts as the guest until auth says otherwise */
  }
  return true;
}

/** Runs `fn` against another profile's store, synchronously, and comes back. */
export function withProfile<T>(uid: string | null, fn: () => T): T {
  const before = active;
  active = uid;
  try {
    return fn();
  } finally {
    active = before;
  }
}

/** The guest's game a new account takes with it: its worlds, their atlases and chronicle, the quest in progress. */
const ADOPTED = ['rpg-worlds', 'rpg-atlas', 'rpg-saves', 'rpg-chronicle'] as const;
const ADOPTED_KEY = 'rpg-guest-adopted';

/**
 * The guest's world and quest go with them into the account they make (owner, 23 Nov 2026: a guest
 * has one world and the first step of one quest, then is invited to make an account and play on).
 * Copied once per browser, to the first account signed in here after the guest played, and only into
 * an account that has nothing in this browser yet; the sync (`cloud.ts`) then sends it up like any
 * unsynced change. The guest's own copy stays where it was. True when something was copied.
 */
export function adoptGuestGame(uid: string): boolean {
  try {
    if (localStorage.getItem(ADOPTED_KEY)) return false;
    if (!localStorage.getItem('rpg-worlds')) return false;
    if (ADOPTED.some((base) => localStorage.getItem(`${base}@${uid}`) !== null)) return false;
    for (const base of ADOPTED) {
      const value = localStorage.getItem(base);
      if (value !== null) localStorage.setItem(`${base}@${uid}`, value);
    }
    localStorage.setItem(ADOPTED_KEY, uid);
    return true;
  } catch {
    return false;
  }
}
