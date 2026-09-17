/*
 * Writing what the feeds said, and keeping what the reading of it cost.
 *
 * Two collections, written together:
 *
 *   - `transitItems` is the parsed corpus. Merged rather than replaced, because a communiqué is
 *     edited in place and the merge is what keeps `firstSeenAt` — which is what `armedAt` is
 *     compared against, and therefore what stands between arming alerts and a fortnight of metro
 *     history arriving at once.
 *   - `transitRaw` is every item exactly as it arrived, parsed or not. Kept because a reading that
 *     goes wrong is only debuggable against the thing that was read.
 *
 * The `batch.set` trap the events app documents applies here too and is sharper: a full `set` drops
 * any field not named in the merged object, so an extraction that cost a model call would be
 * deleted by the next fetch of an unchanged feed — and then paid for again, every ten minutes, for
 * ever. `mergeItem` names every one of those fields for that reason.
 */

import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import type { FeedFetch, RawFeedItem, TransitItem } from '../../../korczak-xyz/src/utils/transit/types';
import { contentHashOf } from '../../../korczak-xyz/src/utils/transit/normalize';
import { articleStampOf } from './article';
import type { FetchOutcome } from './wtp';

export interface UpsertResult {
  written: number;
  created: number;
  /** The merged records — never the freshly parsed ones. See `UpsertResult.records` in events. */
  items: TransitItem[];
}

export function stripUndefined<T extends object>(value: T): DocumentData {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

/**
 * One incoming item merged onto what is stored.
 *
 * The incoming half is everything the feed states; the stored half is everything the extractor
 * produced plus `firstSeenAt`. They are disjoint by construction, which is what lets the fetcher
 * and the extractor write the same document without coordinating.
 *
 * **`extractHash` is carried forward unconditionally, even when `contentHash` has moved.** It is
 * the record of *what was read*, so leaving it in place next to a newer `contentHash` is exactly
 * what makes `needsExtracting` true and what makes the Raw tab able to say "this reading is out of
 * date". Clearing it here would lose the distinction between never-read and read-and-stale.
 *
 * **`article` is the one field carried forward conditionally**, and it is the exception that proves
 * the rest. It is not something the feed states and not something the extractor produced: it is a
 * copy of a page that WTP can rewrite without telling us. So it survives only while the RSS row it
 * was fetched against is unchanged — `articleStampOf(incoming) === stored.articleFetchedFor`, which
 * also asks again when this build reads pages differently from the one that stored it. An edited
 * row (the `ZAKOŃCZONO:` prefix that arrives when a closure ends is exactly one) drops the article
 * *and* the latch together, so `needsArticle` asks for the page again on the same run. Carried
 * forward unconditionally it would be a fortnight-old description of a closure sitting under a
 * headline saying the closure is over, and `contentHash` would cover it and call it current.
 *
 * **A re-published row is the other kind of edited row, and it does not look like one.** WTP files
 * a second incident under the first one's post: same guid, same headline, same one-sentence body,
 * new `pubDate`. The text this comparison reads is identical, so for a year it kept the previous
 * night's article and hashed it as current. `articleStampOf` carries the publication date for that
 * reason, and it is why the date is in there rather than in `feedHashOf` — the question here is
 * whether the page we hold is about the row that arrived, and two incidents can share every word.
 *
 * Which is why the hash is recomputed here rather than taken from `incoming`. `parseWtpFeed` has no
 * article to hash, so its digest is the feed's alone; this is the only place that knows both halves.
 */
export function mergeItem(
  incoming: TransitItem,
  stored: TransitItem | null,
  now: number,
): { record: TransitItem; created: boolean } {
  if (!stored) return { record: { ...incoming, firstSeenAt: now, updatedAt: now }, created: true };

  /*
   * Stamped against the row as it will be *stored*, which is the incoming feed fields under the
   * stored `firstSeenAt`. `parseWtpFeed` has no way to know when this app first met an item, so it
   * writes `firstSeenAt: now` on everything it parses — and `republishedAt` compares those two, so
   * asking `incoming` on its own can only ever answer "published before we saw it" and the date
   * would silently never reach the stamp. Every later caller is handed the merged record and has
   * the real one.
   */
  const keepsArticle =
    stored.articleFetchedFor !== undefined &&
    stored.articleFetchedFor === articleStampOf({ ...incoming, firstSeenAt: stored.firstSeenAt });

  return {
    record: {
      ...incoming,
      ...(keepsArticle
        ? {
            article: stored.article,
            articleFetchedFor: stored.articleFetchedFor,
            articleError: stored.articleError,
            contentHash: contentHashOf({
              title: incoming.title,
              body: incoming.body,
              article: stored.article,
            }),
          }
        : { article: undefined, articleFetchedFor: undefined, articleError: undefined }),
      firstSeenAt: stored.firstSeenAt,
      lines: stored.lines,
      closedStops: stored.closedStops,
      wholeLine: stored.wholeLine,
      effectiveFrom: stored.effectiveFrom,
      effectiveUntil: stored.effectiveUntil,
      reason: stored.reason,
      summary: stored.summary,
      extractedAt: stored.extractedAt,
      extractHash: stored.extractHash,
      extractError: stored.extractError,
      updatedAt: now,
    },
    created: false,
  };
}

export async function upsertItems(
  db: Firestore,
  items: TransitItem[],
  now: number,
): Promise<UpsertResult> {
  const out: TransitItem[] = [];
  let written = 0;
  let created = 0;

  // Firestore caps a batch at 500 writes and getAll at a practical few hundred reads.
  const CHUNK = 200;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const refs = slice.map((item) => db.collection('transitItems').doc(item.id));
    const snaps = await db.getAll(...refs);

    const batch = db.batch();
    for (let j = 0; j < slice.length; j += 1) {
      const stored = snaps[j].exists ? (snaps[j].data() as TransitItem) : null;
      const outcome = mergeItem(slice[j], stored, now);
      batch.set(refs[j], stripUndefined(outcome.record));
      out.push(outcome.record);
      written += 1;
      if (outcome.created) created += 1;
    }
    await batch.commit();
  }

  return { written, created, items: out };
}

/**
 * The raw archive.
 *
 * Keyed by the item's own id, so a communiqué WTP edits overwrites its own row rather than
 * accumulating one per fetch — the archive is "what does the feed say about this item", not a log
 * of every request. The size that grows without bound is the *number* of communiqués, which is a
 * few dozen a day and is what the retention sweep in `collect.ts` is for.
 */
export async function archiveRaw(db: Firestore, raw: RawFeedItem[]): Promise<number> {
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < raw.length; i += CHUNK) {
    const batch = db.batch();
    for (const row of raw.slice(i, i + CHUNK)) {
      batch.set(db.collection('transitRaw').doc(row.id), stripUndefined(row));
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

/**
 * One feed's health row.
 *
 * Unlike the events app's `recordHealth`, an empty result is **not** treated as a failure here. A
 * WTP feed genuinely can hold nothing new, and — far more importantly — the failure this source
 * actually has is not emptiness but a WAF challenge, which `notAFeed` turns into a real error with
 * the status and the first bytes attached. Inferring failure from a zero count as well would only
 * add a second, vaguer signal beside a precise one.
 */
export async function recordFetch(
  db: Firestore,
  outcome: FetchOutcome,
  now: number,
): Promise<{ broken: boolean }> {
  const ref = db.collection('transitFeeds').doc(outcome.feed);
  const snap = await ref.get();
  const previous = snap.exists ? (snap.data() as FeedFetch) : null;

  const health: FeedFetch = {
    id: outcome.feed,
    feed: outcome.feed,
    url: outcome.url,
    fetchedAt: now,
    ok: outcome.ok,
    status: outcome.status,
    bytes: outcome.bytes,
    itemCount: outcome.items.length,
    bodyHead: outcome.bodyHead,
    error: outcome.error,
    consecutiveFailures: outcome.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
    lastOkAt: outcome.ok ? now : (previous?.lastOkAt ?? null),
  };
  await ref.set(stripUndefined(health));

  /*
   * Three in a row, reported once on the crossing rather than every run thereafter.
   *
   * The impediment feed is read every ten minutes, so three failures is half an hour of not being
   * able to see — which for "is the metro broken?" is about the longest silence worth tolerating
   * before saying so out loud.
   */
  return { broken: !outcome.ok && health.consecutiveFailures === 3 };
}
