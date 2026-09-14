/*
 * What counts as one city.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

import { foldText } from './normalize';

/**
 * English and German names for places whose own name is different, folded on both sides.
 *
 * `foldText` alone makes `Kraków`, `KRAKOW` and `Krakow` one string, which is most of the problem —
 * but it is a normaliser, not a translator, and Ticketmaster's English catalogue says `Warsaw`
 * where its Polish one says `Warszawa`. Left alone that is two entries in the city picker, each
 * hiding the other's nights, for a tour that plays the same hall twice.
 *
 * A fixed table rather than a gazetteer, and a deliberately short one. This file compiles into the
 * Cloud Functions bundle along with the rest of the directory, so a dependency here is a dependency
 * in the collector; and a wrong merge is worse than a missing one — two options for one city is
 * visibly odd and costs one more tap, where two cities silently filed as one is a filter that lies.
 * So the entries are only the ones this corpus actually produces: the Polish cities the sources
 * name in English or German, and the European capitals python.org's calendar lands in.
 *
 * The canonical side is the city's **own** name, which is also what the picker prefers to print
 * when the corpus offers both. A name not in the table stays itself.
 */
export const CITY_ALIASES: Readonly<Record<string, string>> = {
  // Poland, as the rest of the world writes it.
  warsaw: 'warszawa',
  varsovie: 'warszawa',
  warschau: 'warszawa',
  cracow: 'krakow',
  krakau: 'krakow',
  danzig: 'gdansk',
  breslau: 'wroclaw',
  posen: 'poznan',
  stettin: 'szczecin',
  // Elsewhere in Europe, for the conferences.
  prague: 'praha',
  prag: 'praha',
  vienna: 'wien',
  vienne: 'wien',
  munich: 'munchen',
  cologne: 'koln',
  rome: 'roma',
  milan: 'milano',
  mailand: 'milano',
  naples: 'napoli',
  florence: 'firenze',
  venice: 'venezia',
  turin: 'torino',
  lisbon: 'lisboa',
  copenhagen: 'kobenhavn',
  brussels: 'bruxelles',
  brussel: 'bruxelles',
  'the hague': 'den haag',
  antwerp: 'antwerpen',
  gothenburg: 'goteborg',
  geneva: 'geneve',
  genf: 'geneve',
  bucharest: 'bucuresti',
  belgrade: 'beograd',
  athens: 'athina',
  moscow: 'moskva',
  kiev: 'kyiv',
  seville: 'sevilla',
};

/**
 * The one key two spellings of one city must agree on.
 *
 * `''` when there is no city — which is a third state and not a place: it is what an RSS article
 * has, and the callers treat it as "unplaced" rather than as somewhere to filter to.
 *
 * Used by the matcher for `Interest.cities`, which since the feed's city picker went (Sep 2026) is
 * its only caller. The alias table stays, and it is not tidy-up bait: it is what makes an interest
 * limited to `Warsaw` reach the nights Ticketmaster's Polish catalogue files under `Warszawa`, in
 * the browser and in the collector alike.
 */
export function cityKey(name: string | undefined): string {
  const folded = foldText(name ?? '');
  return CITY_ALIASES[folded] ?? folded;
}
