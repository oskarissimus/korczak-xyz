/*
 * Whether this account is allowed in, and the panel that decides it.
 *
 * Until September 2026 the answer was always yes: sign-up was disabled at the Identity Platform
 * level, so an account existed only because the owner had made one by hand, and holding a token
 * was the same thing as being welcome. Self-service sign-up ends that. `accounts/{uid}` is the row
 * that replaces it — one document per account, holding one verdict — and `firestore.rules` and
 * `storage.rules` both read it before granting anything at all.
 *
 * THREE PROPERTIES OF THIS MODULE WORTH KNOWING BEFORE CHANGING IT:
 *
 *   1. **It is not the gate.** Everything here can be bypassed by anyone willing to open a
 *      console: it is a browser. What stops an unapproved account is the two rules files. This
 *      module exists so that the person sees one honest sentence instead of a wall of
 *      `permission-denied`, and so the owner has something to click.
 *
 *   2. **One watcher, however many callers.** `useAuth` is mounted by a dozen components and more
 *      than one of them can be on a page at once. A `onSnapshot` per hook instance would be a
 *      listener per component for a document that is the same for all of them, so the
 *      subscription is module-level and the hooks are subscribers to a small store. A live
 *      listener rather than a one-off read because approval should land on the waiting person's
 *      screen while they are looking at it, which is the difference between "reload and see" and
 *      a screen that simply changes.
 *
 *   3. **The subject writes their own row, and can say nothing interesting in it.** `ensureAccount`
 *      creates it on first sign-in because only the browser is present for every way an account
 *      can appear — the form, the Identity Platform console, a provider link. The rules pin every
 *      field it may write to something already in the caller's token, so the worst it can produce
 *      is "this is my address and I am not approved".
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { getDb } from './firebase';
import { runCloud } from './firestoreHealth';
import { describeError, log } from './logger';

/** The signed-in identity this module needs, which is less than a Firebase `User`. */
export interface AccountIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface AccountRecord {
  uid: string;
  /** Lowercased, and equal to the address in the account's own token — the rules check it. */
  email: string;
  /** A mirror of the token's `email_verified`, so the panel can see somebody else's. */
  emailVerified: boolean;
  /** The verdict. False until the owner says otherwise, and the only thing that opens anything. */
  approved: boolean;
  /** Admin override: this address may be used for a household share although it is unverified. */
  emailTrusted: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface AccountState {
  /** False until the first answer for the current uid is in. Nothing may be decided before it. */
  resolved: boolean;
  uid: string | null;
  /** Null both when signed out and when the row is not there yet — `resolved` tells them apart. */
  record: AccountRecord | null;
  /** The read failed. Treated exactly as "not approved", but worth saying on screen. */
  error: string | null;
}

const SIGNED_OUT: AccountState = { resolved: true, uid: null, record: null, error: null };

let state: AccountState = { resolved: false, uid: null, record: null, error: null };
let activeUid: string | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<(s: AccountState) => void>();

/** Guards against a second create while the first is in flight, and against a create loop. */
let ensuring: string | null = null;
/** The uid whose mirror has already been refreshed this page load. */
let mirrored: string | null = null;

function publish(next: AccountState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getAccountState(): AccountState {
  return state;
}

export function subscribeAccountState(listener: (s: AccountState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function normalize(uid: string, raw: unknown): AccountRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    uid,
    email: typeof r.email === 'string' ? r.email : '',
    // Anything that is not literally `true` is false: a row missing the field, or holding a
    // string somebody put there by hand, must not read as a yes.
    emailVerified: r.emailVerified === true,
    approved: r.approved === true,
    emailTrusted: r.emailTrusted === true,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    lastSeenAt: typeof r.lastSeenAt === 'number' && Number.isFinite(r.lastSeenAt) ? r.lastSeenAt : null,
  };
}

function accountsCollection() {
  return collection(getDb()!, 'accounts');
}

export function accountEmailOf(identity: AccountIdentity): string {
  return (identity.email ?? '').trim().toLowerCase();
}

/**
 * Put this account in front of the owner.
 *
 * Creating the row is not being admitted — `approved` is false and the rules refuse any other
 * value from the subject. It is how an account becomes *visible*: without it the panel has nothing
 * to list, and somebody who signed up would be waiting on a decision nobody had been asked to
 * make.
 */
async function ensureAccount(identity: AccountIdentity): Promise<void> {
  if (!getDb() || ensuring === identity.uid) return;
  ensuring = identity.uid;
  try {
    await runCloud('account.ensure', () =>
      setDoc(doc(accountsCollection(), identity.uid), {
        email: accountEmailOf(identity),
        emailVerified: identity.emailVerified === true,
        approved: false,
        emailTrusted: false,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    );
    log.info('account.created', { uid: identity.uid });
  } catch (e) {
    log.warn('account.create.failed', describeError(e));
  } finally {
    ensuring = null;
  }
}

/**
 * Keep the row's copy of the token honest, and record that this account is still turning up.
 *
 * The verification flag is the one that matters: it lives in the token, the panel cannot read
 * anybody's token but its own, and an address that gets verified after the fact would otherwise
 * show as unverified for ever. Once per page load, and only when something actually differs — a
 * write on every mount would be a write every time a component remounts.
 */
async function refreshMirror(identity: AccountIdentity, record: AccountRecord): Promise<void> {
  if (!getDb() || mirrored === identity.uid) return;
  mirrored = identity.uid;

  const email = accountEmailOf(identity);
  const verified = identity.emailVerified === true;
  const stale = record.email !== email || record.emailVerified !== verified;
  // A "last seen" that rewrites itself on every page load is a document written a hundred times a
  // day to answer a question asked once a month. A day's resolution is all the panel shows.
  const aged = record.lastSeenAt === null || Date.now() - record.lastSeenAt > 12 * 60 * 60 * 1000;
  if (!stale && !aged) return;

  try {
    await runCloud('account.mirror', () =>
      updateDoc(doc(accountsCollection(), identity.uid), {
        email,
        emailVerified: verified,
        lastSeenAt: Date.now(),
      })
    );
  } catch (e) {
    // Nothing on screen depends on this having worked. The rules can also legitimately refuse it:
    // a token whose address no longer matches the row is exactly what they are there to stop.
    log.warn('account.mirror.failed', describeError(e));
  }
}

/**
 * Point the watcher at a uid, or at nobody. Idempotent for the same uid, because every mounted
 * `useAuth` calls it with the same answer.
 */
export function watchAccount(identity: AccountIdentity | null): void {
  const uid = identity?.uid ?? null;
  if (uid === activeUid && (unsubscribe !== null || uid === null)) return;

  unsubscribe?.();
  unsubscribe = null;
  activeUid = uid;

  if (!identity) {
    mirrored = null;
    publish(SIGNED_OUT);
    return;
  }

  if (!getDb()) {
    // Firebase off, or the client is being replaced. Either way nothing can be approved, and
    // saying "resolved, no row" lets the UI render the honest thing rather than a spinner.
    publish({ resolved: true, uid: identity.uid, record: null, error: null });
    return;
  }

  publish({ resolved: false, uid: identity.uid, record: null, error: null });

  unsubscribe = onSnapshot(
    doc(accountsCollection(), identity.uid),
    (snap) => {
      // A snapshot that arrives after a sign-out, or after a different account signed in, belongs
      // to a question nobody is asking any more.
      if (activeUid !== identity.uid) return;
      if (!snap.exists()) {
        publish({ resolved: true, uid: identity.uid, record: null, error: null });
        void ensureAccount(identity);
        return;
      }
      const record = normalize(identity.uid, snap.data());
      publish({ resolved: true, uid: identity.uid, record, error: null });
      if (record) void refreshMirror(identity, record);
    },
    (e) => {
      if (activeUid !== identity.uid) return;
      log.warn('account.watch.failed', describeError(e));
      publish({
        resolved: true,
        uid: identity.uid,
        record: null,
        error: String(describeError(e).message ?? 'could not read the account'),
      });
    }
  );
}

/*
 * Is this account one of the admins?
 *
 * `admins/{uid}` is writable by nobody — see `firestore.rules` — so this is a read of a list that
 * only a console can change. Cached per uid for the life of the page: a dozen `useAuth` instances
 * asking the same question is a dozen reads of a document that cannot have changed in between.
 */
const adminAnswers = new Map<string, Promise<boolean>>();

export function loadIsAdmin(uid: string): Promise<boolean> {
  const cached = adminAnswers.get(uid);
  if (cached) return cached;

  const answer = (async () => {
    if (!getDb()) return false;
    try {
      const snap = await runCloud('account.admin.check', () => getDoc(doc(getDb()!, 'admins', uid)));
      return snap.exists();
    } catch (e) {
      // A failed read is not an admin. The panel is a page you can reach by typing its address,
      // and this is what decides whether it shows anything — "could not tell" must mean no.
      log.warn('account.admin.check.failed', describeError(e));
      return false;
    }
  })();

  adminAnswers.set(uid, answer);
  return answer;
}

/* ── The panel's own calls. Every one of them is refused by the rules for anybody who is not in
 *    `admins/`, so the checks the panel makes before calling are about what it draws, not about
 *    what it is allowed to do. ─────────────────────────────────────────────────────────────── */

/** Every account there is, newest first — the order a decision queue wants to be read in. */
export async function listAccounts(): Promise<AccountRecord[]> {
  if (!getDb()) return [];
  const snap = await runCloud('account.list', () => getDocs(accountsCollection()));
  const accounts: AccountRecord[] = [];
  for (const document of snap.docs) {
    const record = normalize(document.id, document.data());
    if (record) accounts.push(record);
  }
  return accounts.sort((a, b) => b.createdAt - a.createdAt);
}

/** Let somebody in, or put them back outside. Both directions bite on their next query. */
export async function setApproved(uid: string, approved: boolean): Promise<void> {
  if (!getDb()) return;
  await runCloud('account.approve', () =>
    updateDoc(doc(accountsCollection(), uid), { approved })
  );
  log.info('account.approval.set', { uid, approved });
}

/**
 * Vouch for an address the provider never verified.
 *
 * Only the household share consults it — see `trustedEmail()` in `firestore.rules`. It exists for
 * the accounts made by hand in the console, where no verification mail is ever sent; for anybody
 * who signed up through the site the verification mail is the better answer and this should stay
 * off.
 */
export async function setEmailTrusted(uid: string, emailTrusted: boolean): Promise<void> {
  if (!getDb()) return;
  await runCloud('account.trust', () =>
    updateDoc(doc(accountsCollection(), uid), { emailTrusted })
  );
  log.info('account.trust.set', { uid, emailTrusted });
}

/**
 * Forget a decision entirely.
 *
 * The Identity Platform account survives this — deleting that is a console job — so the person can
 * still sign in, and their next sign-in writes the row back as pending. That is the intended shape:
 * this clears the queue, it does not ban anybody.
 */
export async function removeAccount(uid: string): Promise<void> {
  if (!getDb()) return;
  await runCloud('account.remove', () => deleteDoc(doc(accountsCollection(), uid)));
  log.info('account.removed', { uid });
}
