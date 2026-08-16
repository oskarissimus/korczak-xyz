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
import { isDirection } from './cards';
import { isNotation, isPatternId } from './theory';
import type { Notation } from './theory';
import type { Settings } from './types';
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
 */
export function sanitizeSettings(stored: Partial<Settings>, notations: Notation[]): Settings {
  const merged = { ...defaultSettings(notations), ...stored };
  merged.directions = keepKnown(merged.directions, isDirection, DEFAULT_SETTINGS.directions);
  merged.patterns = keepKnown(merged.patterns, isPatternId, DEFAULT_SETTINGS.patterns);
  merged.notations = keepKnown(merged.notations, isNotation, notations);
  if (merged.keys !== 'all' && merged.keys !== 'songbook') merged.keys = DEFAULT_SETTINGS.keys;
  if (!Number.isFinite(merged.sessionLength) || merged.sessionLength < 1) {
    merged.sessionLength = DEFAULT_SETTINGS.sessionLength;
  }
  if (!Number.isFinite(merged.newPerSession) || merged.newPerSession < 0) {
    merged.newPerSession = DEFAULT_SETTINGS.newPerSession;
  }
  return merged;
}

export function loadSettings(notations: Notation[]): Settings {
  return sanitizeSettings(store.readJSON<Partial<Settings>>('settings', {}), notations);
}

export function saveSettings(settings: Settings): void {
  store.writeJSON('settings', settings);
}
