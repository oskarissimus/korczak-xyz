/*
 * The keys, in this browser.
 *
 * One localStorage key holding `{ apiKeys, updatedAt, settled }` — the backseat driver's shape,
 * minus everything that app has and this one does not. The narration language stays in its own
 * key (`language.ts`), which predates this file and is read by nothing that cares about keys.
 *
 * A browser that has never saved a copy starts from whatever sloper or the backseat driver left
 * beside it, stamped `updatedAt: 0` — "never edited" — so it loses to any copy the account holds.
 * That is the backseat driver's rule and the whole of its conflict resolution.
 */

import { isQuotaError } from '../../lib/localStorage';
import { describeError, log } from '../../lib/logger';
import { anyKey, borrowKeys, keysFrom, shouldBorrow, type ApiKeys, type StampedKeys } from './keys';

export const KEYS_STORAGE_KEY = 'audio-guide-config';

/*
 * The other apps' localStorage keys, named rather than imported: those modules are theirs, and an
 * export that exists only for this app would be a dependency pointing the wrong way. Their
 * spellings never move — `.claude/rules/sloper.md` says why — so a copy here stays right.
 */
const BORROW_FROM = ['sloper-config', 'sloper-api-config', 'backseat-config'];

function keysInBrowser(): ApiKeys {
  const sources: ApiKeys[] = [];
  for (const name of BORROW_FROM) {
    try {
      const raw = localStorage.getItem(name);
      if (raw) sources.push(keysFrom(JSON.parse(raw)));
    } catch (e) {
      // Another app's corrupt config is not this app's to fix, but a silent nothing reads as "the
      // borrow does not work".
      log.warn('audioGuide.keys.borrow.failed', { source: name, ...describeError(e) });
    }
  }
  return borrowKeys(sources);
}

const EMPTY: StampedKeys = {
  keys: { openai: null, elevenLabs: null },
  updatedAt: 0,
  borrowed: false,
  settled: false,
};

export function loadKeys(): StampedKeys {
  if (typeof window === 'undefined') return EMPTY;

  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const keys = keysFrom(parsed);
    const settled = parsed?.settled === true;
    const updatedAt = typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0;

    if (shouldBorrow(keys, settled)) {
      const borrowed = keysInBrowser();
      if (anyKey(borrowed)) {
        return { keys: borrowed, updatedAt: 0, borrowed: true, settled: false };
      }
    }
    return { keys, updatedAt, borrowed: false, settled };
  } catch (e) {
    log.warn('audioGuide.keys.load.failed', describeError(e));
    return EMPTY;
  }
}

export function saveKeys(keys: ApiKeys, updatedAt: number, settled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify({ apiKeys: keys, updatedAt, settled }));
  } catch (e) {
    // A silent failure here is what makes a key "not stick" after a reload.
    log.warn(
      isQuotaError(e) ? 'audioGuide.keys.save.full' : 'audioGuide.keys.save.failed',
      describeError(e),
    );
  }
}
