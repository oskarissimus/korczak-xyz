/*
 * What bedtime is aiming at, as opposed to what it did.
 *
 * Every other record in this app is an observation — a sleep that happened, a temperature that was
 * forecast, a routine that ran. This one is the only *intention* in the log: the clock time he is
 * meant to be in the crib by, which is the moment the routine ends and the settling begins. It is
 * not derived from anything and nothing derives from it; it is drawn on the charts so the dots can
 * be read against the goal instead of only against their own mean.
 *
 * ## Why it is synced, and why it is one document
 *
 * It is a household fact, not a viewer's preference. `BabySleepSettings` in `storage.ts` — which
 * window the stats page was last looking at — is genuinely per-device and stays there; a target both
 * parents are working towards is not, and a target that lives in one phone's localStorage is one the
 * other parent's charts silently disagree about. So it takes the shape `climate.ts` and `routine.ts`
 * take: a `Versioned` record reconciled by `versioned.ts`, its own localStorage key, its own push
 * queue, its own collection.
 *
 * Unlike those two it is a **singleton**: one document, `users/{uid}/babySleepTargets/targets`, with
 * a fixed id. There is no occasion to key on — there is one target at a time, and setting a new one
 * supersedes the old one rather than filing a second record beside it. That is why `pickVersioned`
 * is used directly here instead of `mergeById`: with one row, the union by id *is* that one call.
 *
 * ## Clearing a target is a value, never a tombstone
 *
 * `cribMinutes: null` is what "no target" is, and the record stays live. A tombstone would be the
 * wrong shape twice over: the id is fixed, so setting a target again after clearing one necessarily
 * reuses the id of the deleted record, which is exactly the case `versioned.ts` documents as having
 * once made a night unloggable for good. Its causal rule handles that now, but the simpler answer is
 * available here and is taken — there is nothing to delete, only a field to empty.
 *
 * Nothing here reads the clock. `now` is always a parameter.
 */

import { getClientId } from '../../lib/clientId';
import type { Versioned } from './versioned';
import { pickVersioned, sameRevision } from './versioned';

/** The one document's id. Fixed: there is one target at a time, and it is this record. */
export const TARGETS_ID = 'targets';

const MINUTES_PER_DAY = 1440;

export interface SleepTargets extends Versioned {
  id: typeof TARGETS_ID;
  /**
   * Minutes after local midnight he should be in the crib for the night, or null when no target is
   * set. Minutes rather than an epoch, because a target is a time of day and not a moment: it is the
   * same 19:15 every evening, and the same 19:15 in whatever zone the phone happens to be in.
   *
   * The target is deliberately **night-only**, for the reason the routine tiles are: naps are led
   * into at whatever hour the morning worked out to, and a clock target for one would be a number
   * nobody could hit or miss.
   */
  cribMinutes: number | null;
}

/** Whether a number is a readable clock time — a whole minute inside one day. */
export function isClockMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MINUTES_PER_DAY
  );
}

// --- constructing and editing --------------------------------------------------------------------

/**
 * The target, set or cleared.
 *
 * `prev` is whatever the log already holds, so `rev` moves forward and the revision — not the wall
 * clock — decides the merge. Absent it, this is the first target this household has ever set and the
 * record starts at rev 0, which is `setRoutine`'s rule and for its reason.
 */
export function setCribTarget(
  minutes: number | null,
  now: number,
  prev?: SleepTargets | null
): SleepTargets {
  return {
    id: TARGETS_ID,
    cribMinutes: minutes,
    rev: prev != null ? prev.rev + 1 : 0,
    updatedAt: now,
    writerId: getClientId(),
  };
}

/** Whether two copies are the same version of the same values — see `mergeById`'s `sameVersion`. */
export function sameTargets(a: SleepTargets, b: SleepTargets): boolean {
  return sameRevision(a, b) && a.cribMinutes === b.cribMinutes;
}

/**
 * Reconcile this device's copy with the account's. Null on either side is "nothing written there",
 * which the other side wins outright; two live copies go through `pickVersioned` exactly as a row of
 * any other collection here does.
 */
export function mergeTargets(
  local: SleepTargets | null,
  remote: SleepTargets | null
): SleepTargets | null {
  if (!local) return remote;
  if (!remote) return local;
  return pickVersioned(local, remote);
}

/**
 * Coerce an untrusted record — from localStorage written by an older build, or from Firestore — into
 * a `SleepTargets`, or reject it. Returns null rather than throwing, so one bad document leaves the
 * app with no target rather than with no stats page.
 *
 * An **allow-list**, like `normalizeRoutine`: the object is rebuilt field by field, so a field added
 * to `SleepTargets` and not added here is silently stripped on every read and every pull.
 *
 * A `cribMinutes` that is present but unreadable is taken as *no target* rather than rejecting the
 * whole record, so a future build writing a shape this one cannot read still leaves this one a
 * revision to move forward from.
 */
export function normalizeTargets(raw: unknown): SleepTargets | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.id !== TARGETS_ID) return null;
  const rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  return {
    id: TARGETS_ID,
    cribMinutes: isClockMinutes(r.cribMinutes) ? r.cribMinutes : null,
    rev,
    updatedAt:
      typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
    writerId: typeof r.writerId === 'string' ? r.writerId : '',
  };
}
