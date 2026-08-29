/*
 * Where an event is, as one comparable token.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 *
 * Two sides need this and they must agree exactly. The collector writes `EventRecord.country` from
 * whatever a source or the classifier gave it — 'Poland', 'Polska', 'PL', 'Netherlands' — and the
 * interest editor stores `Interest.countries` from whatever was typed into a text field. If those
 * two normalised differently, an interest would be a filter that silently matches nothing, and the
 * only symptom would be an empty feed with no error anywhere.
 *
 * ISO-3166-1 alpha-2 is the stored form. A code rather than a name because the comparison then has
 * a right answer: 'Netherlands' and 'The Netherlands' and 'Holland' are three strings and one
 * country, and a fold-and-compare over free text gets that wrong in a way nobody debugs.
 */

import { foldText } from './normalize';

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
 * Names that are not just the country spelt in another language.
 *
 * Deliberately short. This is not a country database: the classifier is asked for an ISO-2 code
 * and returns one, so the only strings that reach here in anger are what a person typed into the
 * interest editor. What that person types is an English or Polish name, an abbreviation they are
 * used to, or the code itself — so those are what is listed, and everything else falls through to
 * `NAMES` below.
 */
const ALIASES: Record<string, string> = {
  // The ones an English or Polish speaker abbreviates rather than spells.
  usa: 'US',
  'united states': 'US',
  'united states of america': 'US',
  'stany zjednoczone': 'US',
  uk: 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  anglia: 'GB',
  'wielka brytania': 'GB',
  holland: 'NL',
  'the netherlands': 'NL',
  netherlands: 'NL',
  holandia: 'NL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  czechy: 'CZ',
  'south korea': 'KR',
  'korea poludniowa': 'KR',
  uae: 'AE',
  // The token for nowhere, spelt however it arrives.
  online: ONLINE,
  virtual: ONLINE,
  remote: ONLINE,
  zdalnie: ONLINE,
  zdalne: ONLINE,
  wirtualne: ONLINE,
  internet: ONLINE,
};

/**
 * Country names in English and Polish, for the countries this app plausibly sees.
 *
 * Europe in full — this is a Polish events app, and "Poland and its neighbours" has to be typable
 * without looking codes up — plus the handful outside it that a Python conference calendar reaches.
 * A name that is not here is not an error: `toCountryCode` returns undefined, the editor shows the
 * field back unchanged, and nothing silently becomes the wrong country.
 */
const NAMES: Record<string, string> = {
  poland: 'PL', polska: 'PL',
  germany: 'DE', niemcy: 'DE', deutschland: 'DE',
  slovakia: 'SK', slowacja: 'SK',
  lithuania: 'LT', litwa: 'LT',
  latvia: 'LV', lotwa: 'LV',
  estonia: 'EE',
  belarus: 'BY', bialorus: 'BY',
  ukraine: 'UA', ukraina: 'UA',
  russia: 'RU', rosja: 'RU',
  austria: 'AT',
  switzerland: 'CH', szwajcaria: 'CH',
  france: 'FR', francja: 'FR',
  belgium: 'BE', belgia: 'BE',
  luxembourg: 'LU', luksemburg: 'LU',
  ireland: 'IE', irlandia: 'IE',
  spain: 'ES', hiszpania: 'ES',
  portugal: 'PT', portugalia: 'PT',
  italy: 'IT', wlochy: 'IT',
  greece: 'GR', grecja: 'GR',
  turkey: 'TR', turcja: 'TR',
  hungary: 'HU', wegry: 'HU',
  romania: 'RO', rumunia: 'RO',
  bulgaria: 'BG',
  serbia: 'RS',
  croatia: 'HR', chorwacja: 'HR',
  slovenia: 'SI', slowenia: 'SI',
  denmark: 'DK', dania: 'DK',
  sweden: 'SE', szwecja: 'SE',
  norway: 'NO', norwegia: 'NO',
  finland: 'FI', finlandia: 'FI',
  iceland: 'IS', islandia: 'IS',
  canada: 'CA', kanada: 'CA',
  mexico: 'MX', meksyk: 'MX',
  brazil: 'BR', brazylia: 'BR',
  argentina: 'AR', argentyna: 'AR',
  colombia: 'CO', kolumbia: 'CO',
  chile: 'CL',
  israel: 'IL', izrael: 'IL',
  india: 'IN', indie: 'IN',
  japan: 'JP', japonia: 'JP',
  china: 'CN', chiny: 'CN',
  taiwan: 'TW', tajwan: 'TW',
  singapore: 'SG', singapur: 'SG',
  indonesia: 'ID', indonezja: 'ID',
  philippines: 'PH', filipiny: 'PH',
  malaysia: 'MY', malezja: 'MY',
  thailand: 'TH', tajlandia: 'TH',
  vietnam: 'VN', wietnam: 'VN',
  australia: 'AU',
  'new zealand': 'NZ', 'nowa zelandia': 'NZ',
  'south africa': 'ZA', 'republika poludniowej afryki': 'ZA',
  nigeria: 'NG',
  kenya: 'KE', kenia: 'KE',
  ghana: 'GH',
  uganda: 'UG',
  tanzania: 'TZ',
  cameroon: 'CM', kamerun: 'CM',
  senegal: 'SN',
  morocco: 'MA', maroko: 'MA',
  egypt: 'EG', egipt: 'EG',
  ethiopia: 'ET', etiopia: 'ET',
  zimbabwe: 'ZW',
  namibia: 'NA',
  botswana: 'BW',
  rwanda: 'RW',
};

/**
 * Whatever was written, as a stored token — or undefined when it cannot be read as one.
 *
 * Undefined rather than a guess: a country the app got wrong is worse than a country it admits it
 * does not know, because the wrong one filters silently while the unknown one is visible on the
 * card as `?` and in the rejected view's summary line.
 *
 * A bare two-letter input is taken as a code. That is what lets someone type `PL, DE, CZ` into the
 * editor, which is the shortest way to say it and the way the field's hint suggests.
 */
export function toCountryCode(input: string | undefined | null): string | undefined {
  const folded = foldText(input ?? '');
  if (!folded) return undefined;

  if (ALIASES[folded]) return ALIASES[folded];
  if (NAMES[folded]) return NAMES[folded];
  /*
   * A bare pair of letters is taken as a code without being checked against a list of the world's
   * countries. Shipping all 249 to the browser to catch a typo is not worth it: the classifier
   * emits ISO-2, so the only way a wrong pair gets here is by being typed — and a code that matches
   * nothing is visible both in the field it was typed into and in the rejected view's country
   * summary, which prints what the corpus actually holds.
   */
  if (/^[a-z]{2}$/.test(folded)) return folded.toUpperCase();

  return undefined;
}

/**
 * A typed list as stored codes: deduped, sorted, and with anything unreadable dropped.
 *
 * Sorted because two interests meaning the same scope should not differ, which is
 * `sanitizeSettings`' argument in the chord cards. Dropped rather than kept-as-typed because a
 * value that cannot be compared against `EventRecord.country` is not a filter, it is a filter that
 * never fires.
 */
export function toCountryCodes(input: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of input ?? []) {
    const code = toCountryCode(raw);
    if (code) out.add(code);
  }
  return [...out].sort();
}

/**
 * A code as something to read. Falls back to the code, which is already legible.
 *
 * Only ever decoration — the card's chip and the rejected view's summary line — so an unknown code
 * printing as itself is the right outcome rather than a case to handle.
 */
export function countryLabel(code: string | undefined): string {
  if (!code) return '?';
  if (code === ONLINE) return 'online';
  return code;
}
