/*
 * What should wake him up, and — mostly — what should not.
 *
 * This is the part of the app that can make itself unusable in week one, so the whole decision is
 * a pure function over plain values: no Firestore, no network, no clock of its own. The Cloud
 * Function does the I/O and calls `planRun`; every rule below is reachable from a unit test.
 *
 * **Everything an enabled source collects is push-eligible.** The interests used to stand between
 * the corpus and the lock screen, and they are gone (Sep 2026) — so what narrows this is the source
 * switches, which are a per-account preference, and the caps, which are per run. That trade is why
 * `maxSoonPerRun` exists: a reminder used to fire only for a row somebody had named, and now fires
 * for every dated row in the corpus.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { EventRecord, NoticeKind } from './types';
import { announceFloor, sourceEnabled, type SourcePrefs } from './sourcePrefs';
import { daysUntil, noticeIdFor } from './normalize';
import { FEED_PATH } from './links';

/**
 * How much warning is wanted before a date — a curtain, or a sale opening.
 *
 * One number for the whole app, where it used to be `Interest.leadDays` and could differ per
 * interest: forty-five days for a season, a fortnight for a ticket sale, thirty for a marathon.
 * Nothing replaces that, and it should be said plainly rather than explained away — a race is now
 * warned about on the same schedule as a concert. A fortnight is the old default and the one that
 * suits a ticket: long enough to put in a diary, short enough that the notice still reads as being
 * about this event rather than about the season.
 *
 * If a per-source lead is ever wanted, it belongs on the source catalogue beside its pages, not on
 * a second per-account collection: a theatre's season and an entry platform's races differ because
 * of what they publish, which is a fact about the source.
 */
export const LEAD_DAYS = 14;

export interface PendingNotice {
  kind: NoticeKind;
  noticeId: string;
  fingerprint: string;
  eventId: string;
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
  /**
   * The race distances, in metres, when the event is one and its title said so.
   *
   * Carried on the notice rather than looked up when the push is built, because by then there is
   * no event to look it up from: `payloadFor` receives this shape and nothing else, and the same
   * shape is what the alerts history is written from.
   */
  distancesM?: number[];
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
  maxSoonPerRun: number;
  /**
   * Which sources this account is still listening to — the Sources tab's switches.
   *
   * Required rather than optional, unlike the feed's, and that is the point of it being on the
   * context at all: a switch that reaches the feed and not the collector means the rows are gone
   * from the screen and the phone still rings about them at 7am, which is the reading of "off"
   * that gets an app deleted. A caller with no switches has to say `ALL_SOURCES_ON` out loud.
   *
   * It is also the **only** thing between the corpus and the lock screen now that the interests are
   * gone, which is a good deal more weight than it was carrying when it was written.
   */
  sources: SourcePrefs;
}

export interface RunPlan {
  send: PendingNotice[];
  /** Announced notices that were latched but rolled into the summary instead of sent singly. */
  suppressed: PendingNotice[];
  /** The one notification that stands in for `suppressed`, or null when there is nothing to say. */
  summary: { count: number; url: string } | null;
}

/**
 * Whether an event is new enough, to this account, to be announced.
 *
 * Two clocks, and both are needed:
 *
 *   - `armedAt` stops the first run after arming from replaying the entire corpus. Without it, an
 *     app installed ten minutes ago delivers forty notifications in one minute.
 *   - `announceFloor` stops *switching a source back on* from doing it again. A fortnight with a
 *     noisy feed off is a fortnight of rows that are newer than `armedAt`, and announcing the lot
 *     on the next run is precisely the flood the switch was reached for. Re-enabling arms that
 *     source from the moment of the tap, exactly as arming push arms the account from the moment
 *     of the tap.
 *
 * There used to be a third — `interest.createdAt`, which stopped *adding an interest* from
 * surfacing its whole backlog as announcements. It went with the interests, and nothing takes its
 * place because nothing can: there is no per-reader act left that widens what matches.
 *
 * The event's own `firstSeenAt` is compared against both, so a genuinely new event passes and a
 * pre-existing one never does, however the switches move around it.
 */
function isFresh(seenAt: number, event: EventRecord, ctx: PlanContext): boolean {
  if (ctx.armedAt === null) return false;
  if (seenAt < announceFloor(ctx.sources, event.source)) return false;
  return seenAt >= ctx.armedAt;
}

/**
 * The notices one event owes, before capping.
 *
 * At most one notice per kind per event: the same concert listed twice is one notification, which
 * is what keying the id on the fingerprint is for.
 */
export function noticesFor(
  event: EventRecord,
  seen: ReadonlySet<string>,
  ctx: PlanContext,
): PendingNotice[] {
  // A date that has already passed is not news, whatever else is true of it.
  if (event.startsAt !== null && event.startsAt < ctx.now) return [];

  /*
   * A source switched off on the Sources tab. Checked here rather than in `planRun` so both entry
   * points obey it, and checked before anything is built so **nothing is latched** — a switch is
   * meant to be reversible, and a run that claimed notice ids while a source was silent would
   * consume the `soon` reminder for a race the reader turns the source back on precisely to hear
   * about.
   *
   * This covers every kind. `announceFloor` above covers only the two that ask `isFresh`, which
   * is what keeps the backlog quiet *after* the switch comes back on; the two rules are the same
   * instruction read at two different moments, and neither does the other's job.
   */
  if (!sourceEnabled(ctx.sources, event.source)) return [];

  const out: PendingNotice[] = [];
  const base = {
    fingerprint: event.fingerprint,
    eventId: event.id,
    title: event.title,
    startsAt: event.startsAt,
    onSaleAt: event.onSaleAt,
    url: event.url,
    distancesM: event.distancesM,
  };

  if (isFresh(event.firstSeenAt, event, ctx)) add(out, 'announced', base, seen);

  /*
   * On sale. The transition cannot be recovered from the merged document — only the upsert knows
   * the stored copy had no ticket link — so the collector records the moment on the event as
   * `onSaleSeenAt` and this reads it back.
   */
  const onSaleSeenAt = event.onSaleSeenAt;
  if (onSaleSeenAt !== undefined && isFresh(onSaleSeenAt, event, ctx)) {
    add(out, 'onsale', base, seen);
  }

  /*
   * The sale is coming. The other half of `onsale`, and the half that is any use.
   *
   * `onsale` can only fire once a ticket link has appeared, which for a season that sells out in a
   * morning is news that arrives too late to act on. But the date is usually *known in advance* —
   * Teatr Wielki prints it in its own news weeks ahead, and Ticketmaster carries it as
   * `sales.public.startDateTime` — so where a source states it, this counts down to it exactly as
   * `soon` counts down to a curtain, on the same `LEAD_DAYS`.
   *
   * `> ctx.now` and not merely "present": a sale that opened last month is the ordinary state of
   * most of the corpus, and warning about it is warning about the past. Note this deliberately
   * does *not* ask `isFresh` — a date-based reminder is not an announcement, and a source armed
   * today should still be able to warn about a sale announced last week, which is the whole reason
   * anyone would switch it on.
   */
  const onSaleAt = event.onSaleAt;
  if (onSaleAt !== undefined && ctx.armedAt !== null && onSaleAt > ctx.now) {
    if (daysUntil(onSaleAt, ctx.now) <= LEAD_DAYS) add(out, 'presale', base, seen);
  }

  // Getting close. Undated events cannot be close to anything.
  if (event.startsAt !== null && ctx.armedAt !== null) {
    if (daysUntil(event.startsAt, ctx.now) <= LEAD_DAYS) add(out, 'soon', base, seen);
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
  base: Omit<PendingNotice, 'kind' | 'noticeId'>,
  seen: ReadonlySet<string>,
): void {
  const noticeId = noticeIdFor(base.fingerprint, kind);
  if (seen.has(noticeId)) return;
  out.push({ ...base, kind, noticeId });
}

/**
 * One collector run's worth of notifications.
 *
 * Three caps, for three different reasons. `announced` is capped hardest (3) and the overflow
 * becomes a single summary — because the realistic way this floods is a scrape whose markup
 * shifted, every synthesised key changed, and an entire opera season looks new. `onsale` and
 * `presale` share their own, looser cap (10) and never become a summary: tickets going on sale —
 * and the warning that they are about to — is the thing he asked for, and it is not noise. `soon`
 * has one now too (5), which it did not need while an interest had to name a row before a reminder
 * could fire; with the whole corpus eligible, a fortnight's lead over a national race listing is a
 * morning of buzzing.
 *
 * The overflow of the two ticket caps and of `soon` is simply dropped rather than latched. That is
 * deliberate and it is the opposite of what `announced` does: an announcement is a one-off, so
 * suppressing it without claiming the id only postpones the flood, where a countdown is asked again
 * on the next run and the next — the soonest event keeps rising to the top of the sort until it is
 * either sent or past. Latching a dropped reminder would silence exactly the event that was closest
 * to being worth a reminder.
 *
 * Suppressed `announced` notices are returned so the caller latches them. They must never be left
 * unclaimed to fire individually on the next run.
 */
export function planRun(
  events: EventRecord[],
  seen: ReadonlySet<string>,
  ctx: PlanContext,
): RunPlan {
  const all: PendingNotice[] = [];
  // Two documents can share a fingerprint (the same concert from two sources). The notice id is
  // keyed on the fingerprint, so the second one is a duplicate within this run as well as across
  // runs — `seen` only covers what previous runs claimed.
  const within = new Set<string>();
  for (const event of events) {
    for (const notice of noticesFor(event, seen, ctx)) {
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
  const soon = all.filter((n) => n.kind === 'soon').slice(0, Math.max(0, ctx.maxSoonPerRun));

  const keep = Math.max(0, ctx.maxPerRun);
  const sentAnnounced = announced.slice(0, keep);
  const suppressed = announced.slice(keep);

  return {
    send: [...sentAnnounced, ...sale, ...soon],
    suppressed,
    // The feed itself, and deliberately no `?event=`: this banner is about however many rows
    // were rolled into it, and a link to one of them would be a lie about the other nine.
    summary: suppressed.length > 0 ? { count: suppressed.length, url: FEED_PATH } : null,
  };
}
