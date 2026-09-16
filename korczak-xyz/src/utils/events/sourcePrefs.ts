/*
 * Which sources this account is still listening to.
 *
 * A data pipeline is tuned by running it, and a source that turns out to be noisy cannot be fixed
 * from a phone at seven in the morning — it is fixed later, in an adapter, with a fixture. What is
 * wanted in the meantime is a way to stop hearing from it that costs one tap and gives everything
 * back when the tuning is done. That is the whole of this file.
 *
 * **It is a per-account preference, not an instruction to the collector.** `events/` is one shared
 * corpus scraped from public pages, and `eventSources/` is the health of the scrape itself — both
 * of them facts about the world rather than about a reader, and neither may change because one
 * account got tired of a feed. So a source switched off here is still fetched, still counted on
 * the Sources tab, and still reports its health; what stops is it reaching *this* account's feed
 * and *this* account's lock screen. Turning it back on is therefore free: nothing was lost while
 * it was off, because nothing stopped being collected.
 *
 * The one thing that is NOT free is being told about the backlog. A month with a source off is a
 * month of rows whose `firstSeenAt` is newer than `armedAt`, and switching it back on with no
 * further care would announce every one of them at once — which is precisely the flood the switch
 * was reached for. So a switch records **when it was last flipped**, and `announceFloor` turns
 * that into a second `armedAt` for this source alone: re-enabling arms it from now, exactly as
 * arming push in the first place arms the account from now. See `isFresh` in `notices.ts`.
 *
 * Default on, and the default is the absence of an entry rather than a row saying `true`. A source
 * added to the catalogue by a later build is therefore on for an account that has never opened the
 * Sources tab, which is the right way round: the catalogue is curated, and the reader who has
 * never expressed an opinion about a source has not expressed a negative one.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { SourceId } from './types';

/** One source's switch: which way it is set, and when it was last flipped. */
export interface SourceSwitch {
  enabled: boolean;
  /**
   * When this switch was last moved.
   *
   * Read only while `enabled` — see `announceFloor`. It is still recorded on the way off, because
   * the two devices' copies of this map are reconciled by which flip happened later, and a flip
   * with no time on it cannot be compared with one that has.
   */
  at: number;
}

/**
 * The switches an account has actually set.
 *
 * Sparse on purpose: an absent id is on, so a fresh account stores nothing at all and a source
 * introduced later needs no migration.
 */
export type SourcePrefs = Partial<Record<SourceId, SourceSwitch>>;

/** Nothing switched off. Named, so callers that genuinely have no prefs say so rather than `{}`. */
export const ALL_SOURCES_ON: SourcePrefs = {};

/**
 * Is this source reaching the reader?
 *
 * Takes a `string` rather than a `SourceId` because every caller has one off an `EventRecord`, and
 * a record written by a build that knew a source this one does not is a row to show rather than a
 * type error.
 */
export function sourceEnabled(prefs: SourcePrefs, id: string): boolean {
  return prefs[id as SourceId]?.enabled ?? true;
}

/** Flip one switch, leaving the rest alone. Pure: the caller stores what comes back. */
export function setSourceEnabled(
  prefs: SourcePrefs,
  id: SourceId,
  enabled: boolean,
  now: number,
): SourcePrefs {
  return { ...prefs, [id]: { enabled, at: now } };
}

/**
 * The ids currently switched off, sorted.
 *
 * Sorted because it is shown — "2 sources off" and the list behind it must not reshuffle between
 * renders — and because it is what the empty feed's hint counts.
 */
export function disabledSourceIds(prefs: SourcePrefs): string[] {
  return Object.keys(prefs)
    .filter((id) => prefs[id as SourceId]?.enabled === false)
    .sort();
}

/**
 * The moment this source's rows start counting as news again.
 *
 * `0` for a source nobody has ever touched, which is no constraint at all. `at` for one switched
 * back on, so the rows collected while it was off are history rather than an announcement —
 * without this, a fortnight off and one tap back on is the flood the switch exists to prevent.
 * `Infinity` while it is off, which is belt and braces: `noticesFor` returns early for a disabled
 * source long before this is asked, and a caller that forgot to would still send nothing.
 */
export function announceFloor(prefs: SourcePrefs, id: string): number {
  const held = prefs[id as SourceId];
  if (!held) return 0;
  return held.enabled ? held.at : Infinity;
}

/**
 * Two devices' switches, reconciled.
 *
 * Per source rather than per document, and by the flip time rather than by a document revision:
 * the phone turning a noisy feed off and the laptop turning a different one off are not a conflict
 * at all, and a whole-document last-writer-wins would quietly undo one of them. This is the same
 * argument the interests made for being one document each, reached from the other side — these are
 * five booleans, not five records, and a collection of five documents to hold them would be five
 * reads on every page load.
 *
 * A dead-heat goes to **off**. It can only happen when two devices flipped the same switch in the
 * same millisecond, and of the two ways to be wrong about that, the quiet one is recoverable by a
 * tap and the loud one is the notification that got the app deleted.
 */
export function mergeSourcePrefs(a: SourcePrefs, b: SourcePrefs): SourcePrefs {
  const out: SourcePrefs = { ...a };
  for (const key of Object.keys(b)) {
    const id = key as SourceId;
    const mine = out[id];
    const theirs = b[id];
    if (!theirs) continue;
    if (!mine || theirs.at > mine.at || (theirs.at === mine.at && !theirs.enabled)) {
      out[id] = theirs;
    }
  }
  return out;
}

/**
 * Whatever localStorage or Firestore handed back, as switches.
 *
 * Every entry is checked rather than trusted, the way every store this app reads back is: this is
 * parsed from a store a previous build wrote and a future one will, and a malformed switch that
 * reads as `enabled: undefined` would silence a source with nothing on the screen saying why.
 *
 * An id this build does not know is **kept**, not dropped. It matches no event, so it does nothing
 * — but a reader who switched a source off, updated to a build that had removed it, and came back
 * to one that had not, would otherwise find it on again with no act of theirs.
 */
export function normalizeSourcePrefs(raw: unknown): SourcePrefs {
  if (!raw || typeof raw !== 'object') return {};
  const out: SourcePrefs = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const { enabled, at } = value as { enabled?: unknown; at?: unknown };
    if (typeof enabled !== 'boolean' || typeof at !== 'number' || !Number.isFinite(at)) continue;
    out[id as SourceId] = { enabled, at };
  }
  return out;
}
