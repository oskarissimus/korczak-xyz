/*
 * LocalStorage for the transposition trainer.
 *
 * The discipline — reporting a failed write rather than swallowing it, and surrendering the oldest
 * answers rather than the deck cache when the store is full — is `createSrsStorage` in
 * `src/utils/srs/storage.ts`, shared with the fretboard trainer. Its own instance, so the two decks
 * cannot evict each other's log. What is left here is this app's key prefix and repairing a
 * `Settings` record written by an older build, or by a newer one on another device.
 */

import { createSrsStorage } from '../srs/storage';
import { isDirection, isOrderScope } from './cards';
import { isNotation, isPatternId } from './theory';
import type { Notation, PitchClass } from './theory';
import type { KeyScope, Settings } from './types';
import { DEFAULT_SETTINGS, defaultSettings } from './types';

export type { CurrentSitting } from '../srs/storage';

const store = createSrsStorage('transpose');

export const {
  loadDeckCache,
  saveDeckCache,
  loadEvents,
  saveEvents,
  appendEvents,
  loadCurrent,
  saveCurrent,
  clearCurrent,
  loadSessions,
  saveSessions,
  addSession,
  loadMastery,
  saveMastery,
  loadUnsynced,
  saveUnsynced,
  loadPulledAt,
  savePulledAt,
  clearAll: clearAllData,
} = store;

/** Keep only the values this build knows, and never end up with none. */
function keepKnown<T>(value: unknown, is: (v: unknown) => v is T, fallback: T[]): T[] {
  const kept = Array.isArray(value) ? [...new Set(value.filter(is))] : [];
  return kept.length > 0 ? kept : fallback;
}

function isPitchClass(value: unknown): value is PitchClass {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 12;
}

/**
 * The key scope, which is two words or a list of tonics.
 *
 * Sorted and deduped rather than taken as written, so a list is a *set* of keys however it arrives
 * — the panel builds one by toggling, another device may have built the same one in another order,
 * and two records that mean the same scope should not differ.
 */
function keepKeys(value: unknown): KeyScope {
  if (value === 'all' || value === 'songbook') return value;
  if (Array.isArray(value)) {
    const kept = [...new Set(value.filter(isPitchClass))].sort((a, b) => a - b);
    if (kept.length > 0) return kept;
  }
  return DEFAULT_SETTINGS.keys;
}

/**
 * Fill in what a stored or synced record is missing, and repair what it should not contain.
 *
 * Both ways in need this, which is why it is not inlined in `loadSettings`: the cloud copy is
 * pulled straight out of Firestore on first contact (`useTransposeData`) and used for the rest of
 * that session, so a record repaired only on the way out of localStorage is repaired one page load
 * too late.
 *
 * Settings sync between devices, so a direction, pattern or notation this build has never heard of
 * can arrive from one that has. Dropping it here is what stops `scopeIds` minting card ids that
 * `parseCardId` will then refuse — which is a sitting with nothing in it. A record written before
 * a setting existed simply has no key for it, so the spread over the defaults is the migration.
 *
 * The result is built field by field rather than returned as the merged object, so a key this build
 * no longer has — `sessionLength` and `newPerSession`, which moved to
 * `src/utils/flashcards/settings.ts` — is dropped instead of being carried back to localStorage and
 * pushed to the account for the rest of time.
 */
export function sanitizeSettings(stored: Partial<Settings>, notations: Notation[]): Settings {
  const merged = { ...defaultSettings(notations), ...stored };
  return {
    directions: keepKnown(merged.directions, isDirection, DEFAULT_SETTINGS.directions),
    patterns: keepKnown(merged.patterns, isPatternId, DEFAULT_SETTINGS.patterns),
    keys: keepKeys(merged.keys),
    orders: keepKnown(merged.orders, isOrderScope, DEFAULT_SETTINGS.orders),
    notations: keepKnown(merged.notations, isNotation, notations),
  };
}

export function loadSettings(notations: Notation[]): Settings {
  return sanitizeSettings(store.readJSON<Partial<Settings>>('settings', {}), notations);
}

export function saveSettings(settings: Settings): void {
  store.writeJSON('settings', settings);
}
