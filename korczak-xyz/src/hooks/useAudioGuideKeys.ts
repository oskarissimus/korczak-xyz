/*
 * The audio guide's keys and its one provider choice — both the account's now.
 *
 * A thin view over `useAccountKeys`: the shared store holds every key and `audioGuideWriter`, and
 * this picks out what a guide needs. Until Oct 2026 this hook was a whole sync of its own over
 * `users/{uid}/audioGuide/config`, with a borrow from sloper and the backseat driver; that copy
 * seeded the shared store and was emptied. See `utils/accountKeys/keys.ts`.
 */

import { useCallback, useMemo } from 'react';

import type { AudioGuideWriter, KeyName as AccountKeyName } from '../utils/accountKeys/keys';
import type { ApiKeys, KeyName } from '../utils/audioGuide/keys';
import { useAccountKeys, type KeySync } from './useAccountKeys';
import type { AuthUser } from './useAuth';

export type { KeySync };

export interface AudioGuideKeysApi {
  keys: ApiKeys;
  /** False until localStorage has been read; nothing should decide "no keys" before it. */
  ready: boolean;
  sync: KeySync;
  setKey: (name: KeyName, value: string | null) => void;
  setWriter: (writer: AudioGuideWriter) => void;
}

export function useAudioGuideKeys(user: AuthUser | null): AudioGuideKeysApi {
  const account = useAccountKeys(user);
  const { value, setKey: setAccountKey, update } = account;

  const keys = useMemo<ApiKeys>(
    () => ({
      writer: value.audioGuideWriter,
      google: value.apiKeys.google,
      openai: value.apiKeys.openai,
      elevenLabs: value.apiKeys.elevenLabs,
    }),
    [value],
  );

  const setKey = useCallback(
    (name: KeyName, key: string | null) => setAccountKey(name as AccountKeyName, key),
    [setAccountKey],
  );

  const setWriter = useCallback(
    (writer: AudioGuideWriter) => update({ audioGuideWriter: writer }),
    [update],
  );

  return { keys, ready: account.ready, sync: account.sync, setKey, setWriter };
}
