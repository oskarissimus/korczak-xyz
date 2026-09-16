/*
 * Where an event is, as one comparable token.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 *
 * ISO-3166-1 alpha-2 is the stored form of `EventRecord.country`, written by an adapter where the
 * source knows it for free and by the classifier otherwise. A code rather than a name because the
 * comparison then has a right answer: 'Netherlands' and 'The Netherlands' and 'Holland' are three
 * strings and one country, and a fold-and-compare over free text gets that wrong in a way nobody
 * debugs.
 *
 * **This file used to hold a name table**, about a hundred and thirty English and Polish spellings,
 * with `toCountryCode` and `toCountryCodes` over it. It existed for one caller: the interest
 * editor, which stored `Interest.countries` from whatever was typed into a text field and had to
 * normalise it to the same token the collector wrote, or the filter silently matched nothing. With
 * the interests gone (Sep 2026) nothing anywhere parses a country out of free text — the classifier
 * is asked for a code and returns one, and `classify.ts` checks the shape itself — so the table had
 * no reader. It is in the history if a filter ever wants it back.
 */

/**
 * An event that happens nowhere.
 *
 * Not an ISO code — deliberately, since it is not a country and pretending otherwise would put it
 * in a list beside real ones with no way to tell it apart. It exists because "online" is a real
 * answer to "where is this", it is a common one in the python.org feed, and without a token of its
 * own an online conference falls into the same bucket as a location the classifier could not read
 * — which is a different thing and wants a different decision.
 */
export const ONLINE = 'ONLINE';

/**
 * A code as something to read. Falls back to the code, which is already legible.
 *
 * Only ever decoration — the chip on a card, and the line under a source's pages saying what that
 * page stamps — so an unknown code printing as itself is the right outcome rather than a case to
 * handle. `?` for absent, because "not labelled yet" is a state worth seeing: it is what says the
 * classifier has not reached a row rather than that it decided something about it.
 */
export function countryLabel(code: string | undefined): string {
  if (!code) return '?';
  if (code === ONLINE) return 'online';
  return code;
}
