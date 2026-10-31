/*
 * The account's API keys as a page may hold them — the one store every app reads.
 *
 * SIGNED OUT, the keys are this browser's own (bring your own key): localStorage `account-keys`,
 * seeded once from the apps' old copies (`storage.ts`), sent with each request by the page.
 *
 * SIGNED IN, the account's keys never reach the page (owner, 31 Oct 2026: "the key should never go
 * from Firebase to the browser"). `users/{uid}/keys/config` is write-only from here — the rules deny
 * every read — so this hook:
 *   - asks the gateway which keys the account has (`/account/keys`: presence and last four
 *     characters) and hands every app `ACCOUNT_KEY` for each, a handle `apiFetch` turns into the
 *     reader's ID token; the gateway puts the real key on the request;
 *   - writes an edit straight into the account with a merge, and keeps nothing of it but the handle
 *     and the hint;
 *   - moves keys typed while signed out into the account on the next sign-in, when they are newer
 *     than the account's copy, and then empties them here — which also clears the copies older
 *     builds left in every browser by syncing the account's keys down.
 * Until the gateway has answered, a key still in this browser is used as the reader's own, so an
 * unreachable gateway does not leave a page with nothing.
 *
 * Mounted once per page. An app's own config hook calls this first, before anything of its own, so
 * that the seed has read the app's localStorage copy before the app's next save strips it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullAccountKeyView, pushAccountKeys, type AccountKeysPatch } from '../utils/accountKeys/cloud';
import {
  ACCOUNT_KEY,
  DEFAULT_ACCOUNT_KEYS,
  NO_HINTS,
  NO_KEYS,
  anyKey,
  keyHint,
  type AccountKeys,
  type AccountKeyView,
  type ApiKeys,
  type KeyHints,
  type KeyName,
} from '../utils/accountKeys/keys';
import {
  clearKeyView,
  loadAccountKeys,
  loadKeyView,
  saveAccountKeys,
  saveKeyView,
} from '../utils/accountKeys/storage';
import type { AuthUser } from './useAuth';

export type KeySync = 'local' | 'syncing' | 'synced' | 'error';

/**
 * One badge for an app whose settings and keys sync separately: the worse of the two, since a key
 * that has not reached the account is the thing the badge exists to say.
 */
export function combineSync(a: KeySync, b: KeySync): KeySync {
  for (const state of ['error', 'syncing', 'local'] as const) {
    if (a === state || b === state) return state;
  }
  return 'synced';
}

export interface AccountKeysApi {
  value: AccountKeys;
  /**
   * The keys: real ones signed out (this browser's own), `ACCOUNT_KEY` handles signed in. Truthy
   * either way where a key exists, which is all an app asks of it.
   */
  keys: ApiKeys;
  /** Signed in: the last four characters of each key the account holds. Never a key. */
  hints: KeyHints;
  /** False until localStorage has been read; nothing should decide "no keys" before it. */
  ready: boolean;
  sync: KeySync;
  setKey: (name: KeyName, value: string | null) => void;
  /** Several keys in one edit — what an app's own form hands over. Unchanged ones are ignored. */
  setKeys: (patch: Partial<ApiKeys>) => void;
  update: (patch: Partial<Omit<AccountKeys, 'apiKeys'>>) => void;
}

export function useAccountKeys(user: AuthUser | null): AccountKeysApi {
  const [value, setValue] = useState<AccountKeys>(DEFAULT_ACCOUNT_KEYS);
  const [hints, setHints] = useState<KeyHints>(NO_HINTS);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<KeySync>('local');
  /** Signed in: whether the account's view (cached or fresh) is what is being shown. */
  const [viewShown, setViewShown] = useState(false);

  const valueRef = useRef<AccountKeys>(DEFAULT_ACCOUNT_KEYS);
  const hintsRef = useRef<KeyHints>(NO_HINTS);
  const localRef = useRef<{ value: AccountKeys; updatedAt: number; settled: boolean }>({
    value: DEFAULT_ACCOUNT_KEYS,
    updatedAt: 0,
    settled: false,
  });
  /** Signed in and the gateway has answered: edits go to the account. */
  const onAccountRef = useRef(false);
  const uidRef = useRef<string | null>(null);

  const show = useCallback((next: AccountKeys, nextHints: KeyHints) => {
    valueRef.current = next;
    hintsRef.current = nextHints;
    setValue(next);
    setHints(nextHints);
  }, []);

  /** This browser's own copy: what a signed-out page uses, and what waits to move into an account. */
  const keepLocal = useCallback((next: AccountKeys, updatedAt: number, settled: boolean) => {
    localRef.current = { value: next, updatedAt, settled };
    saveAccountKeys(next, updatedAt, settled);
  }, []);

  const showAccount = useCallback(
    (uid: string, view: AccountKeyView) => {
      show(view.value, view.hints);
      saveKeyView(uid, view);
    },
    [show],
  );

  useEffect(() => {
    const { stored } = loadAccountKeys();
    localRef.current = stored;
    if (!uidRef.current) show(stored.value, NO_HINTS);
    setReady(true);
  }, [show]);

  useEffect(() => {
    const uid = user?.uid ?? null;
    uidRef.current = uid;
    onAccountRef.current = false;
    if (!uid) {
      clearKeyView();
      show(localRef.current.value, NO_HINTS);
      setSync('local');
      return;
    }

    const controller = new AbortController();
    setSync('syncing');
    // What this page last heard about the account, so the handles are there before the gateway is.
    const cached = loadKeyView(uid);
    setViewShown(Boolean(cached));
    if (cached) show(cached.value, cached.hints);

    void (async () => {
      try {
        let view = await pullAccountKeyView(controller.signal);
        if (controller.signal.aborted) return;
        if (!view) {
          // Firebase is switched off: there is no account to hold anything.
          show(localRef.current.value, NO_HINTS);
          setSync('local');
          return;
        }

        const local = localRef.current;
        if (anyKey(local.value.apiKeys)) {
          // Keys in this browser: typed here signed out (newer than the account's copy → they move
          // in), or left by an older build that synced the account's keys down (not newer → dropped).
          if (local.updatedAt > view.updatedAt) {
            await pushAccountKeys(uid, { apiKeys: local.value.apiKeys }, local.updatedAt);
            if (controller.signal.aborted) return;
            const nextHints = { ...view.hints };
            const apiKeys = { ...view.value.apiKeys };
            for (const name of Object.keys(local.value.apiKeys) as KeyName[]) {
              const key = local.value.apiKeys[name];
              nextHints[name] = keyHint(key);
              apiKeys[name] = key ? ACCOUNT_KEY : null;
            }
            view = { value: { ...view.value, apiKeys }, hints: nextHints, updatedAt: local.updatedAt };
            log.info('accountKeys.moved', {
              keys: Object.entries(local.value.apiKeys).filter(([, v]) => v).map(([k]) => k).join(','),
            });
          }
          // One home for a key: once the account has spoken, none stays in this browser.
          keepLocal({ ...local.value, apiKeys: NO_KEYS }, local.updatedAt, true);
        }

        onAccountRef.current = true;
        showAccount(uid, view);
        setViewShown(true);
        setSync('synced');
      } catch (e) {
        if (controller.signal.aborted) return;
        // Not fatal: a key still in this browser is used as the reader's own until the next try,
        // and a cached view keeps the account's handles working through the gateway.
        log.warn('accountKeys.status.failed', describeError(e));
        if (!cached) show(localRef.current.value, NO_HINTS);
        setSync('error');
      }
    })();

    return () => controller.abort();
  }, [keepLocal, show, showAccount, user]);

  const write = useCallback(
    (patch: AccountKeysPatch, next: AccountKeys, nextHints: KeyHints) => {
      const now = Date.now();
      const uid = uidRef.current;
      if (uid && onAccountRef.current) {
        showAccount(uid, { value: next, hints: nextHints, updatedAt: now });
        setSync('syncing');
        void pushAccountKeys(uid, patch, now)
          .then(() => setSync('synced'))
          .catch((e) => {
            log.warn('accountKeys.push.failed', describeError(e));
            setSync('error');
          });
        return;
      }
      // Signed out, or the account not reached yet: this browser's own copy.
      show(next, NO_HINTS);
      keepLocal(next, now, true);
    },
    [keepLocal, show, showAccount],
  );

  const setKeys = useCallback(
    (patch: Partial<ApiKeys>) => {
      const current = valueRef.current.apiKeys;
      const changed = (Object.keys(patch) as KeyName[]).filter(
        (name) =>
          name in current && patch[name] !== ACCOUNT_KEY && (patch[name] ?? null) !== current[name],
      );
      if (changed.length === 0) return;
      const onAccount = Boolean(uidRef.current && onAccountRef.current);
      const apiKeys = { ...current };
      const nextHints = { ...hintsRef.current };
      const written: Partial<ApiKeys> = {};
      for (const name of changed) {
        const key = patch[name] ?? null;
        written[name] = key;
        apiKeys[name] = key && onAccount ? ACCOUNT_KEY : key;
        nextHints[name] = onAccount ? keyHint(key) : null;
      }
      write({ apiKeys: written }, { ...valueRef.current, apiKeys }, nextHints);
    },
    [write],
  );

  const setKey = useCallback(
    (name: KeyName, key: string | null) => setKeys({ [name]: key }),
    [setKeys],
  );

  const update = useCallback(
    (patch: Partial<Omit<AccountKeys, 'apiKeys'>>) =>
      write(patch, { ...valueRef.current, ...patch }, hintsRef.current),
    [write],
  );

  // Signed in, "no keys" is not decided before the account has been heard from (or remembered).
  const settled = ready && (!user || viewShown || sync !== 'syncing');
  return { value, keys: value.apiKeys, hints, ready: settled, sync, setKey, setKeys, update };
}
