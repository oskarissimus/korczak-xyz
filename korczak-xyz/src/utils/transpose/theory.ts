/*
 * The theory the transposition trainer drills: keys, the degrees taken out of them, and what
 * those degrees are called.
 *
 * Two things here are worth reading before anything else.
 *
 * **A key spells its own chords.** There is no sharp/flat axis on this deck the way there is on
 * the fretboard's `find` cards, because a key is not free to choose: the IV of F is B♭ and never
 * A♯, and the V of B is F♯ and never G♭. Each key carries the spelling its own signature
 * dictates and every chord drawn from it is written that way — one fewer axis on the deck, and
 * one more thing the deck teaches.
 *
 * **The patterns are what make the `key` direction answerable.** No two keys among the four
 * patterns below produce the same set of chords, which is why "what key is this?" has one answer.
 * {C, F, G} is C major and nothing else: F major wants a B♭ and G major wants an F♯. That is a
 * property of these patterns rather than of harmony in general, and `theory.test.ts` asserts it
 * over the whole deck rather than trusting the argument.
 */

import { FLAT_NAMES, SHARP_NAMES } from '../chords';

/** 0 = C, 11 = B natural. The same numbering `parseChord` returns. */
export type PitchClass = number;

export type Quality = 'major' | 'minor';

export function mod12(n: number): PitchClass {
  return ((n % 12) + 12) % 12;
}

// --- notation ---------------------------------------------------------------------------------

/**
 * Which set of chord names the deck asks under.
 *
 * Three systems rather than two independent axes — how a black key is spelt and what the letter B
 * means — and that is a correction rather than a simplification. The axes are **not** independent:
 * whether minor is written `Am` or `a` belongs to both of them, so four combinations produce three
 * readings, and a card printing `C F G a` under three of them would have been given two schedules
 * for one question. Naming the systems is what makes the split factor.
 *
 *   - `polish` — the songbook's own, on every chart in `src/content/songs/`: sharps as symbols
 *     (`C#`), minor by lowercasing (`a`, `f#`), B natural is **H**, and **B** is B flat outright.
 *   - `german` — the same, with black keys as the German syllables: `Cis`, `Des`, `Es`, `Fis`.
 *     Reading `Es` and reading `E♭` are two acts, which is why both are in the deck.
 *   - `international` — `C#`, `Am`, `F#m`, B natural is `B` and B flat is `Bb`.
 *
 * The trap the middle two exist for is the letter B: a bare `B` is B flat in a Polish chart and B
 * natural in an English one, and there is no way to read your way out of that from context.
 *
 * A **deck axis**, not a display setting, for the reason the fretboard trainer's `notations` is
 * one: these are different things to know, and passing one is not passing the other. Only cards
 * whose words actually differ are split — see `canonicalNotation`.
 */
export type Notation = 'polish' | 'german' | 'international';

/**
 * In canonical order: the first system printing a given set of words is the one a card is filed
 * under. `polish` leads because it is what a card id carries unsuffixed, being what this site's
 * own charts are written in.
 */
export const NOTATIONS: Notation[] = ['polish', 'german', 'international'];

export function isNotation(value: unknown): value is Notation {
  return NOTATIONS.includes(value as Notation);
}

// --- names ------------------------------------------------------------------------------------

/*
 * The black keys, per system. The naturals are the same word everywhere and are not in the table.
 *
 * `polish` and `international` agree on all four of these — a chord symbol is written `C#m` in
 * Poland as everywhere else — and disagree only about B, below. That is exactly the distinction
 * this site's songbook draws, and it is why there are three systems and not two.
 */
const BLACK_KEYS: Record<number, Record<Notation, { sharp: string; flat: string }>> = {
  1: {
    polish: { sharp: 'C#', flat: 'Db' },
    international: { sharp: 'C#', flat: 'Db' },
    german: { sharp: 'Cis', flat: 'Des' },
  },
  3: {
    polish: { sharp: 'D#', flat: 'Eb' },
    international: { sharp: 'D#', flat: 'Eb' },
    german: { sharp: 'Dis', flat: 'Es' },
  },
  6: {
    polish: { sharp: 'F#', flat: 'Gb' },
    international: { sharp: 'F#', flat: 'Gb' },
    german: { sharp: 'Fis', flat: 'Ges' },
  },
  8: {
    polish: { sharp: 'G#', flat: 'Ab' },
    international: { sharp: 'G#', flat: 'Ab' },
    german: { sharp: 'Gis', flat: 'As' },
  },
};

/**
 * The root of a chord, as a word.
 *
 * The `polish` and `german` entries for pc 10 and 11 come from the songbook's own tables rather
 * than a second copy of them, so a chord printed here and the same chord printed on a song page
 * cannot drift apart.
 */
function rootName(pc: PitchClass, notation: Notation, spelling: 'sharp' | 'flat'): string {
  const n = mod12(pc);

  const black = BLACK_KEYS[n];
  if (black) return black[notation][spelling];

  if (n === 10) {
    if (notation === 'international') return spelling === 'flat' ? 'Bb' : 'A#';
    return FLAT_NAMES[10]; // `B` — B flat outright
  }
  if (n === 11) return notation === 'international' ? 'B' : SHARP_NAMES[11]; // `H`

  return SHARP_NAMES[n]; // a natural, the same word in every system
}

/**
 * Minor is written by lowercasing the root everywhere but the international system, which suffixes
 * `m`. That is the songbook's own convention — `a`, `d`, `h` on every chart in
 * `src/content/songs/` — and it travels with the letter names rather than with the spelling of
 * black keys, which is what makes the three systems the units they are.
 */
export function chordLabel(
  pc: PitchClass,
  quality: Quality,
  notation: Notation,
  spelling: 'sharp' | 'flat'
): string {
  const root = rootName(pc, notation, spelling);
  if (quality === 'major') return root;
  return notation === 'international' ? `${root}m` : root.toLowerCase();
}

/**
 * What a pad button says: both spellings where they differ, one word where they do not.
 *
 * The pad is twelve pitch classes and a pitch class has no key to spell it, so the button offers
 * both — `F#/Gb`, `B` under Polish naming, `A#/Bb` under international. The *slot* it fills then
 * prints the chord the way the card's key spells it, which is where the spelling is taught rather
 * than graded.
 */
export function pitchClassLabel(pc: PitchClass, notation: Notation): string {
  const sharp = rootName(pc, notation, 'sharp');
  const flat = rootName(pc, notation, 'flat');
  return sharp === flat ? sharp : `${sharp}/${flat}`;
}

// --- keys -------------------------------------------------------------------------------------

export type Mode = 'major' | 'minor';

export interface Key {
  tonic: PitchClass;
  mode: Mode;
}

/**
 * How a key spells its accidentals.
 *
 * The circle of fifths decides it, not a preference: D♭ major has five flats where C♯ major has
 * seven sharps, so the key is D♭. F♯ and G♭ are the one genuine tie at six apiece, and F♯ is what
 * a guitarist reads. Everything else is the key with fewer accidentals. The minor row is its
 * relative-major's answer, which is the same rule read from the other end.
 */
const MAJOR_SPELLING: readonly ('sharp' | 'flat')[] = [
  'sharp', // C  — no accidentals of its own; this decides the chords drawn from it
  'flat', //  D♭ (5 flats) over C♯ (7 sharps)
  'sharp', // D
  'flat', //  E♭
  'sharp', // E
  'flat', //  F  — one flat, and its IV is B♭
  'sharp', // F♯ (6) over G♭ (6); F♯ is the guitar reading
  'sharp', // G
  'flat', //  A♭
  'sharp', // A
  'flat', //  B♭
  'sharp', // B
];

export function keySpelling(key: Key): 'sharp' | 'flat' {
  // A minor key shares its signature with the major a minor third above it.
  const relativeMajor = key.mode === 'minor' ? mod12(key.tonic + 3) : key.tonic;
  return MAJOR_SPELLING[relativeMajor];
}

/** The name of a key's tonic, spelt as the key spells it. */
export function keyLabel(key: Key, notation: Notation): string {
  return rootName(key.tonic, notation, keySpelling(key));
}

// --- degrees ----------------------------------------------------------------------------------

export interface Degree {
  /** Roman numeral, cased as harmony is cased: upper for major, lower for minor. */
  numeral: string;
  /** Semitones above the tonic. */
  semitones: number;
  quality: Quality;
}

/**
 * The patterns the deck drills. The key of this table is what a card id carries.
 *
 * The two major ones are what was asked for. The two minor ones are here because the song library
 * is largely minor, and they are not one pattern with a variant: `i iv v` is the natural minor,
 * and `i iv V` raises the seventh to make the dominant major — which is what almost every song on
 * this site in a minor key actually plays (`a d E`, `e a H7`). Drilling only the natural one
 * would teach a progression the charts do not use.
 */
export const PATTERNS = {
  '145': {
    mode: 'major',
    degrees: [
      { numeral: 'I', semitones: 0, quality: 'major' },
      { numeral: 'IV', semitones: 5, quality: 'major' },
      { numeral: 'V', semitones: 7, quality: 'major' },
    ],
  },
  '1456': {
    mode: 'major',
    degrees: [
      { numeral: 'I', semitones: 0, quality: 'major' },
      { numeral: 'IV', semitones: 5, quality: 'major' },
      { numeral: 'V', semitones: 7, quality: 'major' },
      // The sixth degree of a major scale carries a minor triad — A minor in C — whatever case it
      // gets typed in.
      { numeral: 'vi', semitones: 9, quality: 'minor' },
    ],
  },
  m145: {
    mode: 'minor',
    degrees: [
      { numeral: 'i', semitones: 0, quality: 'minor' },
      { numeral: 'iv', semitones: 5, quality: 'minor' },
      { numeral: 'v', semitones: 7, quality: 'minor' },
    ],
  },
  m14V: {
    mode: 'minor',
    degrees: [
      { numeral: 'i', semitones: 0, quality: 'minor' },
      { numeral: 'iv', semitones: 5, quality: 'minor' },
      { numeral: 'V', semitones: 7, quality: 'major' },
    ],
  },
} as const satisfies Record<string, { mode: Mode; degrees: readonly Degree[] }>;

export type PatternId = keyof typeof PATTERNS;

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export function isPatternId(value: unknown): value is PatternId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PATTERNS, value);
}

export function patternMode(pattern: PatternId): Mode {
  return PATTERNS[pattern].mode;
}

/** `I IV V vi` — the pattern written out, which is how the settings panel names it. */
export function patternLabel(pattern: PatternId): string {
  return PATTERNS[pattern].degrees.map((d) => d.numeral).join(' ');
}

export function patternLength(pattern: PatternId): number {
  return PATTERNS[pattern].degrees.length;
}

export interface Chord {
  pc: PitchClass;
  quality: Quality;
  /** Which degree of the key this is — `I`, `iv`, `V`, `vi`. */
  numeral: string;
}

/**
 * The chords a pattern takes out of a key, in degree order.
 *
 * Order matters and is never shuffled. A `transpose` card shows its source chords in this order
 * and expects the answer in the corresponding one, which is what makes the answer gradeable slot
 * by slot — and what lets a wrong answer say *which* chord went wrong rather than only that one
 * did.
 */
export function chordsOf(tonic: PitchClass, pattern: PatternId): Chord[] {
  return PATTERNS[pattern].degrees.map((degree) => ({
    pc: mod12(tonic + degree.semitones),
    quality: degree.quality,
    numeral: degree.numeral,
  }));
}

/** The key a pattern is played in. */
export function keyOf(tonic: PitchClass, pattern: PatternId): Key {
  return { tonic, mode: patternMode(pattern) };
}

/** The same chords, written out as the key spells them. */
export function chordLabels(
  tonic: PitchClass,
  pattern: PatternId,
  notation: Notation
): string[] {
  const spelling = keySpelling(keyOf(tonic, pattern));
  return chordsOf(tonic, pattern).map((c) => chordLabel(c.pc, c.quality, notation, spelling));
}

/** How far apart two tonics are, the shortest way round the circle: `-5`…`+6`. */
export function intervalBetween(from: PitchClass, to: PitchClass): number {
  const up = mod12(to - from);
  return up > 6 ? up - 12 : up;
}

/**
 * Every (tonic, pattern) in the deck whose chords are exactly this set.
 *
 * The `key` direction rests on there being exactly one, and `theory.test.ts` checks that over the
 * whole deck. Returned as a list anyway: a caller may hand over a set from somewhere else, and
 * "no key produces these" is a real answer that must not be reported as a wrong one.
 */
export function keysProducing(chords: readonly Chord[]): { tonic: PitchClass; pattern: PatternId }[] {
  const wanted = chords
    .map((c) => `${mod12(c.pc)}:${c.quality}`)
    .sort()
    .join(' ');
  const found: { tonic: PitchClass; pattern: PatternId }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const pattern of PATTERN_IDS) {
      const have = chordsOf(tonic, pattern)
        .map((c) => `${c.pc}:${c.quality}`)
        .sort()
        .join(' ');
      if (have === wanted) found.push({ tonic, pattern });
    }
  }
  return found;
}

// --- scales -----------------------------------------------------------------------------------

/**
 * The seven triads of a scale, for deciding which key a song is written in.
 *
 * The minor row is the natural minor plus the raised-seventh dominant, because a song in A minor
 * that plays an E major chord has not left the key — that is the harmonic minor doing its one
 * job, and treating it as foreign would file half the songbook under the wrong key.
 */
const MAJOR_TRIADS: { semitones: number; minor: boolean }[] = [
  { semitones: 0, minor: false },
  { semitones: 2, minor: true },
  { semitones: 4, minor: true },
  { semitones: 5, minor: false },
  { semitones: 7, minor: false },
  { semitones: 9, minor: true },
  { semitones: 11, minor: true }, // vii° — counted as minor-ish; a diminished triad is rare here
];

const MINOR_TRIADS: { semitones: number; minor: boolean }[] = [
  { semitones: 0, minor: true },
  { semitones: 2, minor: true }, // ii°
  { semitones: 3, minor: false },
  { semitones: 5, minor: true },
  { semitones: 7, minor: true }, // v, natural
  { semitones: 7, minor: false }, // V, harmonic — the one every chart here actually plays
  { semitones: 8, minor: false },
  { semitones: 10, minor: false },
];

/** Whether a chord belongs to a key. */
export function isDiatonic(key: Key, pc: PitchClass, minor: boolean): boolean {
  const triads = key.mode === 'minor' ? MINOR_TRIADS : MAJOR_TRIADS;
  return triads.some((t) => mod12(key.tonic + t.semitones) === mod12(pc) && t.minor === minor);
}
