/*
 * What the merged app decides for itself, which is only what a *sitting* is.
 *
 * Everything about the material stays with the trainer that owns it: which frets and strings and
 * directions, which patterns and keys and notations. Those are scopes, and a scope belongs to the
 * deck it describes. What cannot belong to either is how long one sitting runs and how many unseen
 * cards it may introduce — a mixed sitting has one length, and the ration of new cards is a ration
 * for the sitting rather than one per deck. So those two moved here, out of both trainers'
 * `Settings`, rather than being duplicated and kept in step.
 *
 * `trainers` is the third: which decks a sitting draws from. It is what is left of the two
 * standalone practice pages — turning one off is how you drill the other alone.
 */

import { createSrsCloud } from '../srs/cloud';
import { createSrsStorage } from '../srs/storage';
import { isTrainerId, TRAINERS, type TrainerId } from './trainers';

export interface Settings {
  /** Which decks a sitting draws from. Empty is not allowed; the UI keeps at least one. */
  trainers: TrainerId[];
  /** How many cards a sitting aims for, before in-session repeats. */
  sessionLength: number;
  /** Ceiling on unseen cards introduced in one sitting, across both decks. */
  newPerSession: number;
}

export const DEFAULT_SETTINGS: Settings = {
  trainers: [...TRAINERS],
  sessionLength: 20,
  newPerSession: 6,
};

/*
 * Both trainers shipped the same 20 / 6, so the migration below only matters to someone who
 * changed one of them — but for that person the alternative is being silently reset. The fretboard
 * is read first because it is the older and larger deck, and therefore the one whose sitting length
 * was more likely to have been deliberately chosen.
 */
const LEGACY_SHAPE_KEYS = ['fretboard-settings', 'transpose-settings'] as const;

interface LegacyShape {
  sessionLength?: unknown;
  newPerSession?: unknown;
}

function positiveInt(value: unknown, min: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : null;
}

/** The sitting shape a previous build stored on one of the two trainers, if either had one. */
function migratedShape(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  for (const key of LEGACY_SHAPE_KEYS) {
    let stored: LegacyShape;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      stored = JSON.parse(raw) as LegacyShape;
    } catch {
      continue;
    }
    const sessionLength = positiveInt(stored.sessionLength, 1);
    const newPerSession = positiveInt(stored.newPerSession, 0);
    if (sessionLength == null && newPerSession == null) continue;
    return {
      ...(sessionLength != null ? { sessionLength } : {}),
      ...(newPerSession != null ? { newPerSession } : {}),
    };
  }
  return {};
}

/**
 * Fill in what a stored or synced record is missing, and repair what it should not contain.
 *
 * Both ways in need it, for the reason each trainer's own `sanitizeSettings` does: the cloud copy
 * is used for the rest of the session, so a trainer id this build cannot read has to be dropped
 * here rather than on the next page load. A record with no readable trainer left would build an
 * empty sitting, which looks exactly like being caught up.
 */
export function sanitizeSettings(
  stored: Partial<Settings>,
  defaults: Partial<Settings> = {}
): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...defaults, ...stored };
  const trainers = Array.isArray(merged.trainers)
    ? [...new Set(merged.trainers.filter(isTrainerId))]
    : [];
  merged.trainers = trainers.length > 0 ? trainers : DEFAULT_SETTINGS.trainers;
  merged.sessionLength =
    positiveInt(merged.sessionLength, 1) ?? DEFAULT_SETTINGS.sessionLength;
  merged.newPerSession =
    positiveInt(merged.newPerSession, 0) ?? DEFAULT_SETTINGS.newPerSession;
  return merged;
}

/*
 * Its own storage instance for the reason the two trainers have theirs: a shared `failingKeys` set
 * and a shared eviction target would let one app's quota trouble reach another's log. This one
 * keeps no deck and no events — only `flashcards-settings` — but the discipline is the same, and
 * going through the factory means the write is reported rather than swallowed.
 */
const store = createSrsStorage('flashcards');

export function loadSettings(): Settings {
  return sanitizeSettings(store.readJSON<Partial<Settings>>('settings', {}), migratedShape());
}

export function saveSettings(settings: Settings): void {
  store.writeJSON('settings', settings);
}

/*
 * The cloud copy, at `users/{uid}/flashcards/settings`. Nothing to deploy — `firestore.rules`
 * already covers everything under `users/{uid}` recursively.
 *
 * `createSrsCloud` also mints a sessions collection, and this app has none: a sitting's answers are
 * pushed by the trainer that owns them, under the ids they always had. `flashcardsSessions` is
 * therefore a name that is never written to, which is the price of having one Firestore wrapper
 * rather than a second one for a single document.
 */
const cloud = createSrsCloud<Settings>(
  'flashcardsSessions',
  ['flashcards', 'settings'],
  'flashcards'
);

export const { loadCloudSettings, saveCloudSettings } = cloud;
