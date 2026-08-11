/*
 * Practising in a key.
 *
 * Scope was a rectangle — which strings, how many frets up from the nut — and that is the right
 * first cut, because the fifth fret and the twelfth are different skills. It is not how anyone
 * plays, though: someone working on a song in G major wants the notes of G major on the neck,
 * not all twelve pitch classes evenly.
 *
 * A scale is a **scope filter and nothing else**. It decides which of the cards the grid already
 * describes are asked; it mints no new kind of card and renames nothing. So a card is still
 * `find:1-4`, `parseCardId` is untouched, and — since `ensureCards` never removes — a schedule
 * earnt under one key is waiting where you left it when you come back. That is the whole reason
 * this is a small change where the `pitch` direction was a large one.
 *
 * It is also safe across a deploy in **both** directions, which no new direction token can be. A
 * build that has never heard of `scale` ignores the field and practises the full chromatic deck;
 * a build that reads a scale type it does not know falls back to no scale (`isScaleChoice`).
 * Neither can produce an id the other's `parseCardId` refuses, which is the failure a new
 * direction has.
 */

import { PITCH_CLASSES, spellingLabel } from './notes';
import type { Notation, NoteName, Spelling } from './notes';

export type ScaleType =
  | 'major'
  | 'minor'
  | 'pentatonicMajor'
  | 'pentatonicMinor'
  | 'blues';

export const SCALE_TYPES: ScaleType[] = [
  'major',
  'minor',
  'pentatonicMajor',
  'pentatonicMinor',
  'blues',
];

export interface ScaleChoice {
  root: NoteName;
  type: ScaleType;
}

/*
 * Each scale as semitones above its root, plus where its relative major sits.
 *
 * `relativeMajor` is what `keySpelling` reads: the accidentals a key is written with are the
 * relative major's, so A minor is spelt like C major and D minor like F major. The minor
 * pentatonic and the blues scale are minor-flavoured and take the same offset of 3; the major
 * pentatonic is the major scale with two degrees left out, so it takes 0.
 *
 * The blues scale is the minor pentatonic plus the ♭5, which is the one note here that belongs to
 * no key signature. It rides along on the minor spelling rather than being given a rule of its
 * own: `keySpelling` answers per *key*, not per degree, and a scale is asked under one spelling.
 */
export const SCALES: Record<ScaleType, { steps: number[]; relativeMajor: number }> = {
  major: { steps: [0, 2, 4, 5, 7, 9, 11], relativeMajor: 0 },
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], relativeMajor: 3 },
  pentatonicMajor: { steps: [0, 2, 4, 7, 9], relativeMajor: 0 },
  pentatonicMinor: { steps: [0, 3, 5, 7, 10], relativeMajor: 3 },
  blues: { steps: [0, 3, 5, 6, 7, 10], relativeMajor: 3 },
};

/** Where a pitch class sits in the twelve, or -1. The one place that index is looked up. */
function indexOf(name: NoteName): number {
  return PITCH_CLASSES.findIndex((p) => p.name === name);
}

/** The notes of a scale, as pitch classes, from the root upwards. */
export function scaleNotes(choice: ScaleChoice): NoteName[] {
  const root = indexOf(choice.root);
  if (root < 0) return [];
  return SCALES[choice.type].steps.map((step) => PITCH_CLASSES[(root + step) % 12].name);
}

/** Whether a pitch class belongs to the scale. `null` is no scale at all, so everything does. */
export function isInScale(choice: ScaleChoice | null, name: NoteName): boolean {
  if (!choice) return true;
  return scaleNotes(choice).includes(name);
}

/*
 * Which of its two names a key writes its black notes under.
 *
 * The circle of fifths, as one table on the *relative major's* tonic: D♭, E♭, F, A♭ and B♭ major
 * are the flat keys anyone writes, the rest are sharp. C major has no accidentals at all and the
 * answer there is arbitrary, as it is for the two enharmonic ties (F♯/G♭ major, and D♯/E♭ minor
 * through it) — sharp is taken for both, which is the more commonly written of each pair.
 *
 * This is what makes practising in a key mean something. G major contains F♯; it does not contain
 * G♭, which is the same fret and a different note to read. The `find` direction is already split
 * by spelling for exactly that reason, so a key picks one of the two halves rather than asking
 * for a note under a name its own music never prints.
 */
const FLAT_MAJOR_KEYS = new Set([1, 3, 5, 8, 10]); // D♭, E♭, F, A♭, B♭

export function keySpelling(choice: ScaleChoice): Spelling {
  const root = indexOf(choice.root);
  if (root < 0) return 'sharp';
  const relative = (root + SCALES[choice.type].relativeMajor) % 12;
  return FLAT_MAJOR_KEYS.has(relative) ? 'flat' : 'sharp';
}

/**
 * What a key is called — the root under its own spelling.
 *
 * So the same root button reads `E♭` beside *major* and `D♯` beside *minor*, because those are
 * the names those two keys are written under. It follows the notation setting like every other
 * note name here: B♭ major is the key of `B` on a German-notation page.
 */
export function keyLabel(choice: ScaleChoice, notation: Notation): string {
  return spellingLabel(choice.root, keySpelling(choice), notation);
}

export function isScaleType(value: unknown): value is ScaleType {
  return typeof value === 'string' && (SCALE_TYPES as string[]).includes(value);
}

/**
 * Whether a stored or synced value is a scale this build can practise.
 *
 * Settings sync, so a scale type from a newer build can arrive on an older one. Unlike an unknown
 * *direction* — which mints ids `parseCardId` then refuses, leaving a sitting with nothing in it —
 * an unknown scale is merely a filter nobody can evaluate, and falling back to no scale gives the
 * full chromatic deck. Still worth rejecting here rather than downstream: `scaleNotes` on an
 * unknown type would throw on the missing table entry.
 */
export function isScaleChoice(value: unknown): value is ScaleChoice {
  if (typeof value !== 'object' || value === null) return false;
  const choice = value as Partial<ScaleChoice>;
  return isScaleType(choice.type) && typeof choice.root === 'string' && indexOf(choice.root as NoteName) >= 0;
}
