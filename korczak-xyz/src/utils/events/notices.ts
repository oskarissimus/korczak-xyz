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
  /**
   * When the sale opens, where the source said so ahead of time.
   *
   * Carried on the notice rather than looked up again because it is what a `presale` is *about*:
   * the body has to name the date being warned about, and the ordering below has to rank it by
   * that date. A sale announcement is an article, so its `startsAt` is null and reading the two
   * off one field would put the one notice you can be late for last.
   */
  onSaleAt?: number;
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
  /**
   * Fingerprints dismissed by hand — `ignoredFingerprints(...)`.
   *
   * Required rather than optional, unlike the feed's, and that is the point of it being on the
   * context at all: an ignore that reaches the feed and not the collector means the card is gone
   * from the screen and the phone still rings about it at 7am, which is the reading of "ignore"
   * that gets the app deleted. A new caller that has no list has to say `NO_IGNORES` out loud.
   */
  ignored: ReadonlySet<string>;
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

  /*
   * Dismissed by hand. Checked here rather than in `planRun` so both entry points obey it, and
   * checked before anything is built so **nothing is latched**: an ignored event leaves no claimed
   * notice behind, and un-ignoring it therefore gets its notifications back.
   *
   * That is the one place this app prefers a possible extra send to a lost one, and only because
   * the send cannot happen without a deliberate act — un-ignoring — by the person who would
   * receive it. Latching instead would silently consume the `soon` reminder for an event brought
   * back precisely because its date is wanted after all.
   */
  if (ctx.ignored.has(event.fingerprint)) return [];

  const matched = matchingInterests(event, interests, { forPush: true });
  if (matched.length === 0) return [];

  const out: PendingNotice[] = [];
  const base = {
    fingerprint: event.fingerprint,
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt,
    onSaleAt: event.onSaleAt,
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
   * The sale is coming. The other half of `onsale`, and the half that is any use.
   *
   * `onsale` can only fire once a ticket link has appeared, which for a season that sells out in a
   * morning is news that arrives too late to act on. But the date is usually *known in advance* —
   * Teatr Wielki prints it in its own news weeks ahead, and Ticketmaster carries it as
   * `sales.public.startDateTime` — so where a source states it, this counts down to it exactly as
   * `soon` counts down to a curtain, on the same `leadDays`.
   *
   * `> ctx.now` and not merely "present": a sale that opened last month is the ordinary state of
   * most of the corpus, and warning about it is warning about the past. Note this deliberately
   * does *not* ask `isFresh` — a date-based reminder is not an announcement, and an interest added
   * today should still be able to warn about a sale announced last week, which is the whole reason
   * anyone would add it.
   */
  const onSaleAt = event.onSaleAt;
  if (onSaleAt !== undefined && ctx.armedAt !== null && onSaleAt > ctx.now) {
    const lead = Math.max(...matched.map((i) => i.leadDays));
    if (daysUntil(onSaleAt, ctx.now) <= lead) add(out, 'presale', matched, base, seen);
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

/**
 * The date a notice is *about*, which is not always the date the event is on.
 *
 * A sale announcement has no `startsAt` — it is an article, and the RSS adapter's rule that an
 * article carries no date of its own holds here too. Ranking it by `startsAt` alone would sort the
 * one notice with a deadline behind every dated concert, so the cap below would drop it first.
 */
function noticeAt(notice: PendingNotice): number {
  const at = notice.kind === 'presale' ? notice.onSaleAt : notice.startsAt;
  return at ?? Infinity;
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
 * synthesised key changed, and an entire opera season looks new. `onsale` and `presale` share
 * their own, looser cap (10) and never become a summary: tickets going on sale — and the warning
 * that they are about to — is the thing he asked for, and it is not noise.
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
  all.sort((a, b) => noticeAt(a) - noticeAt(b));

  const announced = all.filter((n) => n.kind === 'announced');
  /*
   * `presale` shares the ticket budget with `onsale` rather than getting one of its own, because
   * they are one category of noise: both say "there is a thing to buy". A source that begins
   * stating sale dates for its whole catalogue — which is what Ticketmaster's
   * `sales.public.startDateTime` is — must not be able to outflank the cap by arriving under a
   * second name.
   */
  const sale = all
    .filter((n) => n.kind === 'onsale' || n.kind === 'presale')
    .slice(0, Math.max(0, ctx.maxOnSalePerRun));
  const soon = all.filter((n) => n.kind === 'soon');

  const keep = Math.max(0, ctx.maxPerRun);
  const sentAnnounced = announced.slice(0, keep);
  const suppressed = announced.slice(keep);

  return {
    send: [...sentAnnounced, ...sale, ...soon],
    suppressed,
    summary: suppressed.length > 0 ? { count: suppressed.length, url: '/apps/events' } : null,
  };
}
