/*
 * One collector run: fetch both feeds, archive what arrived, store it, read the metro ones, notify.
 *
 * The order is `fetch → archive → upsert → extract → notify`, and the last two are in that order
 * for the reason the events app puts `classify` before `notify`: `impactOf` escalates an *unread*
 * metro item to route priority, so notifying first would send an uncertain high-priority alert
 * about every communiqué seconds before reading it — and the latch would then stop the correct,
 * quieter alert ever being sent.
 *
 * The archive is written before the upsert, not after, and that is not arbitrary either. It exists
 * to answer "what did the feed actually say" on the run where something went wrong, and a run that
 * dies during the upsert is exactly such a run.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { TransitItem } from '../../../korczak-xyz/src/utils/transit/types';
import { fetchWtpFeeds, type FetchContext } from './wtp';
import { archiveRaw, recordFetch, upsertItems } from './upsert';
import { extractItems, isExtractable, type ExtractOutcome } from './extract';
import { notifyAccount, reportBrokenFeeds } from './notify';
import { listAccounts } from '../notify';

/**
 * How long an item stays in the corpus and the archive.
 *
 * Longer than the feed's own fourteen-day window so nothing the app can draw is missing its raw
 * source. Beyond that the value is nil: a communiqué about a closure two months ago is not
 * something anyone opens, and the archive is the largest thing this app stores.
 */
const RETAIN_DAYS = 45;
/** Deletions per run. A cap, so the first sweep after a long gap cannot eat the run's budget. */
const MAX_SWEEP = 300;

export interface TransitRunSummary {
  fetched: number;
  written: number;
  created: number;
  archived: number;
  extracted: ExtractOutcome;
  accounts: number;
  delivered: number;
  brokenFeeds: string[];
  swept: number;
}

export type TransitRunContext = FetchContext & {
  project?: string;
  location?: string;
};

export async function runTransitCollection(
  db: Firestore,
  ctx: TransitRunContext,
): Promise<TransitRunSummary> {
  const now = ctx.now;

  const outcomes = await fetchWtpFeeds(ctx);

  const parsed: TransitItem[] = [];
  const brokenFeeds: string[] = [];
  let archived = 0;

  for (const outcome of outcomes) {
    if (outcome.raw.length > 0) archived += await archiveRaw(db, outcome.raw);
    parsed.push(...outcome.items);
    if (!outcome.ok) console.error(`transit feed ${outcome.feed} failed`, outcome.error, outcome.bodyHead);
    const { broken } = await recordFetch(db, outcome, now);
    if (broken) brokenFeeds.push(outcome.feed);
  }

  // One feed can legitimately republish an item; last one wins, and deduping here keeps the batch
  // writes honest.
  const unique = [...new Map(parsed.map((item) => [item.id, item])).values()];
  const upserted = await upsertItems(db, unique, now);

  /*
   * The extractor is shown the merged records, and it is shown more than this run fetched.
   *
   * A feed holds only its most recent items, so a communiqué that failed extraction yesterday has
   * scrolled off it and would never be retried from what was just fetched. Reading the metro items
   * back out of the corpus is what makes the queue drain rather than accumulate.
   */
  const backlog = await loadExtractionBacklog(db, now, upserted.items);
  const { items: read, outcome: extracted } = await extractItems(backlog, {
    now,
    project: ctx.project,
    location: ctx.location,
    write: async (id, update) => {
      await db.collection('transitItems').doc(id).update(update);
    },
  });

  /*
   * Notify from the union: what this run fetched, with the freshly read backlog merged over it.
   * The backlog copies are the ones carrying the new readings, so they have to win.
   */
  const byId = new Map(upserted.items.map((item) => [item.id, item]));
  for (const item of read) byId.set(item.id, item);
  const candidates = [...byId.values()];

  const accounts = await listAccounts(db);
  let delivered = 0;
  for (const uid of accounts) {
    const result = await notifyAccount(db, uid, candidates, now);
    delivered += result.delivered;
    if (result.claimed > 0) {
      console.log(`transit notified ${uid}: ${result.claimed} claimed, ${result.delivered} delivered`);
    }
  }

  if (brokenFeeds.length > 0) await reportBrokenFeeds(db, accounts, brokenFeeds);

  const swept = await sweep(db, now);

  return {
    fetched: parsed.length,
    written: upserted.written,
    created: upserted.created,
    archived,
    extracted,
    accounts: accounts.length,
    delivered,
    brokenFeeds,
    swept,
  };
}

/**
 * Every metro item still needing a reading, this run's fetch included.
 *
 * Queried on `publishedAt` alone — a range and an order on the same field, so the automatic
 * single-field index covers it and nothing has to be declared. Filtering on `extractHash` in the
 * query instead would need a composite *and* would silently exclude the never-read items, which are
 * the ones that matter: a Firestore inequality drops documents lacking the field entirely.
 */
async function loadExtractionBacklog(
  db: Firestore,
  now: number,
  fresh: TransitItem[],
): Promise<TransitItem[]> {
  const snap = await db
    .collection('transitItems')
    .where('publishedAt', '>=', now - 14 * 86400000)
    .orderBy('publishedAt', 'desc')
    .limit(400)
    .get();

  const byId = new Map<string, TransitItem>();
  for (const doc of snap.docs) byId.set(doc.id, { ...(doc.data() as TransitItem), id: doc.id });
  // This run's copies are newer than anything the query returned; they win.
  for (const item of fresh) byId.set(item.id, item);

  return [...byId.values()].filter(isExtractable);
}

/** Drop what is past retention, corpus and archive alike, a bounded number per run. */
async function sweep(db: Firestore, now: number): Promise<number> {
  const cutoff = now - RETAIN_DAYS * 86400000;
  let swept = 0;

  for (const collection of ['transitItems', 'transitRaw'] as const) {
    const snap = await db
      .collection(collection)
      .where('publishedAt', '<', cutoff)
      .limit(MAX_SWEEP)
      .get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    swept += snap.size;
  }

  return swept;
}
