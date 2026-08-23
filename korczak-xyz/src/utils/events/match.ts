/*
 * Does this event match this interest?
 *
 * The one question both halves of the app ask. The feed asks it to decide what to draw; the
 * collector asks it to decide what to push. They must answer identically, which is why this file
 * is compiled into the Cloud Functions bundle rather than copied there.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import type { EventRecord, Interest } from './types';
import { foldText } from './normalize';

/**
 * Whether a folded needle occurs in a folded haystack as a word rather than as a substring.
 *
 * `String.includes` is wrong here and wrong in a way that only shows up in production: 'floyd'
 * occurs inside "Floydwear", 'opera' inside "operacja", 'rock' inside "Rockefeller". An interest
 * that fires on those is an interest the owner turns off.
 *
 * But whole-word matching alone is wrong for **Polish**, which inflects almost everything: a
 * keyword of `klezmer` never reaches "koncert klezmerski", `rycerski` never reaches "turniej
 * rycerskiego", `średniowieczny` never reaches "jarmark średniowieczny" written in any other case.
 * Half the listings this app reads are Polish, so exact-word-only quietly matches nothing.
 *
 * Loosening to a prefix match everywhere would fix the Polish and bring "Floydwear" straight back.
 * So the choice is **explicit rather than guessed**: a keyword ending in `*` is a prefix, anything
 * else is a whole word. The stems in the seeded interests are written with it, the editor says so,
 * and the two failure modes stay where the author put them instead of being traded off centrally.
 *
 * Boundaries are defined against the *folded* alphabet — a-z and 0-9 — because folding has already
 * removed every diacritic. A multi-word needle matches as a phrase, with runs of whitespace,
 * punctuation and hyphens all equivalent.
 */
export function containsWord(haystack: string, needle: string): boolean {
  const raw = needle.trim();
  const prefix = raw.endsWith('*');
  const n = foldText(prefix ? raw.slice(0, -1) : raw);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '[^a-z0-9]+');
  // The needle must always *start* on a boundary; only its end is negotiable.
  const tail = prefix ? '' : '([^a-z0-9]|$)';
  return new RegExp(`(^|[^a-z0-9])${escaped}${tail}`).test(haystack);
}

/** Any-of. An empty list is **no constraint** — see `matchesInterest`. */
function anyWord(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => containsWord(haystack, needle));
}

/**
 * Whether an event satisfies an interest's content rules.
 *
 * Deliberately says nothing about `muted` or `deleted`: those are about whether the interest is
 * *live*, which is the caller's question and differs between the feed (muted still shows) and the
 * collector (muted never pushes). Folding the two together is how a muted interest ends up either
 * invisible or noisy, depending on which caller won.
 */
export function matchesInterest(event: EventRecord, interest: Interest): boolean {
  const hay = event.haystack;

  /*
   * An empty keyword list means "no keyword constraint", NOT "matches nothing".
   *
   * The Opera Narodowa interest is exactly this shape: `tags: ['opera']` with no keywords, meaning
   * "everything the opera announces". Reading empty as unsatisfiable makes that interest silently
   * dead — it matches nothing, forever, with no error and nothing in the UI to suggest why.
   */
  if (interest.keywords.length > 0 && !anyWord(hay, interest.keywords)) return false;

  // Any exclusion hit vetoes, whatever else matched.
  if (interest.excludeKeywords?.length && anyWord(hay, interest.excludeKeywords)) return false;

  // Tags are all-of: they narrow, where keywords widen.
  if (interest.tags?.length) {
    const tags = new Set(event.tags.map(foldText));
    if (!interest.tags.every((tag) => tags.has(foldText(tag)))) return false;
  }

  if (interest.cities?.length) {
    const city = foldText(event.city ?? '');
    if (!city) return false;
    if (!interest.cities.some((c) => foldText(c) === city)) return false;
  }

  /*
   * The date window compares `YYYY-MM-DD` strings, which sort lexically — that is why `day` is
   * stored alongside `startsAt` rather than derived on the fly. An undated event (a season
   * announced before its nights are scheduled) passes any window: it has not been excluded, it
   * simply has no date yet, and hiding it is the opposite of what an announcement feed is for.
   */
  if (event.day) {
    if (interest.fromDay && event.day < interest.fromDay) return false;
    if (interest.toDay && event.day > interest.toDay) return false;
  }

  return true;
}

/** Whether an interest is live at all — not deleted, and (for push) not muted. */
export function isInterestActive(interest: Interest, opts: { forPush: boolean }): boolean {
  if (interest.deleted) return false;
  if (opts.forPush && interest.muted) return false;
  return true;
}

/** Every live interest an event matches. Order follows the input, so the caller controls it. */
export function matchingInterests(
  event: EventRecord,
  interests: Interest[],
  opts: { forPush: boolean },
): Interest[] {
  return interests.filter(
    (interest) => isInterestActive(interest, opts) && matchesInterest(event, interest),
  );
}

/**
 * How prominently to rank a match in the feed.
 *
 * Only a tiebreak within a date ordering — the feed is chronological, because the question it
 * answers is "what is coming up". A narrower interest scores higher so that "Opera Narodowa"
 * matching everything the opera does never outranks a specific keyword hit on the same night.
 */
export function scoreMatch(event: EventRecord, interest: Interest): number {
  let score = 1;
  if (interest.keywords.length > 0) score += 2;
  if (interest.tags?.length) score += 1;
  if (interest.cities?.length) score += 1;
  if (event.ticketUrl) score += 1;
  return score;
}
