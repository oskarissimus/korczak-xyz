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
 * Why an event did not match, named by the rule that turned it away.
 *
 * `places` is the one the feed's verification view filters on: it means the event satisfied
 * everything the interest asked about its *content* and was turned away only for where it is or
 * who it is for. That is the near miss worth reading; a keyword miss is not one.
 */
export type MatchReason = 'keywords' | 'exclude' | 'tags' | 'places' | 'cities' | 'dates';

/*
 * `dates` rather than `window`, which is what the rule is called in prose two paragraphs down.
 * Nothing in this directory may reference a browser global, and `portable.test.ts` enforces that
 * by scanning the file as text — so a union member spelt `window` fails the build with a message
 * about the DOM, in a file that has never touched it.
 */

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
 * Which rule an event fails, or null when it satisfies all of them.
 *
 * `matchesInterest` is this function asked a yes/no question, and that is the point: the feed's
 * "why was this left out?" view is built from the same call the real filter makes, so the two
 * cannot come to disagree about what is being filtered. A second near-miss matcher written beside
 * this one would be identical until the first bug fix — the argument that keeps this whole
 * directory compiled into the Cloud Function rather than copied there.
 *
 * The order is the order the rules are checked in, so a reason is "the first thing wrong", not
 * "the only thing wrong". The rejected view relies on that being stable: an event failing both the
 * keywords and the country is not a near miss on geography, and reporting it as one would put
 * things in that list nobody was ever going to see.
 *
 * Deliberately says nothing about `muted` or `deleted`: those are about whether the interest is
 * *live*, which is the caller's question and differs between the feed (muted still shows) and the
 * collector (muted never pushes). Folding the two together is how a muted interest ends up either
 * invisible or noisy, depending on which caller won.
 */
export function matchReason(event: EventRecord, interest: Interest): MatchReason | null {
  const hay = event.haystack;

  /*
   * An empty keyword list means "no keyword constraint", NOT "matches nothing".
   *
   * The Opera Narodowa interest is exactly this shape: `tags: ['opera']` with no keywords, meaning
   * "everything the opera announces". Reading empty as unsatisfiable makes that interest silently
   * dead — it matches nothing, forever, with no error and nothing in the UI to suggest why.
   */
  if (interest.keywords.length > 0 && !anyWord(hay, interest.keywords)) return 'keywords';

  // Any exclusion hit vetoes, whatever else matched.
  if (interest.excludeKeywords?.length && anyWord(hay, interest.excludeKeywords)) return 'exclude';

  // Tags are all-of: they narrow, where keywords widen.
  if (interest.tags?.length) {
    const tags = new Set(event.tags.map(foldText));
    if (!interest.tags.every((tag) => tags.has(foldText(tag)))) return 'tags';
  }

  if (!passesPlaces(event, interest)) return 'places';

  if (interest.cities?.length) {
    const city = foldText(event.city ?? '');
    if (!city) return 'cities';
    if (!interest.cities.some((c) => foldText(c) === city)) return 'cities';
  }

  /*
   * The date window compares `YYYY-MM-DD` strings, which sort lexically — that is why `day` is
   * stored alongside `startsAt` rather than derived on the fly. An undated event (a season
   * announced before its nights are scheduled) passes any window: it has not been excluded, it
   * simply has no date yet, and hiding it is the opposite of what an announcement feed is for.
   */
  if (event.day) {
    if (interest.fromDay && event.day < interest.fromDay) return 'dates';
    if (interest.toDay && event.day > interest.toDay) return 'dates';
  }

  return null;
}

/**
 * Where the event is, and who it is for, as **one** rule with two ways to pass.
 *
 * "Conferences in Poland, plus the ones worth flying to" is a single thought, and the two halves
 * are joined by OR. Made into two independent constraints the way `tags` and `cities` are, it
 * would read "in Poland AND international" — which drops PyCon Warsaw and PyCon US alike and is
 * nobody's question.
 *
 * An event nobody has classified yet **passes**, and that is deliberate rather than lax. It
 * follows the undated-event rule above — it has not been excluded, it simply has no answer yet —
 * and it decides which way this fails when the classifier is down: the noise comes back, visibly,
 * instead of the feed quietly emptying. A silent empty feed is the one outcome here that looks
 * exactly like everything working.
 *
 * Note that pending is checked per axis, not once. A record can know where it is and not yet know
 * who it is for — every Ticketmaster and Teatr Wielki row is `PL` from the moment it is scraped,
 * with `reach` arriving later — so an unclassified `reach` may not be read as "not international"
 * while `internationalAnywhere` is the thing being asked about.
 */
function passesPlaces(event: EventRecord, interest: Interest): boolean {
  const wanted = interest.countries ?? [];
  if (wanted.length === 0) return true;

  const country = event.country?.toUpperCase();
  if (country && wanted.some((code) => code.toUpperCase() === country)) return true;

  // Not in the wanted countries. Whether that settles it depends on what is still unknown.
  if (!country) return true;
  if (interest.internationalAnywhere) {
    if (event.reach === undefined) return true;
    if (event.reach === 'international') return true;
  }
  return false;
}

/**
 * Whether an event satisfies an interest's content rules.
 *
 * Kept as its own name because it is what almost every caller wants, but it is `matchReason`
 * underneath — there is one implementation of "does this match", not two.
 */
export function matchesInterest(event: EventRecord, interest: Interest): boolean {
  return matchReason(event, interest) === null;
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
 * Every live interest that turned this event away for the given reason and nothing sooner.
 *
 * What the feed's verification view is built on. Asking `matchReason` rather than re-deriving the
 * near miss is the whole point — see its header.
 */
export function interestsRejectingFor(
  event: EventRecord,
  interests: Interest[],
  reason: MatchReason,
  opts: { forPush: boolean },
): Interest[] {
  return interests.filter(
    (interest) => isInterestActive(interest, opts) && matchReason(event, interest) === reason,
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
  if (interest.countries?.length) score += 1;
  if (event.ticketUrl) score += 1;
  return score;
}
