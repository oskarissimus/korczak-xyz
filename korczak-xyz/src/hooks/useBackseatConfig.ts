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
import { pullConfig, pushConfig } from '../utils/backseat/cloud';
import { DEFAULT_CONFIG } from '../utils/backseat/defaults';
import { clearConfig, loadConfig, saveConfig } from '../utils/backseat/storage';
import type { BackseatConfig } from '../utils/backseat/types';
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

export function useBackseatConfig(user: AuthUser | null): BackseatConfigApi {
  const [config, setConfig] = useState<BackseatConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncState>('local');

  // The current value, readable from a callback that must not depend on the render it was made
  // in — `update` is handed to every control on the sheet and re-creating it on each keystroke
  // would re-render all of them.
  const configRef = useRef<BackseatConfig>(DEFAULT_CONFIG);
  const updatedAtRef = useRef(0);
  const pulledRef = useRef(false);

  const publish = useCallback((next: BackseatConfig, updatedAt: number) => {
    configRef.current = next;
    updatedAtRef.current = updatedAt;
    setConfig(next);
    saveConfig(next, updatedAt);
  }, []);

  // What this browser holds, before anything asks the network.
  useEffect(() => {
    const stored = loadConfig();
    configRef.current = stored.config;
    updatedAtRef.current = stored.updatedAt;
    setConfig(stored.config);
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
          await pushConfig(uid, configRef.current, updatedAtRef.current || Date.now());
        } else if (remote.updatedAt > updatedAtRef.current) {
          publish(remote.config, remote.updatedAt);
        } else if (remote.updatedAt < updatedAtRef.current) {
          // This browser is ahead — typed while signed out, most likely. Send it up.
          await pushConfig(uid, configRef.current, updatedAtRef.current);
        }

        if (cancelled) return;
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
      publish(next, now);

      const uid = user?.uid;
      if (!uid || !pulledRef.current) return;

      void pushConfig(uid, next, now)
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
    publish(DEFAULT_CONFIG, now);

    const uid = user?.uid;
    if (!uid || !pulledRef.current) return;

    void pushConfig(uid, DEFAULT_CONFIG, now)
      .then(() => setSync('synced'))
      .catch((e) => {
        log.warn('backseat.config.reset.push.failed', describeError(e));
        setSync('error');
      });
  }, [publish, user]);

  return { config, ready, sync, update, reset };
}
