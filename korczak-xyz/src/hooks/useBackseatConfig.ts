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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { describeError, log } from '../lib/logger';
import { pullConfig, pullSloperKeys, pushConfig } from '../utils/backseat/cloud';
import { DEFAULT_CONFIG } from '../utils/backseat/defaults';
import { anyKey, configWithBorrowedKeys, shouldBorrow } from '../utils/backseat/importKeys';
import { clearConfig, loadConfig, saveConfig } from '../utils/backseat/storage';
import type { BackseatConfig } from '../utils/backseat/types';
import type { AuthUser } from './useAuth';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface BackseatConfigApi {
  config: BackseatConfig;
  /** False until localStorage has been read; nothing should render settings before it. */
  ready: boolean;
  sync: SyncState;
  /**
   * True while the keys on screen are the video generation wizard's rather than ones typed here.
   * The setup sheet says so under the key, and the first edit clears it — from then on they are
   * this app's own copies. See `utils/backseat/importKeys.ts` for what that does and does not mean.
   */
  borrowed: boolean;
  update: (patch: Partial<BackseatConfig>) => void;
  reset: () => void;
}

export function useBackseatConfig(user: AuthUser | null): BackseatConfigApi {
  const [config, setConfig] = useState<BackseatConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>('local');
  const [borrowed, setBorrowed] = useState(false);

  // The current value, readable from a callback that must not depend on the render it was made
  // in — `update` is handed to every control on the sheet and re-creating it on each keystroke
  // would re-render all of them.
  const configRef = useRef<BackseatConfig>(DEFAULT_CONFIG);
  const updatedAtRef = useRef(0);
  const pulledRef = useRef(false);
  /** Whether somebody has decided what the keys here are. See `utils/backseat/importKeys.ts`. */
  const settledRef = useRef(false);

  const publish = useCallback((next: BackseatConfig, updatedAt: number, settled: boolean) => {
    configRef.current = next;
    updatedAtRef.current = updatedAt;
    settledRef.current = settled;
    setConfig(next);
    saveConfig(next, updatedAt, settled);
  }, []);

  // What this browser holds — or, when it has never held anything, what sloper left beside it.
  useEffect(() => {
    const stored = loadConfig();
    configRef.current = stored.config;
    updatedAtRef.current = stored.updatedAt;
    settledRef.current = stored.settled;
    setConfig(stored.config);
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
        const remote = await pullConfig(uid);
        if (cancelled) return;

        if (!remote) {
          // First ride on this account: this browser's copy is the only one there is.
          await pushConfig(
            uid,
            configRef.current,
            updatedAtRef.current || Date.now(),
            settledRef.current,
          );
        } else if (remote.updatedAt > updatedAtRef.current) {
          // The account is ahead. A borrow is something a browser did, so it never survives being
          // replaced by the account's own copy.
          publish(remote.config, remote.updatedAt, remote.settled);
          setBorrowed(false);
        } else if (remote.updatedAt < updatedAtRef.current) {
          // This browser is ahead — typed while signed out, most likely. Send it up.
          await pushConfig(uid, configRef.current, updatedAtRef.current, settledRef.current);
        }

        if (cancelled) return;

        /*
         * THE ACCOUNT-SIDE BORROW, and it runs after the three branches above rather than inside
         * one of them. That placement is the bug this hook shipped with: it used to live in the
         * `!remote` branch alone, so an account holding an empty-but-existing document could never
         * be borrowed into — and the sync itself creates exactly such a document the first time
         * anybody opens the app signed in. Within minutes of going live, every account that had
         * opened the page was in the one state the import could not repair.
         *
         * Here it asks the question the state deserves rather than the question the control flow
         * happened to be in: whatever we have ended up holding, is it keyless and unsettled? That
         * covers a first sign-in on a fresh phone (nothing local to borrow from, wizard keys in the
         * account) and it covers the empty documents already out there.
         *
         * Stamped `Date.now()` rather than 0, unlike the browser-side borrow, because this one has
         * been through the account and is the copy of record from here on.
         */
        if (shouldBorrow(configRef.current, settledRef.current)) {
          const keys = await pullSloperKeys(uid);
          if (cancelled) return;

          if (anyKey(keys)) {
            const borrowedConfig = configWithBorrowedKeys(configRef.current, keys);
            const now = Date.now();
            // Still unsettled: they were borrowed, not decided. The first edit decides them, and
            // until then this stays repairable from the wizard.
            publish(borrowedConfig, now, false);
            setBorrowed(true);
            await pushConfig(uid, borrowedConfig, now, false);
            if (cancelled) return;
          }
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
  }, [publish, user]);

  const update = useCallback(
    (patch: Partial<BackseatConfig>) => {
      const next = { ...configRef.current, ...patch };
      const now = Date.now();
      // Settled: an edit is somebody deciding what the keys here are, and that is what stops a key
      // cleared in this very call being borrowed straight back on the next load.
      publish(next, now, true);
      setBorrowed(false);

      const uid = user?.uid;
      if (!uid || !pulledRef.current) return;

      void pushConfig(uid, next, now, true)
        .then(() => setSync('synced'))
        .catch((e) => {
          log.warn('backseat.config.push.failed', describeError(e));
          setSync('error');
        });
    },
    [publish, user],
  );

  /**
   * Back to the defaults, here and in the account. Deliberately the same edit as any other —
   * clearing the keys must propagate, or a device holding the old copy puts a revoked key back.
   */
  const reset = useCallback(() => {
    clearConfig();
    const now = Date.now();
    /*
     * Settled, which is the whole reason Clear everything sticks: an app that refilled itself from
     * the wizard on the very next reload could not be cleared at all.
     */
    publish(DEFAULT_CONFIG, now, true);
    setBorrowed(false);

    const uid = user?.uid;
    if (!uid || !pulledRef.current) return;

    void pushConfig(uid, DEFAULT_CONFIG, now, true)
      .then(() => setSync('synced'))
      .catch((e) => {
        log.warn('backseat.config.reset.push.failed', describeError(e));
        setSync('error');
      });
  }, [publish, user]);

  return { config, ready, sync, borrowed, update, reset };
}
