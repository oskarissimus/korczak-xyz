/*
 * The two metro lines, as ordered lists of stations.
 *
 * This file is the one piece of hard-coded world knowledge in the app, and it has to be, because
 * the question it answers cannot be answered from a communiqué. "Trains do not stop at Rondo ONZ"
 * is only a fact about somebody's commute once you know Rondo ONZ lies *between* Rondo Daszyńskiego
 * and Świętokrzyska — and no amount of reading the prose supplies the order of a line.
 *
 * So the order is the data structure: a station is an index, a watched stretch is an interval, and
 * "does this closure touch that journey?" is an overlap test. Everything else here exists to get a
 * name written in Polish prose — inflected, abbreviated, with or without the word *stacja* — onto
 * one of those indices.
 *
 * **This list is a fact about the world on the day it was written, and the world changes.** M2 is
 * still being extended westward. When a station opens, adding it here is the whole change: the
 * matcher, the extractor's prompt and the segment editor all read this file. `lines.test.ts` holds
 * the properties that keep it honest — every name folds to itself, no two stations collide, and
 * the seeded segments still resolve.
 */

import { foldText } from '../events/normalize';
import type { MetroLine } from './types';

/**
 * M1, Kabaty in the south to Młociny in the north.
 *
 * Written south-to-north rather than the other way because that is the direction the line is
 * numbered and signed. The direction is arbitrary for the matcher — an interval has no direction —
 * but it is not arbitrary for the segment editor, which lists stations in this order, and a list
 * that runs the opposite way to the platform signs is a list you second-guess.
 */
export const M1_STATIONS: readonly string[] = [
  'Kabaty',
  'Natolin',
  'Imielin',
  'Stokłosy',
  'Ursynów',
  'Służew',
  'Wilanowska',
  'Wierzbno',
  'Racławicka',
  'Pole Mokotowskie',
  'Politechnika',
  'Centrum',
  'Świętokrzyska',
  'Ratusz Arsenał',
  'Dworzec Gdański',
  'Plac Wilsona',
  'Marymont',
  'Słodowiec',
  'Stare Bielany',
  'Wawrzyszew',
  'Młociny',
];

/** M2, Bemowo in the west to Bródno in the east. Eighteen stations as of the Bródno opening. */
export const M2_STATIONS: readonly string[] = [
  'Bemowo',
  'Ulrychów',
  'Księcia Janusza',
  'Młynów',
  'Płocka',
  'Rondo Daszyńskiego',
  'Rondo ONZ',
  'Świętokrzyska',
  'Nowy Świat-Uniwersytet',
  'Centrum Nauki Kopernik',
  'Stadion Narodowy',
  'Dworzec Wileński',
  'Szwedzka',
  'Targówek Mieszkaniowy',
  'Trocka',
  'Zacisze',
  'Kondratowicza',
  'Bródno',
];

export const STATIONS: Record<MetroLine, readonly string[]> = {
  M1: M1_STATIONS,
  M2: M2_STATIONS,
};

/**
 * Spellings that are not the station's name and mean it anyway.
 *
 * Deliberately short, and every entry here is one this app has a reason to expect: WTP's own prose
 * and headlines write `Rondo ONZ` as `rondo ONZ`, drop the honorific from `Księcia Janusza`, and
 * abbreviate `Plac Wilsona` to `pl. Wilsona`. Folding handles case and diacritics; it cannot handle
 * a different word.
 *
 * **A wrong alias is worse than a missing one**, which is the rule `CITY_ALIASES` keeps in the
 * events app and it is sharper here: a missing alias costs one unrecognised station name, which
 * `impactOf` resolves upward into an alert you did get. An alias pointing at the wrong station puts
 * a closure on the wrong half of the line and produces confident silence.
 */
const ALIASES: Record<string, string> = {
  'plac wilsona': 'Plac Wilsona',
  'pl. wilsona': 'Plac Wilsona',
  'pl wilsona': 'Plac Wilsona',
  'ksiecia janusza': 'Księcia Janusza',
  'ks. janusza': 'Księcia Janusza',
  'rondo onz': 'Rondo ONZ',
  'rondo daszynskiego': 'Rondo Daszyńskiego',
  'nowy swiat - uniwersytet': 'Nowy Świat-Uniwersytet',
  'nowy swiat uniwersytet': 'Nowy Świat-Uniwersytet',
  'centrum nauki kopernik': 'Centrum Nauki Kopernik',
  'ratusz-arsenal': 'Ratusz Arsenał',
  'targowek': 'Targówek Mieszkaniowy',
  'targowek mieszkaniowy': 'Targówek Mieszkaniowy',
  'dworzec gdanski': 'Dworzec Gdański',
  'dworzec wilenski': 'Dworzec Wileński',
  'stadion narodowy': 'Stadion Narodowy',
};

/**
 * Words that decorate a station name in prose and are not part of it.
 *
 * Stripped from the *edges* only. Inside a name they are real: `Centrum Nauki Kopernik` contains
 * nothing to strip, but `stacji Metro Świętokrzyska` contains two words of scaffolding and one
 * station. `metro` is the interesting one — it is both a prefix WTP uses and the first word of
 * several tram-stop names, which is exactly why this never runs against anything but a candidate
 * already being resolved to a metro station.
 */
const EDGE_WORDS = new Set(['stacja', 'stacji', 'stacje', 'metro', 'metra', 'przystanek', 'na', 'do', 'od', 'w']);

/**
 * A station name as written anywhere, resolved to its entry in `STATIONS`, or null.
 *
 * Null is a real and useful answer. It is what a new station, a typo, or a model inventing
 * something looks like, and `impactOf` treats it as *uncertainty* rather than as absence — see the
 * note there. Silently dropping an unresolvable name is how an app tells you your route is clear
 * because it did not understand the sentence saying otherwise.
 */
export function canonicalStation(line: MetroLine, name: string): string | null {
  const key = normalizeStationKey(name);
  if (!key) return null;

  const alias = ALIASES[key];
  if (alias && STATIONS[line].includes(alias)) return alias;

  for (const station of STATIONS[line]) {
    if (normalizeStationKey(station) === key) return station;
  }
  return null;
}

/** The same, over both lines, for a name whose line is not yet known. */
export function stationLines(name: string): MetroLine[] {
  return (Object.keys(STATIONS) as MetroLine[]).filter((line) => canonicalStation(line, name) !== null);
}

/** The comparison key: folded, scaffolding words off the ends, punctuation flattened to spaces. */
export function normalizeStationKey(name: string): string {
  const folded = foldText(name)
    // `Nowy Świat-Uniwersytet` and `Nowy Świat - Uniwersytet` are one station; so are `Ratusz
    // Arsenał` and `Ratusz-Arsenał`, which WTP writes both ways.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!folded) return '';

  const words = folded.split(' ');
  while (words.length > 1 && EDGE_WORDS.has(words[0])) words.shift();
  while (words.length > 1 && EDGE_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** Where a station sits on its line, or -1. The whole reason this file has an order. */
export function stationIndex(line: MetroLine, name: string): number {
  const canonical = canonicalStation(line, name);
  return canonical === null ? -1 : STATIONS[line].indexOf(canonical);
}

/**
 * Every station between two, inclusive, in line order.
 *
 * Endpoints in either order — a journey has a direction and an interval does not, and requiring the
 * reader to enter their segment "the right way round" would be a rule with no reason behind it that
 * silently produces an empty segment.
 *
 * An unresolvable endpoint yields an empty list rather than a guess, which `normalizeSegment`
 * rejects at the point of saving so it can never reach the matcher.
 */
export function stationsBetween(line: MetroLine, from: string, to: string): string[] {
  const a = stationIndex(line, from);
  const b = stationIndex(line, to);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return STATIONS[line].slice(lo, hi + 1);
}

/**
 * Which lines a WTP headline names.
 *
 * Every item in both feeds is titled `Utrudnienia w komunikacji: 189, 401, 402` or `Zmiany w
 * komunikacji: 7, 9, 22, M1` — the affected lines, comma-separated, after a colon. That list is the
 * cheapest filter this app has and the reason it costs almost nothing to run: whether an item is
 * worth reading with a language model is decided from a string the feed handed over for free, so a
 * fortnight of bus roadworks never reaches the model at all.
 *
 * Read from the **title only**, deliberately. The body of a metro communiqué names replacement bus
 * lines, and a body-wide scan would pull those in as affected lines; the headline is WTP's own
 * statement of what the item is about.
 *
 * Everything after the colon is returned verbatim and uppercased — `M1`, `N24`, `E-1`, `189` — so
 * this stays a fact about the feed rather than a judgement about which lines matter. A title with
 * no colon yields nothing, which is honest: it is a shape this parser does not know.
 */
export function linesInTitle(title: string): string[] {
  const at = title.indexOf(':');
  if (at < 0) return [];
  const out: string[] = [];
  for (const part of title.slice(at + 1).split(',')) {
    const token = part.trim().toUpperCase();
    // Line designations are short and alphanumeric. Anything longer is prose that followed the
    // colon rather than a line, and admitting it would make every such item look like a match.
    if (/^[A-Z]?[A-Z0-9-]{1,5}$/.test(token)) out.push(token);
  }
  return out;
}

/** The metro lines among them. `linesInTitle` writes `M1`/`M2` exactly as `MetroLine` spells them. */
export function metroLinesInTitle(title: string): MetroLine[] {
  const named = new Set(linesInTitle(title));
  return (Object.keys(STATIONS) as MetroLine[]).filter((line) => named.has(line));
}
