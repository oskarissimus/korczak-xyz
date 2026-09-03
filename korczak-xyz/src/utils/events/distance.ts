/*
 * How long the race is.
 *
 * The feed's running rows were the one kind of card where the title alone did not answer the
 * question you came to it with. "XVII Bieg Ziemi Puckiej" and "48. Maraton Warszawski" are a
 * 10 km and a marathon, and telling them apart meant opening the entry form. So the distance is
 * pulled out of the words the source already gave us and drawn as its own chip — and put in the
 * push body, where there is no card to open at all.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 *
 * **Precision over recall, deliberately.** Every rule here is anchored — a unit, or a word that
 * can only be a distance — and nothing is inferred from a bare number. Race titles are full of
 * bare numbers that are not distances: `44 Międzynarodowy Bieg`, `5. Pietrasze Cross Country 1/5`
 * and `Grand Prix 2026 - 13.09.2026` are an edition, a round and a date. A card that says nothing
 * is a card you open; a card that says `44 km` about a 5 km run is one you plan a season around.
 * Measured against the four live listings on 3 Sep 2026: 27 of 134 races carry their distance in
 * their title, and none of the other 107 produced a false one.
 */

import { foldText } from './normalize';

/**
 * Words that are a distance in themselves.
 *
 * Two kinds, and both are needed. The marathons are the formal distances, which Polish writes as
 * one word and never as a number — nothing on this platform says "42,195 km". The rest are the
 * colloquial names a Polish race is actually titled with: `Stalowa Dycha`, `Nocna Piątka`,
 * `Hajnowska Dwunastka`, `Zamkowa Energetyczna Ósemka`. They inflect through every case, so each
 * is a **prefix** — `dziesiatk` reaches `Dziesiątka`, `Dziesiątki` and `Dziesiątkę` alike, the
 * same bargain `klezmer*` makes in the keyword matcher.
 *
 * These are independent tests, in no significant order, and the `\b` anchors are what make that
 * true: folded, `półmaraton` is `polmaraton`, so `\bmaraton` cannot see it, and `ultramaraton`
 * hides from both — which is correct, an ultra has no one distance. The single case where one
 * English name contains another is normalised away in `distancesIn` rather than ordered around.
 */
const NAMED: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bpolmaraton/, 21097],
  [/\bcwiercmaraton/, 10549],
  [/\bmaraton/, 42195],
  [/\bmarathon/, 42195],
  [/\bpiatk/, 5000],
  [/\bszostk/, 6000],
  [/\bsiodemk/, 7000],
  [/\bosemk/, 8000],
  [/\bdziewiatk/, 9000],
  [/\bdziesiatk/, 10000],
  [/\bdych/, 10000],
  [/\bdwunastk/, 12000],
];

/**
 * The left edge of a number, as a consumed character rather than a lookbehind.
 *
 * Without it a pattern capped at three digits happily reads the *tail* of a longer one: `Bieg 2026
 * km` — a title that is a year and a stray unit away from existing — comes out as a 26 km race,
 * and `21,097` would offer `097` as well once the comma form is allowed. A lookbehind would say
 * this more directly and is not available: Safari only learnt them in 16.4, and this file is
 * compiled into the browser bundle as well as into the Cloud Function.
 *
 * A digit is excluded for the length case and `.,` for the decimal one; everything else may sit in
 * front of a distance, including nothing at all.
 */
const LEFT = '(?:^|[^\\d.,])';

/**
 * `10 km`, `21,097 km`, `5km`, `10K`.
 *
 * The bare `k` alias is safe next to a digit because `\b` sits between a word character and a
 * non-word one: `3 kroli` — Bieg 3 Króli, a real race on this listing — has no boundary after its
 * `k`, so it never matches, while `10K` and `5 K` do.
 */
const KM = new RegExp(`${LEFT}(\\d{1,3}(?:[.,]\\d{1,3})?)\\s*(?:km|k)\\b`, 'g');

/** `800 m`. Two digits minimum, so a `1 m` typo in prose cannot mint a distance. */
const METRES = new RegExp(`${LEFT}(\\d{2,4})\\s*m\\b`, 'g');

/**
 * The window a race distance can plausibly fall in: 100 m to 500 km.
 *
 * The floor keeps a stray `10 m` out; the ceiling is above the longest thing anyone lists here
 * (a 24-hour ultra tops out around 250 km) and below every four-digit year, which is the number
 * these titles are fullest of.
 */
const MIN_M = 100;
const MAX_M = 500000;

/** Metres are a shorter race, not a longer one — `1500 m` is real, `9000 m` is written `9 km`. */
const MAX_METRE_FORM = 5000;

/**
 * How many distances one event may carry.
 *
 * A race weekend genuinely offers several — `Sopocki Półmaraton, bieg na 5 km, biegi dzieci` is
 * two — and the chip reads fine at three or four. Past that it is not a race any more, it is a
 * festival programme, and the card would be all chip.
 */
const MAX_DISTANCES = 6;

/**
 * Every distance the given text states, in metres, ascending and deduplicated.
 *
 * Metres rather than kilometres because they are integers: a half marathon is 21,097 m exactly,
 * where 21.0975 km is a float that two runtimes may or may not agree to print the same way, and
 * this value is compared against a stored one on every collector run.
 */
export function distancesIn(text: string): number[] {
  // `half marathon` before `marathon`, or the English name matches both and a half marathon comes
  // out as two races. Rewritten to the Polish word rather than ordered around, because `NAMED` is
  // a table of independent tests and one entry quietly depending on another's position is the kind
  // of rule that survives exactly until somebody sorts the list.
  const folded = foldText(text).replace(/\bhalf[ -]marathon/g, 'polmaraton');
  const found = new Set<number>();

  for (const match of folded.matchAll(KM)) {
    add(found, Math.round(Number(match[1].replace(',', '.')) * 1000));
  }
  for (const match of folded.matchAll(METRES)) {
    const metres = Number(match[1]);
    if (metres <= MAX_METRE_FORM) add(found, metres);
  }
  for (const [pattern, metres] of NAMED) {
    if (pattern.test(folded)) found.add(metres);
  }

  return [...found].sort((a, b) => a - b).slice(0, MAX_DISTANCES);
}

function add(into: Set<number>, metres: number): void {
  if (Number.isFinite(metres) && metres >= MIN_M && metres <= MAX_M) into.add(metres);
}

/**
 * The distances of a running event, or `undefined` when there are none to state.
 *
 * **Gated on the `running` tag, and that gate is the whole safety of this feature.** `maraton` is
 * a live Polish word for a long sitting of anything — *maraton filmowy*, *maraton pisania listów*
 * — and `piątka` is a five of any kind. Read across the whole corpus, the same rules that are
 * exactly right about a race would put `42.2 km` on a film night. The tag says these rows are
 * races; nothing else here does.
 *
 * Reads the title and subtitle and **not the description**, which is not squeamishness about
 * length: a description is prose, and prose says `10 km od centrum`, `przewyższenie 300 m` and
 * `500 m od mety` — distances that are real and are not the race's. The one source that lists
 * races carries no description at all, so this costs nothing today and stops the day an adapter
 * starts supplying one.
 *
 * Returns `undefined` rather than `[]` so the field is simply absent on a document — `stripUndefined`
 * drops it, and an empty array stored on two thousand events is two thousand writes saying nothing.
 */
export function distancesOf(event: {
  title: string;
  subtitle?: string;
  tags?: string[];
}): number[] | undefined {
  if (!(event.tags ?? []).includes('running')) return undefined;
  const found = distancesIn([event.title, event.subtitle ?? ''].join(' '));
  return found.length > 0 ? found : undefined;
}

/**
 * One distance as a person says it: `800 m`, `5 km`, `21.1 km`, `42.2 km`.
 *
 * A decimal point rather than a locale-aware separator, in both languages. This string is built in
 * the Cloud Function for the push body as well as in the browser for the card, and the function
 * has no locale — `sourceNames.ts` exists because of exactly that. `21.1 km` is read the same way
 * in Polish; a comma there would be right on the card and a guess in the notification.
 */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  const km = metres / 1000;
  // One decimal, and only when it says something: 5 km, not 5.0 km.
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} km`;
}

/** The whole list, as it appears on a card and in a notification. */
export function formatDistances(metres: readonly number[] | undefined): string {
  return (metres ?? []).map(formatDistance).join(' · ');
}
