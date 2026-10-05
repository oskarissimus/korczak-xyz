/*
 * The settings, and where they live.
 *
 * The same three states sloper has, badged the same way on the settings sheet, because they answer
 * the same question about the same kind of secret:
 *
 *   local    signed out. Everything works; the keys are in this browser and nowhere else.
 *   syncing  signed in, the account's copy has not come back yet. Edits are still accepted — they
 *            go to localStorage immediately and are pushed once the pull has settled.
 *   synced   signed in and settled. Every edit is written to both.
 *
 * Two details of the pull-versus-local question are worth having here rather than in cloud.ts:
 *
 *  - A pull that finds no document at all is not "the account has no config". It is a first ride
 *    on this account, and what this browser holds is the only copy — so it is pushed up rather
 *    than replaced by the defaults.
 *  - `pulledRef` gates the push, not `user`. Pushing before the pull has answered races the
 *    account's own copy with whatever this browser happened to have, and the edit that loses is
 *    the one somebody just typed.
 *
 * THE KEYS ARE NOT IN HERE ANY MORE. Since Oct 2026 they are the account's (`useAccountKeys`,
 * `users/{uid}/keys/config`), one copy shared with every app and shown on the account page; the
 * borrow from sloper that used to live here has nothing left to do. This hook lays the shared keys
 * over `config.apiKeys` on the way out and routes an `apiKeys` patch there on the way in, and what
 * it saves has its keys emptied. The account hook is called first, deliberately: its seed reads
 * this app's old localStorage copy before this hook's next save empties it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullConfig, pushConfig } from '../utils/backseat/cloud';
import { defaultConfigFor } from '../utils/backseat/defaults';
import { BACKSEAT, type Flavour } from '../utils/backseat/flavour';
import { switchedToGoogle } from '../utils/backseat/importKeys';
import { clearConfig, loadConfig, saveConfig } from '../utils/backseat/storage';
import type { BackseatConfig } from '../utils/backseat/types';
import { combineSync, useAccountKeys } from './useAccountKeys';
import type { AuthUser } from './useAuth';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface BackseatConfigApi {
  config: BackseatConfig;
  /** False until localStorage has been read; nothing should render settings before it. */
  ready: boolean;
  sync: SyncState;
  update: (patch: Partial<BackseatConfig>) => void;
  reset: () => void;
}

export function useBackseatConfig(
  user: AuthUser | null,
  /** Which app's settings: the passenger's, or the roaster's own document beside them. */
  flavour: Flavour = BACKSEAT,
): BackseatConfigApi {
  // First, before anything of this hook's own — see the header.
  const account = useAccountKeys(user);
  const accountGoogleRef = useRef<string | null>(null);
  accountGoogleRef.current = account.keys.google;

  const defaults = useMemo(() => defaultConfigFor(flavour), [flavour]);
  const [config, setConfig] = useState<BackseatConfig>(defaults);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>('local');

  // The current value, readable from a callback that must not depend on the render it was made
  // in — `update` is handed to every control on the sheet and re-creating it on each keystroke
  // would re-render all of them.
  const configRef = useRef<BackseatConfig>(defaults);
  const updatedAtRef = useRef(0);
  const pulledRef = useRef(false);
  /** Whether somebody has decided what the settings here are. See `utils/backseat/storage.ts`. */
  const settledRef = useRef(false);

  const publish = useCallback((next: BackseatConfig, updatedAt: number, settled: boolean) => {
    configRef.current = next;
    updatedAtRef.current = updatedAt;
    settledRef.current = settled;
    setConfig(next);
    saveConfig(next, updatedAt, settled, flavour);
  }, [flavour]);

  // What this browser holds.
  useEffect(() => {
    const stored = loadConfig(flavour);
    configRef.current = stored.config;
    updatedAtRef.current = stored.updatedAt;
    settledRef.current = stored.settled;
    setConfig(stored.config);
    setReady(true);
  }, [flavour]);

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
        const remote = await pullConfig(uid, flavour);
        if (cancelled) return;

        if (!remote) {
          // First ride on this account: this browser's copy is the only one there is.
          await pushConfig(
            uid,
            configRef.current,
            updatedAtRef.current || Date.now(),
            settledRef.current,
            flavour,
          );
        } else if (remote.updatedAt > updatedAtRef.current) {
          publish(remote.config, remote.updatedAt, remote.settled);
        } else if (remote.updatedAt < updatedAtRef.current) {
          // This browser is ahead — typed while signed out, most likely. Send it up.
          await pushConfig(uid, configRef.current, updatedAtRef.current, settledRef.current, flavour);
        }

        if (cancelled) return;

        // The one-time move off OpenAI, for a config saved before Google was the default, with
        // the account's Google key. See `switchedToGoogle`.
        // The passenger's alone: the roaster was born on Google and has no OpenAI past.
        const switched = flavour.id === 'backseat' && switchedToGoogle(
          { ...configRef.current, apiKeys: { ...configRef.current.apiKeys, google: accountGoogleRef.current } },
          updatedAtRef.current,
          null,
        );
        if (switched) {
          const now = Date.now();
          publish(switched, now, settledRef.current);
          await pushConfig(uid, switched, now, settledRef.current, flavour);
          if (cancelled) return;
        }

        pulledRef.current = true;
        setSync('synced');
      } catch (e) {
        if (cancelled) return;
        // Not fatal: the settings are in localStorage and every provider call works from there.
        // The badge says so, and the next edit tries again.
        log.warn('backseat.config.sync.failed', describeError(e));
        setSync('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flavour, publish, user]);

  const { setKeys } = account;
  const update = useCallback(
    (fullPatch: Partial<BackseatConfig>) => {
      const { apiKeys, ...patch } = fullPatch;
      if (apiKeys) setKeys(apiKeys);
      if (Object.keys(patch).length === 0) return;

      const next = { ...configRef.current, ...patch };
      const now = Date.now();
      publish(next, now, true);

      const uid = user?.uid;
      if (!uid || !pulledRef.current) return;

      void pushConfig(uid, next, now, true, flavour)
        .then(() => setSync('synced'))
        .catch((e) => {
          log.warn('backseat.config.push.failed', describeError(e));
          setSync('error');
        });
    },
    [flavour, publish, setKeys, user],
  );

  /**
   * The settings back to their defaults, here and in the account. The keys are not touched: they
   * are shared with the other apps now, and clearing one is done on the account page.
   */
  const reset = useCallback(() => {
    clearConfig(flavour);
    const now = Date.now();
    publish(defaults, now, true);

    const uid = user?.uid;
    if (!uid || !pulledRef.current) return;

    void pushConfig(uid, defaults, now, true, flavour)
      .then(() => setSync('synced'))
      .catch((e) => {
        log.warn('backseat.config.reset.push.failed', describeError(e));
        setSync('error');
      });
  }, [defaults, flavour, publish, user]);

  const accountKeys = account.keys;
  const merged = useMemo<BackseatConfig>(
    () => ({
      ...config,
      apiKeys: {
        openai: accountKeys.openai,
        google: accountKeys.google,
        elevenLabs: accountKeys.elevenLabs,
      },
    }),
    [config, accountKeys],
  );

  return {
    config: merged,
    ready: ready && account.ready,
    sync: combineSync(sync, account.sync),
    update,
    reset,
  };
}
