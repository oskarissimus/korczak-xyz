/*
 * The account's keys, in this browser — and the apps' old copies beside them.
 *
 * One localStorage key, `account-keys`, holding `{ apiKeys, openaiCredit, audioGuideWriter,
 * updatedAt, settled }`. A browser that has never saved one starts from whatever the apps left
 * here before the store existed, stamped `updatedAt: 0` — "never edited" — so it loses to any copy
 * the account already holds. That seed is written straight away, and only once it is safely
 * written are the apps' own copies scrubbed: a key must never exist nowhere, even for a moment.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import {
  DEFAULT_ACCOUNT_KEYS,
  anyKey,
  keysFrom,
  normalizeAccountKeys,
  seedKeys,
  shouldSeed,
  stampOf,
  type AccountKeys,
  type KeySource,
  type StampedAccountKeys,
} from './keys';

export const ACCOUNT_KEYS_STORAGE_KEY = 'account-keys';

/*
 * The apps' own localStorage keys, named rather than imported: those modules are theirs, and their
 * spellings never move — `.claude/rules/sloper.md` says why — so a copy here stays right.
 */
const APP_COPIES = ['audio-guide-config', 'backseat-config', 'sloper-config', 'sloper-api-config'];

/** What the apps left in this browser, each with the time its app last saved it. */
export function appCopiesInBrowser(): KeySource[] {
  if (typeof window === 'undefined') return [];
  const sources: KeySource[] = [];
  for (const name of APP_COPIES) {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      sources.push({ keys: keysFrom(parsed), updatedAt: stampOf(parsed) });
    } catch (e) {
      log.warn('accountKeys.seed.read.failed', { source: name, ...describeError(e) });
    }
  }
  return sources;
}

/**
 * Empties the `apiKeys` of every app's copy in this browser, leaving the rest of each config —
 * and its `updatedAt` — exactly as it was, so no app's own sync notices anything happened.
 */
export function scrubAppCopiesInBrowser(): void {
  if (typeof window === 'undefined') return;
  for (const name of APP_COPIES) {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.apiKeys) continue;
      const emptied = Object.fromEntries(Object.keys(parsed.apiKeys).map((k) => [k, null]));
      localStorage.setItem(name, JSON.stringify({ ...parsed, apiKeys: emptied }));
    } catch (e) {
      log.warn('accountKeys.scrub.failed', { source: name, ...describeError(e) });
    }
  }
}

const EMPTY: StampedAccountKeys = { value: DEFAULT_ACCOUNT_KEYS, updatedAt: 0, settled: false };

/** Writes this browser's copy. False when it could not, which the seed has to know. */
export function saveAccountKeys(value: AccountKeys, updatedAt: number, settled: boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(
      ACCOUNT_KEYS_STORAGE_KEY,
      JSON.stringify({ ...value, updatedAt, settled }),
    );
    return true;
  } catch (e) {
    log.warn(
      isQuotaError(e) ? 'accountKeys.save.full' : 'accountKeys.save.failed',
      describeError(e),
    );
    return false;
  }
}

/**
 * This browser's copy, seeded from the apps' copies when it is empty and undecided.
 *
 * Returns the sources it looked at as well, so that the account-side seed can count them too: by
 * then they have been scrubbed from localStorage, and an account holding an empty document must
 * still be able to start from what this browser had.
 */
export function loadAccountKeys(): { stored: StampedAccountKeys; localSources: KeySource[] } {
  if (typeof window === 'undefined') return { stored: EMPTY, localSources: [] };

  let stored = EMPTY;
  try {
    const raw = localStorage.getItem(ACCOUNT_KEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      stored = {
        value: normalizeAccountKeys(parsed),
        updatedAt: stampOf(parsed),
        settled: parsed?.settled === true,
      };
    }
  } catch (e) {
    log.warn('accountKeys.load.failed', describeError(e));
  }

  const localSources = appCopiesInBrowser();
  if (shouldSeed(stored.value.apiKeys, stored.settled)) {
    const seeded = seedKeys(localSources);
    if (anyKey(seeded)) {
      stored = { ...stored, value: { ...stored.value, apiKeys: seeded } };
      // Written before anything is scrubbed, and nothing is scrubbed if it could not be.
      if (saveAccountKeys(stored.value, stored.updatedAt, false)) scrubAppCopiesInBrowser();
      log.info('accountKeys.seed.browser', {
        keys: Object.entries(seeded).filter(([, v]) => v).map(([k]) => k).join(','),
      });
    }
  } else if (localSources.some((source) => anyKey(source.keys))) {
    // The store is already the copy of record here; an app's leftover is just a stale duplicate.
    scrubAppCopiesInBrowser();
  }

  return { stored, localSources };
}
