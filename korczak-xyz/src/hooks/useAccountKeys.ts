/*
 * The account's API keys, in this browser and in the account — the one store every app reads.
 *
 * The sync is `useAudioGuideKeys`'s as it was, and that was `useBackseatConfig`'s with the settings
 * taken out: three sync states, the `pulledRef` gate on the push, the account-side seed running
 * after the three branches rather than inside one, and `settled` written on purpose. Each of those
 * is a bug one of those apps shipped or nearly shipped, and `.claude/rules/backseat.md` has the
 * story of every one. Read that before "tidying" any of them here.
 *
 * What is new is where a first visit starts from. The store did not exist before Oct 2026, so a
 * browser — or an account — that has never saved one is seeded from the copies the apps kept
 * themselves, per key, newest first (`seedKeys`), and those copies are then emptied so that one
 * key has one home. See `utils/accountKeys/keys.ts`.
 *
 * Mounted once per page. An app's own config hook calls this first, before anything of its own, so
 * that the seed has read the app's localStorage copy before the app's next save strips it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import {
  pullAccountKeys,
  pullAppCopies,
  pushAccountKeys,
  scrubAppCopies,
} from '../utils/accountKeys/cloud';
import {
  DEFAULT_ACCOUNT_KEYS,
  anyKey,
  seedKeys,
  shouldSeed,
  type AccountKeys,
  type ApiKeys,
  type KeyName,
  type KeySource,
} from '../utils/accountKeys/keys';
import { loadAccountKeys, saveAccountKeys } from '../utils/accountKeys/storage';
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
  keys: ApiKeys;
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
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<KeySync>('local');

  const valueRef = useRef<AccountKeys>(DEFAULT_ACCOUNT_KEYS);
  const updatedAtRef = useRef(0);
  const settledRef = useRef(false);
  const pulledRef = useRef(false);
  /** What the apps had left in this browser at mount, before the seed scrubbed it. */
  const localSourcesRef = useRef<KeySource[]>([]);

  const publish = useCallback((next: AccountKeys, updatedAt: number, settled: boolean) => {
    valueRef.current = next;
    updatedAtRef.current = updatedAt;
    settledRef.current = settled;
    setValue(next);
    saveAccountKeys(next, updatedAt, settled);
  }, []);

  useEffect(() => {
    const { stored, localSources } = loadAccountKeys();
    localSourcesRef.current = localSources;
    valueRef.current = stored.value;
    updatedAtRef.current = stored.updatedAt;
    settledRef.current = stored.settled;
    setValue(stored.value);
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
        const remote = await pullAccountKeys(uid);
        if (cancelled) return;

        if (!remote) {
          // First visit on this account: this browser's copy is the only one there is.
          await pushAccountKeys(
            uid,
            valueRef.current,
            updatedAtRef.current || Date.now(),
            settledRef.current,
          );
        } else if (remote.updatedAt > updatedAtRef.current) {
          publish(remote.value, remote.updatedAt, remote.settled);
        } else if (remote.updatedAt < updatedAtRef.current) {
          await pushAccountKeys(uid, valueRef.current, updatedAtRef.current, settledRef.current);
        }
        if (cancelled) return;

        // After the three branches, asking what the state IS: keyless and undecided? That covers a
        // fresh phone and an empty document the sync itself created. See `useBackseatConfig`.
        if (shouldSeed(valueRef.current.apiKeys, settledRef.current)) {
          const copies = await pullAppCopies(uid);
          if (cancelled) return;
          const seeded = seedKeys([...localSourcesRef.current, ...copies.map((c) => c.source)]);
          if (anyKey(seeded)) {
            const now = Date.now();
            // Still unsettled: they were found, not decided. The first edit decides them.
            const next = { ...valueRef.current, apiKeys: seeded };
            publish(next, now, false);
            await pushAccountKeys(uid, next, now, false);
            if (cancelled) return;
            log.info('accountKeys.seed.account', {
              keys: Object.entries(seeded).filter(([, v]) => v).map(([k]) => k).join(','),
            });
            // Only now that the account holds them: one key, one home.
            await scrubAppCopies(uid, copies);
            if (cancelled) return;
          }
        }

        pulledRef.current = true;
        setSync('synced');
      } catch (e) {
        if (cancelled) return;
        // Not fatal: the keys are in localStorage and every app works from there.
        log.warn('accountKeys.sync.failed', describeError(e));
        setSync('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publish, user]);

  const commit = useCallback(
    (next: AccountKeys) => {
      const now = Date.now();
      // Settled: an edit — clearing included — is somebody deciding what the keys here are.
      publish(next, now, true);

      const uid = user?.uid;
      if (!uid || !pulledRef.current) return;
      void pushAccountKeys(uid, next, now, true)
        .then(() => setSync('synced'))
        .catch((e) => {
          log.warn('accountKeys.push.failed', describeError(e));
          setSync('error');
        });
    },
    [publish, user],
  );

  const setKeys = useCallback(
    (patch: Partial<ApiKeys>) => {
      const current = valueRef.current.apiKeys;
      const changed = (Object.keys(patch) as KeyName[]).filter(
        (name) => name in current && (patch[name] ?? null) !== current[name],
      );
      if (changed.length === 0) return;
      const apiKeys = { ...current };
      for (const name of changed) apiKeys[name] = patch[name] ?? null;
      commit({ ...valueRef.current, apiKeys });
    },
    [commit],
  );

  const setKey = useCallback(
    (name: KeyName, key: string | null) => setKeys({ [name]: key }),
    [setKeys],
  );

  const update = useCallback(
    (patch: Partial<Omit<AccountKeys, 'apiKeys'>>) => commit({ ...valueRef.current, ...patch }),
    [commit],
  );

  return { value, keys: value.apiKeys, ready, sync, setKey, setKeys, update };
}
