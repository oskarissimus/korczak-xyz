/*
 * What should wake him up, and — mostly — what should not.
 *
 * This is the part of the app that can make itself unusable in week one, so the whole decision is
 * a pure function over plain values: no Firestore, no network, no clock of its own. The Cloud
 * Function does the I/O and calls `planRun`; every rule below is reachable from a unit test.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { EventRecord, Interest, NoticeKind } from './types';
import { matchingInterests } from './match';
import { daysUntil, noticeIdFor } from './normalize';

export interface PendingNotice {
  kind: NoticeKind;
  noticeId: string;
  fingerprint: string;
  eventId: string;
  interestIds: string[];
  title: string;
  startsAt: number | null;
  url: string;
}

export interface PlanContext {
  now: number;
  /**
   * When notifications were armed. Everything already in the corpus at that moment is history.
   *
   * Null means never armed, and then nothing is sent at all — not "send everything", which is the
   * reading that turns the first launch into forty notifications.
   */
  armedAt: number | null;
  maxPerRun: number;
  maxOnSalePerRun: number;
}

export interface RunPlan {
  send: PendingNotice[];
  /** Announced notices that were latched but rolled into the summary instead of sent singly. */
  suppressed: PendingNotice[];
  /** The one notification that stands in for `suppressed`, or null when there is nothing to say. */
  summary: { count: number; url: string } | null;
}

/**
 * Whether an event is new enough, to this account and to this interest, to be announced.
 *
 * Two clocks, and both are needed:
 *
 *   - `armedAt` stops the first run after arming from replaying the entire corpus. Without it, an
 *     app installed ten minutes ago delivers forty notifications in one minute.
 *   - `interest.createdAt` stops *adding an interest* from doing the same thing with the backlog
 *     that interest now matches. This is why `Interest.createdAt` exists separately from
 *     `updatedAt`: editing keywords must not re-arm the backlog.
 *
 * The event's own `firstSeenAt` is compared against both, so a genuinely new event passes and a
 * pre-existing one never does, however the interests move around it.
 */
function isFresh(seenAt: number, interest: Interest, ctx: PlanContext): boolean {
  if (ctx.armedAt === null) return false;
  return seenAt >= ctx.armedAt && seenAt >= interest.createdAt;
}

/**
 * The notices one event owes, before capping.
 *
 * At most one notice per kind per event, however many interests matched — the interests are *why*
 * it fired, not *what* fired, so two interests matching one Floyd tribute is one notification with
 * two reasons, not two notifications.
 */
export function noticesFor(
  event: EventRecord,
  interests: Interest[],
  seen: ReadonlySet<string>,
  ctx: PlanContext,
): PendingNotice[] {
  // A date that has already passed is not news, whatever else is true of it.
  if (event.startsAt !== null && event.startsAt < ctx.now) return [];

  const matched = matchingInterests(event, interests, { forPush: true });
  if (matched.length === 0) return [];

  const out: PendingNotice[] = [];
  const base = {
    fingerprint: event.fingerprint,
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt,
    url: event.url,
  };

  const announcedFor = matched.filter((i) => isFresh(event.firstSeenAt, i, ctx));
  if (announcedFor.length > 0) add(out, 'announced', announcedFor, base, seen);

  /*
   * On sale. The transition cannot be recovered from the merged document — only the upsert knows
   * the stored copy had no ticket link — so the collector records the moment on the event as
   * `onSaleSeenAt` and this reads it back.
   */
  const onSaleSeenAt = event.onSaleSeenAt;
  if (onSaleSeenAt !== undefined) {
    const onSaleFor = matched.filter((i) => isFresh(onSaleSeenAt, i, ctx));
    if (onSaleFor.length > 0) add(out, 'onsale', onSaleFor, base, seen);
  }

  /*
   * Getting close. `max` of the matching interests' leadDays, not `min`: leadDays says how much
   * warning is wanted, so if any matching interest asked for thirty days it gets thirty. Undated
   * events cannot be close to anything.
   */
  if (event.startsAt !== null && ctx.armedAt !== null) {
    const lead = Math.max(...matched.map((i) => i.leadDays));
    if (daysUntil(event.startsAt, ctx.now) <= lead) add(out, 'soon', matched, base, seen);
  }

  return out;
}

function add(
  out: PendingNotice[],
  kind: NoticeKind,
  interests: Interest[],
  base: Omit<PendingNotice, 'kind' | 'noticeId' | 'interestIds'>,
  seen: ReadonlySet<string>,
): void {
  const noticeId = noticeIdFor(base.fingerprint, kind);
  if (seen.has(noticeId)) return;
  out.push({ ...base, kind, noticeId, interestIds: interests.map((i) => i.id) });
}

/**
 * One collector run's worth of notifications.
 *
 * Two caps, for two different reasons. `announced` is capped hard (3) and the overflow becomes a
 * single summary — because the realistic way this floods is a scrape whose markup shifted, every
 * synthesised key changed, and an entire opera season looks new. `onsale` gets its own, looser cap
 * (10) and never becomes a summary: tickets going on sale is the thing he asked for, and it is not
 * noise.
 *
 * Suppressed notices are still returned so the caller latches them. They must never be left
 * unclaimed to fire individually on the next run — that would only postpone the flood.
 */
export function planRun(
  events: EventRecord[],
  interests: Interest[],
  seen: ReadonlySet<string>,
  ctx: PlanContext,
): RunPlan {
  const all: PendingNotice[] = [];
  // Two documents can share a fingerprint (the same concert from two sources). The notice id is
  // keyed on the fingerprint, so the second one is a duplicate within this run as well as across
  // runs — `seen` only covers what previous runs claimed.
  const within = new Set<string>();
  for (const event of events) {
    for (const notice of noticesFor(event, interests, seen, ctx)) {
      if (within.has(notice.noticeId)) continue;
      within.add(notice.noticeId);
      all.push(notice);
    }
  }

  // Soonest first, so if anything is dropped it is the most distant.
  all.sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity));

  const announced = all.filter((n) => n.kind === 'announced');
  const onsale = all.filter((n) => n.kind === 'onsale').slice(0, Math.max(0, ctx.maxOnSalePerRun));
  const soon = all.filter((n) => n.kind === 'soon');

  const keep = Math.max(0, ctx.maxPerRun);
  const sentAnnounced = announced.slice(0, keep);
  const suppressed = announced.slice(keep);

  return {
    send: [...sentAnnounced, ...onsale, ...soon],
    suppressed,
    summary: suppressed.length > 0 ? { count: suppressed.length, url: '/apps/events' } : null,
  };
}
