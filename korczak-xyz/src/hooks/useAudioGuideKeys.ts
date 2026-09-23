/*
 * The audio guide's two keys, in this browser and in the account.
 *
 * `useBackseatConfig` with the settings taken out, and deliberately so: the three sync states, the
 * `pulledRef` gate on the push, the account-side borrow running after the three branches rather
 * than inside one, and `settled` being written on purpose are each a bug that app shipped or nearly
 * shipped, and `.claude/rules/backseat.md` has the story of every one. Read that before "tidying"
 * any of them here.
 *
 * The app is behind the account gate, so `user` is always set in practice; `local` exists for the
 * moment between a sign-out and the gate closing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullBorrowableKeys, pullKeys, pushKeys } from '../utils/audioGuide/keyCloud';
import { anyKey, NO_KEYS, shouldBorrow, type ApiKeys } from '../utils/audioGuide/keys';
import { loadKeys, saveKeys } from '../utils/audioGuide/keyStorage';
import type { AuthUser } from './useAuth';

export type KeySync = 'local' | 'syncing' | 'synced' | 'error';

export interface AudioGuideKeysApi {
  keys: ApiKeys;
  /** False until localStorage has been read; nothing should decide "no keys" before it. */
  ready: boolean;
  sync: KeySync;
  /** True while the keys on screen are another app's copies rather than typed here. */
  borrowed: boolean;
  setKey: (name: keyof ApiKeys, value: string | null) => void;
  clear: () => void;
}

export function useAudioGuideKeys(user: AuthUser | null): AudioGuideKeysApi {
  const [keys, setKeys] = useState<ApiKeys>(NO_KEYS);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<KeySync>('local');
  const [borrowed, setBorrowed] = useState(false);

  const keysRef = useRef<ApiKeys>(NO_KEYS);
  const updatedAtRef = useRef(0);
  const settledRef = useRef(false);
  const pulledRef = useRef(false);

  const publish = useCallback((next: ApiKeys, updatedAt: number, settled: boolean) => {
    keysRef.current = next;
    updatedAtRef.current = updatedAt;
    settledRef.current = settled;
    setKeys(next);
    saveKeys(next, updatedAt, settled);
  }, []);

  useEffect(() => {
    const stored = loadKeys();
    keysRef.current = stored.keys;
    updatedAtRef.current = stored.updatedAt;
    settledRef.current = stored.settled;
    setKeys(stored.keys);
    setBorrowed(stored.borrowed);
    setReady(true);
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      pulledRef.current = false;
      setSync('local');
      return;
    }

    let cancelled = false;
    setSync('syncing');

    void (async () => {
      try {
        const remote = await pullKeys(uid);
        if (cancelled) return;

        if (!remote) {
          // First visit on this account: this browser's copy is the only one there is.
          await pushKeys(uid, keysRef.current, updatedAtRef.current || Date.now(), settledRef.current);
        } else if (remote.updatedAt > updatedAtRef.current) {
          publish(remote.keys, remote.updatedAt, remote.settled);
          setBorrowed(false);
        } else if (remote.updatedAt < updatedAtRef.current) {
          await pushKeys(uid, keysRef.current, updatedAtRef.current, settledRef.current);
        }
        if (cancelled) return;

        // After the three branches, asking what the state IS: keyless and undecided? That covers a
        // fresh phone and an empty document the sync itself created. See `useBackseatConfig`.
        if (shouldBorrow(keysRef.current, settledRef.current)) {
          const borrowedKeys = await pullBorrowableKeys(uid);
          if (cancelled) return;
          if (anyKey(borrowedKeys)) {
            const now = Date.now();
            publish(borrowedKeys, now, false);
            setBorrowed(true);
            await pushKeys(uid, borrowedKeys, now, false);
            if (cancelled) return;
          }
        }

        pulledRef.current = true;
        setSync('synced');
      } catch (e) {
        if (cancelled) return;
        // Not fatal: the keys are in localStorage and every tap works from there.
        log.warn('audioGuide.keys.sync.failed', describeError(e));
        setSync('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publish, user]);

  const commit = useCallback(
    (next: ApiKeys) => {
      const now = Date.now();
      // Settled: an edit — clearing included — is somebody deciding what the keys here are.
      publish(next, now, true);
      setBorrowed(false);

      const uid = user?.uid;
      if (!uid || !pulledRef.current) return;
      void pushKeys(uid, next, now, true)
        .then(() => setSync('synced'))
        .catch((e) => {
          log.warn('audioGuide.keys.push.failed', describeError(e));
          setSync('error');
        });
    },
    [publish, user],
  );

  const setKey = useCallback(
    (name: keyof ApiKeys, value: string | null) => commit({ ...keysRef.current, [name]: value }),
    [commit],
  );

  const clear = useCallback(() => commit(NO_KEYS), [commit]);

  return { keys, ready, sync, borrowed, setKey, clear };
}
