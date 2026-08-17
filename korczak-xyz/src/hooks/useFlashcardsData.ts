/*
 * Both decks, and the little the merged app knows for itself.
 *
 * **Composition, not a third copy.** `useFretboardData` and `useTransposeData` are near-duplicates
 * and stay that way: each already runs its own load, its own orphan recovery, its own upload queue
 * and its own pull against its own Firestore collection, and mounting them side by side needs
 * nothing from either. That separation is the reason this merge required no data migration and
 * cannot lose a schedule — the two histories never meet, which is also what keeps the two stats
 * pages honest.
 *
 * What is added here is only what belongs to the *sitting*: which decks it draws from, how long it
 * runs, and one sync badge over two syncs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeError, log } from '../lib/logger';
import { mergeSync } from '../utils/flashcards/sync';
import type { SyncState } from '../utils/flashcards/sync';
import {
  DEFAULT_SETTINGS,
  loadCloudSettings,
  loadSettings,
  sanitizeSettings,
  saveCloudSettings,
  saveSettings,
} from '../utils/flashcards/settings';
import type { Settings } from '../utils/flashcards/settings';
import type { LibraryIndex } from '../utils/transpose/library';
import type { Notation as FretboardNotation } from '../utils/fretboard/notes';
import type { Notation as TransposeNotation } from '../utils/transpose/theory';
import { useFretboardData, type FretboardData } from './useFretboardData';
import { useTransposeData, type TransposeData } from './useTransposeData';
import type { AuthUser } from './useAuth';

export interface FlashcardsData {
  /** Both decks loaded and the merged settings read. Nothing may be drawn before this. */
  ready: boolean;
  settings: Settings;
  updateSettings: (next: Settings) => void;
  fretboard: FretboardData;
  transpose: TransposeData;
  sync: SyncState;
  retrySync: () => void;
}

export function useFlashcardsData(
  user: AuthUser | null,
  defaultNotation: FretboardNotation,
  defaultNotations: TransposeNotation[],
  library: LibraryIndex
): FlashcardsData {
  const fretboard = useFretboardData(user, defaultNotation);
  const transpose = useTransposeData(user, defaultNotations, library);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  // Read in the sync effect, which must not re-run when the settings change.
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const pulledRef = useRef(false);

  const publish = useCallback((next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    publish(loadSettings());
    setLoaded(true);
  }, [publish]);

  const updateSettings = useCallback(
    (next: Settings) => {
      const clean = sanitizeSettings(next);
      saveSettings(clean);
      publish(clean);
      const uid = user?.uid;
      if (uid) void saveCloudSettings(uid, clean).catch(() => {});
    },
    [publish, user?.uid]
  );

  /*
   * First contact on this device. Settings are a preference, so whichever side has one wins
   * outright — there is no work in them to lose, which is the same rule both trainers follow.
   * Through `sanitizeSettings` rather than a bare spread, because this copy is used for the rest of
   * the session: a trainer id this build cannot read has to be dropped here, not one page load
   * later, or the sitting comes up empty and looks like being caught up.
   */
  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !loaded || pulledRef.current) return;
    pulledRef.current = true;
    void (async () => {
      try {
        const cloud = await loadCloudSettings(uid);
        if (cloud) {
          const merged = sanitizeSettings(cloud);
          saveSettings(merged);
          publish(merged);
        } else {
          await saveCloudSettings(uid, settingsRef.current);
        }
      } catch (e) {
        log.warn('flashcards.settings.sync.failed', describeError(e));
      }
    })();
  }, [loaded, publish, user?.uid]);

  useEffect(() => {
    if (!user?.uid) pulledRef.current = false;
  }, [user?.uid]);

  const sync = useMemo(
    () => mergeSync(fretboard.sync, transpose.sync),
    [fretboard.sync, transpose.sync]
  );

  const retrySync = useCallback(() => {
    fretboard.retrySync();
    transpose.retrySync();
  }, [fretboard, transpose]);

  return {
    ready: loaded && fretboard.ready && transpose.ready,
    settings,
    updateSettings,
    fretboard,
    transpose,
    sync,
    retrySync,
  };
}
