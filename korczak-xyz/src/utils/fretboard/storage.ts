/*
 * LocalStorage for the fretboard trainer.
 *
 * The discipline — reporting a failed write rather than swallowing it, and surrendering the
 * oldest answers rather than the deck cache when the store is full — is `createSrsStorage` in
 * `src/utils/srs/storage.ts`, shared with the transposition trainer. What is left here is what is
 * specific to this app: its key prefix, and repairing a `Settings` record written by an older
 * build or by a newer one on another device.
 */

import { storageBytes } from '../../lib/localStorage';
import { createSrsStorage } from '../srs/storage';
import { isDirection, isNotation } from './notes';
import type { Notation } from './notes';
import type { Settings } from './types';
import { DEFAULT_SETTINGS, defaultSettings } from './types';

export type { CurrentSitting } from '../srs/storage';
export { EVENT_CAP, SESSION_CAP } from '../srs/storage';
export { storageBytes };

const store = createSrsStorage('fretboard');

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

// --- settings -------------------------------------------------------------------------------

/**
 * What a record written before the notation became a deck axis meant by `notation`.
 *
 * **Both**, when it said German. The plain card ids that deck is made of never committed to a
 * notation — the setting was display-only and `ReviewEvent.answered` stored international names —
 * so reading them as the international cards they now are is the only reading that keeps every
 * schedule the player earnt. Migrating a German reader to `['german']` alone would put their
 * whole deck out of scope and start them again from nothing; adding German alongside leaves the
 * work intact and lets the German cards arrive as the new material they are.
 */
function migratedNotations(notation: unknown): Notation[] | null {
  if (!isNotation(notation)) return null;
  return notation === 'german' ? ['international', 'german'] : ['international'];
}

/**
 * Fill in what a stored or synced record is missing, and repair what it should not contain.
 *
 * Both ways in need this, which is why it is not inlined in `loadSettings`: the cloud copy is
 * pulled straight out of Firestore on first contact (`useFretboardData`) and used for the rest of
 * that session, so a record repaired only on the way out of localStorage is repaired one page
 * load too late.
 *
 * A record written before a setting existed simply has no key for it, so the spread over the
 * defaults is the migration.
 */
export function sanitizeSettings(
  stored: Partial<Settings> & { notation?: unknown },
  notation: Notation
): Settings {
  const { notation: legacyNotation, ...rest } = stored;
  const merged = { ...defaultSettings(notation), ...rest };
  // A scope with no strings or no directions is an empty deck and a game that cannot start.
  if (!Array.isArray(merged.strings) || merged.strings.length === 0) {
    merged.strings = DEFAULT_SETTINGS.strings;
  }
  // Settings sync between devices, so a direction this build has never heard of can arrive from
  // one that has. Dropping it here is what stops `scopeIds` minting card ids that `parseCardId`
  // will then refuse, which is a sitting with nothing in it.
  merged.directions = Array.isArray(merged.directions)
    ? merged.directions.filter(isDirection)
    : [];
  if (merged.directions.length === 0) {
    merged.directions = DEFAULT_SETTINGS.directions;
  }
  // Read from `rest` rather than `merged`: the defaults always supply a list, so asking the merged
  // record whether it has one would answer yes for every record ever written and the migration
  // below would never run.
  merged.notations = Array.isArray(rest.notations)
    ? [...new Set(rest.notations.filter(isNotation))]
    : (migratedNotations(legacyNotation) ?? []);
  if (merged.notations.length === 0) {
    merged.notations = defaultSettings(notation).notations;
  }
  return merged;
}

export function loadSettings(notation: Notation): Settings {
  return sanitizeSettings(store.readJSON<Partial<Settings>>('settings', {}), notation);
}

export function saveSettings(settings: Settings): void {
  store.writeJSON('settings', settings);
}

