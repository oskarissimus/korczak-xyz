/*
 * One collector run: fetch every source, upsert what came back, then notify.
 *
 * The health bookkeeping is not incidental. A scrape that breaks does not throw — it returns
 * nothing, and an empty result looks exactly like a quiet week. Without `eventSources` the theatre
 * could redesign its site and the app would go on looking perfectly healthy while never announcing
 * another opera. That is the most likely way this fails and the least likely way anyone notices.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { EventRecord, PushSub, SourceHealth } from '../../korczak-xyz/src/utils/events/types';
import { SOURCES } from './sources';
import type { EventSource, SourceContext } from './sources/types';
import { toRecord, upsertEvents } from './upsert';
import { listAccounts, notifyAccount } from './notify';
import { sendToAll } from './push';

/** Events already finished are dropped before they reach the corpus. */
const PAST_GRACE_MS = 2 * 86400000;
/** Consecutive failures before the owner is told a source is broken. */
const FAILURE_ALERT_AT = 3;

export interface RunSummary {
  fetched: number;
  written: number;
  created: number;
  newlyOnSale: number;
  accounts: number;
  delivered: number;
  brokenSources: string[];
}

/**
 * Whether an event is worth storing.
 *
 * The python.org feed alone carries 874 events, most of them years past — keeping those would fill
 * a collection every client pulls whole with rows nobody can attend. Undated events are always
 * kept: an announced season with no nights scheduled is the single most valuable thing here.
 */
export function isWorthKeeping(record: EventRecord, now: number): boolean {
  if (record.startsAt === null) return true;
  return record.startsAt >= now - PAST_GRACE_MS;
}

async function recordHealth(
  db: Firestore,
  source: EventSource,
  now: number,
  outcome: { count: number; error?: string },
): Promise<{ broken: boolean; health: SourceHealth }> {
  const ref = db.collection('eventSources').doc(source.id);
  const snap = await ref.get();
  const previous = snap.exists ? (snap.data() as SourceHealth) : null;

  /*
   * Zero is a failure only when the source used to return something.
   *
   * A brand-new source with nothing on is fine; a source that returned forty rows yesterday and
   * none today is a scrape that has stopped matching. That distinction is the whole value of this
   * table, and it is why `lastCount` is kept rather than just a timestamp.
   */
  const wentQuiet = outcome.error === undefined && outcome.count === 0 && (previous?.lastCount ?? 0) > 0;
  const failed = outcome.error !== undefined || wentQuiet;

  const health: SourceHealth = {
    id: source.id,
    label: source.label,
    lastRunAt: now,
    lastOkAt: failed ? (previous?.lastOkAt ?? null) : now,
    lastCount: failed ? (previous?.lastCount ?? 0) : outcome.count,
    consecutiveFailures: failed ? (previous?.consecutiveFailures ?? 0) + 1 : 0,
    ...(failed
      ? { lastError: (outcome.error ?? 'returned nothing after previously returning events').slice(0, 300) }
      : {}),
  };

  await ref.set(health);

  // Report once, on the threshold crossing — not on every run thereafter, which would be its own
  // kind of noise.
  return { broken: failed && health.consecutiveFailures === FAILURE_ALERT_AT, health };
}

export async function runCollection(
  db: Firestore,
  ctx: SourceContext,
  sources: EventSource[] = SOURCES,
): Promise<RunSummary> {
  const now = ctx.now;
  const records: EventRecord[] = [];
  const brokenSources: string[] = [];

  for (const source of sources) {
    let count = 0;
    let error: string | undefined;
    try {
      const raw = await source.fetchEvents(ctx);
      for (const item of raw) {
        const record = toRecord(item, source.id, source.label, now);
        if (isWorthKeeping(record, now)) records.push(record);
      }
      count = raw.length;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.error(`source ${source.id} failed`, error);
    }
    const { broken } = await recordHealth(db, source, now, { count, error });
    if (broken) brokenSources.push(source.label);
  }

  /*
   * Two sources can mint the same document id only if they share a source prefix, which they do
   * not — but one source can legitimately list the same event twice (a recurring iCal entry, a
   * feed that republished). Last one wins, and deduping here keeps the batch writes honest.
   */
  const byId = new Map(records.map((r) => [r.id, r]));
  const unique = [...byId.values()];

  const upserted = await upsertEvents(db, unique, now);

  // Notify from what was just collected, not from a re-read: this is the exact set the run knows
  // about, and a re-read would only add rows no source produced this time.
  const accounts = await listAccounts(db);
  let delivered = 0;
  for (const uid of accounts) {
    const result = await notifyAccount(db, uid, unique, now);
    delivered += result.delivered;
    if (result.claimed > 0) {
      console.log(`notified ${uid}: ${result.claimed} claimed, ${result.delivered} delivered`);
    }
  }

  if (brokenSources.length > 0) await reportBrokenSources(db, accounts, brokenSources);

  return {
    fetched: records.length,
    written: upserted.written,
    created: upserted.created,
    newlyOnSale: upserted.newlyOnSale,
    accounts: accounts.length,
    delivered,
    brokenSources,
  };
}

/** A source that has failed three times running is worth a notification of its own. */
async function reportBrokenSources(
  db: Firestore,
  accounts: string[],
  broken: string[],
): Promise<void> {
  for (const uid of accounts) {
    const subs = await db.collection('users').doc(uid).collection('pushSubs').get();
    if (subs.empty) continue;
    await sendToAll(
      db,
      uid,
      subs.docs.map((d) => ({ ...(d.data() as PushSub), id: d.id })),
      {
        title: 'An event source has stopped working',
        body: `${broken.join(', ')} — check the Alerts tab.`,
        url: '/apps/events/alerts',
        tag: `source-health-${broken.join('-')}`,
        kind: 'source-health',
      },
    );
  }
}
