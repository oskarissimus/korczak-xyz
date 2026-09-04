/*
 * Turning a source's RawEvent into a stored document.
 *
 * Two properties this must preserve, and both are load-bearing:
 *
 *   1. `firstSeenAt` is written once and never rewritten. It is what "announced" means — move it
 *      and every event becomes news again.
 *   2. `onSaleSeenAt` is set at the moment a ticket link first appears, because the notice layer
 *      sees only the merged document and cannot tell what changed. This is the only place that
 *      transition is observable.
 */

import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import type { EventRecord, SourceId } from '../../korczak-xyz/src/utils/events/types';
import {
  dayKeyOf,
  eventIdFor,
  fingerprintOf,
  haystackOf,
  synthKey,
} from '../../korczak-xyz/src/utils/events/normalize';
import { distancesOf } from '../../korczak-xyz/src/utils/events/distance';
import type { RawEvent } from './sources/types';

export interface UpsertResult {
  written: number;
  created: number;
  newlyOnSale: number;
  /**
   * What is now stored, merged.
   *
   * Returned because everything downstream needs the *merged* copy rather than the one the source
   * just produced. A fresh `toRecord` carries `firstSeenAt: now` for an event first seen a year
   * ago, has no `onSaleSeenAt`, and knows nothing of the classifier's fields — so a caller working
   * from it re-classifies the whole corpus every run and treats every event as newly announced.
   */
  records: EventRecord[];
}

/** Everything derived, computed in one place so no adapter can get it subtly different. */
export function toRecord(
  raw: RawEvent,
  source: string,
  sourceName: string,
  now: number,
): EventRecord {
  const day = raw.startsAt !== null ? dayKeyOf(raw.startsAt) : null;
  const sourceKey = raw.sourceKey ?? synthKey(raw.title, day, raw.venue);

  return {
    id: eventIdFor(source, sourceKey),
    source: source as SourceId,
    sourceKey,
    sourceName,
    title: raw.title.trim(),
    subtitle: raw.subtitle,
    haystack: haystackOf({
      title: raw.title,
      subtitle: raw.subtitle,
      venue: raw.venue,
      city: raw.city,
      description: raw.description,
    }),
    url: raw.url,
    ticketUrl: raw.ticketUrl,
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    day,
    allDay: raw.allDay,
    dateText: raw.dateText,
    city: raw.city,
    venue: raw.venue,
    country: raw.country,
    tags: raw.tags ?? [],
    /*
     * Derived here with everything else derived, rather than in the running adapter, for the same
     * reason the haystack and the fingerprint are: a second source of races — and the Maraton
     * Warszawski feed already tags itself `running` — would otherwise have to remember to do it,
     * and would get it subtly different.
     */
    distancesM: distancesOf({ title: raw.title, subtitle: raw.subtitle, tags: raw.tags }),
    onSaleAt: raw.onSaleAt,
    fingerprint: fingerprintOf({ title: raw.title, day, city: raw.city }),
    firstSeenAt: now,
    updatedAt: now,
  };
}

/**
 * Merges an incoming record over whatever is stored.
 *
 * Pure, so the two facts above are testable without a database.
 */
export function mergeRecord(
  incoming: EventRecord,
  stored: EventRecord | null,
  now: number,
): { record: EventRecord; created: boolean; newlyOnSale: boolean } {
  if (!stored) {
    // A brand-new event that already has tickets is not an `onsale` transition — there was no
    // "before" in which it had none. Announcing it is the whole story.
    return { record: incoming, created: true, newlyOnSale: false };
  }

  const hadTickets = Boolean(stored.ticketUrl) || stored.onSaleAt !== undefined;
  const hasTickets = Boolean(incoming.ticketUrl) || incoming.onSaleAt !== undefined;
  const newlyOnSale = !hadTickets && hasTickets && stored.onSaleSeenAt === undefined;

  return {
    record: {
      ...stored,
      ...incoming,
      // Never rewritten. This is what "announced" means.
      firstSeenAt: stored.firstSeenAt,
      onSaleSeenAt: newlyOnSale ? now : stored.onSaleSeenAt,
      /*
       * The classifier's fields, carried forward.
       *
       * `batch.set` replaces the whole document and `stripUndefined` drops an absent field, so a
       * field the source has never heard of is *deleted* on the next run unless it is named here.
       * The classifier would then re-answer the same question every six hours, for every event,
       * for ever — which is the one way this feature could cost real money.
       *
       * `country` is the exception, because a source can legitimately know it: an incoming value
       * wins, and the stored one (usually the classifier's) fills in when the source has none.
       */
      country: incoming.country ?? stored.country,
      reach: stored.reach,
      reachReason: stored.reachReason,
      kind: stored.kind,
      kindReason: stored.kindReason,
      classifiedAt: stored.classifiedAt,
      classifyHash: stored.classifyHash,
      updatedAt: now,
    },
    created: false,
    newlyOnSale,
  };
}

/** Firestore rejects an explicit `undefined` rather than treating it as absent. */
export function stripUndefined<T extends object>(value: T): DocumentData {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

export async function upsertEvents(
  db: Firestore,
  records: EventRecord[],
  now: number,
): Promise<UpsertResult> {
  let created = 0;
  let newlyOnSale = 0;
  let written = 0;
  const merged: EventRecord[] = [];

  // Firestore caps a batch at 500 writes, and getAll at a practical few hundred reads.
  const CHUNK = 200;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const refs = chunk.map((r) => db.collection('events').doc(r.id));
    const snapshots = await db.getAll(...refs);

    const batch = db.batch();
    for (let j = 0; j < chunk.length; j++) {
      const stored = snapshots[j].exists ? (snapshots[j].data() as EventRecord) : null;
      const outcome = mergeRecord(chunk[j], stored, now);
      if (outcome.created) created += 1;
      if (outcome.newlyOnSale) newlyOnSale += 1;
      merged.push(outcome.record);
      batch.set(refs[j], stripUndefined(outcome.record));
      written += 1;
    }
    await batch.commit();
  }

  return { written, created, newlyOnSale, records: merged };
}
