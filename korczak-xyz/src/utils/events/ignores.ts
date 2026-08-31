/*
 * Dismissing one event, and taking it back.
 *
 * The rules for a single `Ignore` row. What an ignore *is* and why it is keyed on the fingerprint
 * is in `types.ts`; what it does to the feed is in `feed.ts` and what it does to notifications is
 * in `notices.ts`.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { EventRecord, Ignore } from './types';
import { slugKey } from './normalize';

/**
 * The document id for an ignore.
 *
 * A pure function of the fingerprint, so the phone and the laptop dismissing the same card converge
 * on one document instead of racing to create two — the argument the sleep log's derived ids make,
 * and the reason `Ignore` needs `versioned.ts`'s causal delete rule rather than the absorbing one.
 */
export function ignoreIdFor(fingerprint: string): string {
  return slugKey(fingerprint);
}

/**
 * Ignore an event, or re-ignore one whose ignore was lifted.
 *
 * One entry point rather than a create and an update, because the id is derived: there is no such
 * thing as "a new ignore" for a fingerprint that has been ignored before, and a caller that minted
 * a fresh row at `rev: 0` would write it straight underneath its own tombstone. `existing` is
 * whatever the local copy holds for this id, tombstone included.
 */
export function ignoreEvent(
  event: Pick<EventRecord, 'fingerprint' | 'title'>,
  existing: Ignore | undefined,
  ctx: { writerId: string; now: number },
): Ignore {
  return {
    id: ignoreIdFor(event.fingerprint),
    rev: existing ? existing.rev + 1 : 0,
    updatedAt: ctx.now,
    writerId: ctx.writerId,
    fingerprint: event.fingerprint,
    title: event.title,
  };
}

/**
 * Take it back.
 *
 * A tombstone and never a `deleteDoc`, for the reason every delete in this app is one: the other
 * device has a live copy, and only a tombstone travels far enough to overwrite it. Un-ignoring is
 * the delete of a row whose *presence* is the state.
 */
export function liftIgnore(ignore: Ignore, ctx: { writerId: string; now: number }): Ignore {
  return { ...ignore, rev: ignore.rev + 1, updatedAt: ctx.now, writerId: ctx.writerId, deleted: true };
}

/**
 * The fingerprints currently ignored.
 *
 * A set rather than a list because both callers ask "is this one?" per event over a corpus of a
 * couple of thousand rows. Tombstones are dropped here and nowhere else, so no caller has to
 * remember that a deleted ignore means a visible event.
 */
export function ignoredFingerprints(ignores: Ignore[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const ignore of ignores) {
    if (!ignore.deleted) out.add(ignore.fingerprint);
  }
  return out;
}

/** Nothing ignored. Named, so the callers that genuinely have no list say so rather than `new Set()`. */
export const NO_IGNORES: ReadonlySet<string> = new Set<string>();
