/*
 * The neck: which note sits at which (string, fret), and the identifiers the deck is keyed on.
 *
 * Strings are indexed low to high — 0 is the thick low E (the 6th string) — because that is the
 * order a chord spec is written in (`src/utils/chordDiagram.ts` reads the same way) and the
 * order the tuning array is naturally written in. The diagram draws them the other way up,
 * which is the diagram's business, not this module's.
 */

export const MAX_FRET = 12;

// Standard tuning as MIDI note numbers, low E (E2 = 40) first.
export const TUNING_MIDI = [40, 45, 50, 55, 59, 64] as const;

// How each string is labelled on a diagram. Lower case for the high E, as every chord chart
// in the songbook writes it — and the same six under German notation, where the 2nd string is
// the H string. Spelt out rather than derived from `pitchLabel`, because the casing is part of
// the notation: the high E is lower case to tell it from the low one, and a pitch class has no
// case. Private, so `stringLabel` is the one way to ask and no call site can pick the wrong one.
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'] as const;
const GERMAN_STRING_LABELS = ['E', 'A', 'D', 'G', 'H', 'e'] as const;

export const STRING_COUNT = TUNING_MIDI.length;

/*
 * The twelve answers, each under both of its names.
 *
 * `name` is what gets stored and compared. The two spellings are held apart rather than baked
 * into one `C♯/D♭` string because the two questions this game asks want different things from
 * them: a `name` card, whose answer is a pitch class however you spell it, shows both — a
 * flashcard that only ever said "A♯" would teach half of what that fret is called — while a
 * `find` card asks under one spelling at a time. See `Spelling`.
 *
 * The seven naturals spell the same both ways, which is what makes "has two names" a property
 * this table already carries rather than a list to keep in step with it.
 */
export const PITCH_CLASSES = [
  { name: 'C', sharp: 'C', flat: 'C' },
  { name: 'C#', sharp: 'C♯', flat: 'D♭' },
  { name: 'D', sharp: 'D', flat: 'D' },
  { name: 'D#', sharp: 'D♯', flat: 'E♭' },
  { name: 'E', sharp: 'E', flat: 'E' },
  { name: 'F', sharp: 'F', flat: 'F' },
  { name: 'F#', sharp: 'F♯', flat: 'G♭' },
  { name: 'G', sharp: 'G', flat: 'G' },
  { name: 'G#', sharp: 'G♯', flat: 'A♭' },
  { name: 'A', sharp: 'A', flat: 'A' },
  { name: 'A#', sharp: 'A♯', flat: 'B♭' },
  { name: 'B', sharp: 'B', flat: 'B' },
] as const;

export type NoteName = (typeof PITCH_CLASSES)[number]['name'];

/**
 * Which of a note's two names is meant.
 *
 * `C♯` and `D♭` are the same fret and a different question — the fretboard is learnt from
 * written music, and music written in flats never mentions C♯. So a `find` card is asked under
 * one spelling at a time, and the two are separate cards on separate schedules for the same
 * reason the two directions are: knowing one is not knowing the other.
 *
 * Naturals have one name under both, so they are one card, and `sharp` is what they carry.
 */
export type Spelling = 'sharp' | 'flat';

/** Whether the pitch class is spelt two ways — the five black keys are, the seven naturals not. */
export function hasTwoSpellings(name: NoteName): boolean {
  const pitch = PITCH_CLASSES.find((p) => p.name === name);
  return pitch != null && pitch.sharp !== pitch.flat;
}

/*
 * Which names the twelve are shown under.
 *
 * German (and Polish) notation renames exactly two of them: the black key below B natural is
 * called B, which leaves B natural needing a letter of its own — H. The songbook's chord
 * transposer (`src/utils/chords.ts`) has always written them this way, so the two notations on
 * this site now agree. The rest keep their international spelling: `Cis`/`Des` is a further step
 * that nothing else here takes.
 *
 * This is a display choice and nothing more. `name` above stays international whichever is
 * picked, because it is the value answers are compared against and the value written into
 * `ReviewEvent.answered` — a deck practised under one notation and reviewed under the other has
 * to remain one deck with one history.
 */
export type Notation = 'international' | 'german';

const GERMAN_LABELS: Partial<Record<NoteName, Record<Spelling, string>>> = {
  'A#': { sharp: 'A♯', flat: 'B' },
  B: { sharp: 'H', flat: 'H' },
};

/**
 * What a pitch class is called under one of its two spellings.
 *
 * Note that the notation only renames; it never merges or splits. `A♯` is still spelt two ways
 * under German notation — its flat name is simply `B` rather than `B♭` — so which positions are
 * two cards is the same question under either, and `hasTwoSpellings` can answer it without one.
 * A deck whose shape moved with a display setting would be a different deck each way round.
 */
export function spellingLabel(name: NoteName, spelling: Spelling, notation: Notation): string {
  const pitch = PITCH_CLASSES.find((p) => p.name === name);
  if (!pitch) return name;
  if (notation === 'german') return GERMAN_LABELS[name]?.[spelling] ?? pitch[spelling];
  return pitch[spelling];
}

/** What a pitch class is called when both spellings are meant at once. */
export function pitchLabel(name: NoteName, notation: Notation): string {
  const sharp = spellingLabel(name, 'sharp', notation);
  const flat = spellingLabel(name, 'flat', notation);
  return sharp === flat ? sharp : `${sharp}/${flat}`;
}

/** What a string is called down the left edge of a diagram. */
export function stringLabel(stringIndex: number, notation: Notation): string {
  const labels = notation === 'german' ? GERMAN_STRING_LABELS : STRING_LABELS;
  return labels[stringIndex];
}

export interface Position {
  stringIndex: number; // 0 = low E
  fret: number; // 0 = open
}

export function isValidPosition(stringIndex: number, fret: number, maxFret = MAX_FRET): boolean {
  return (
    Number.isInteger(stringIndex) &&
    Number.isInteger(fret) &&
    stringIndex >= 0 &&
    stringIndex < STRING_COUNT &&
    fret >= 0 &&
    fret <= maxFret
  );
}

export function midiAt(stringIndex: number, fret: number): number {
  if (!isValidPosition(stringIndex, fret, Number.MAX_SAFE_INTEGER)) {
    throw new Error(`No such position: string ${stringIndex}, fret ${fret}`);
  }
  return TUNING_MIDI[stringIndex] + fret;
}

export function noteNameAt(stringIndex: number, fret: number): NoteName {
  return PITCH_CLASSES[midiAt(stringIndex, fret) % 12].name;
}

export function noteLabelAt(stringIndex: number, fret: number, notation: Notation): string {
  return pitchLabel(noteNameAt(stringIndex, fret), notation);
}

export const MIN_MIDI = 0;
export const MAX_MIDI = 127;

export function isValidMidi(midi: number): boolean {
  return Number.isInteger(midi) && midi >= MIN_MIDI && midi <= MAX_MIDI;
}

/*
 * Which octave a pitch sounds in, in scientific pitch notation (middle C = C4).
 *
 * The guitar is written an octave above where it sounds; these are the sounding numbers, so the
 * open low E is E2 and the open high e is E4 — what a tuner shows, and what `TUNING_MIDI` already
 * says.
 *
 * There is no spelling argument because no accidental in `PITCH_CLASSES` crosses an octave
 * boundary: the five black keys are spelt C♯/D♭ … A♯/B♭, never B♯ or C♭, so both names of a pitch
 * sit in the same octave. A table that ever gained one would have to take the spelling here.
 */
export function octaveOfMidi(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function pitchClassOfMidi(midi: number): NoteName {
  return PITCH_CLASSES[((midi % 12) + 12) % 12].name;
}

export function octaveAt(stringIndex: number, fret: number): number {
  return octaveOfMidi(midiAt(stringIndex, fret));
}

/** What one pitch is called — `C♯4`, `D♭4`, `E2`; `B4`/`H4` under German notation. */
export function midiLabel(midi: number, spelling: Spelling, notation: Notation): string {
  return `${spellingLabel(pitchClassOfMidi(midi), spelling, notation)}${octaveOfMidi(midi)}`;
}

/*
 * Which way round a position is asked.
 *
 * `name` shows the dot and asks what it is called; `find` names the note and a string and asks
 * where it is. They are separate cards on separate schedules because they are separate skills —
 * reading a diagram fluently does nothing for finding G on the A string mid-song, and the
 * scheduler has no business assuming one implies the other.
 *
 * `pitch` is a third skill and not a relabelling of `find`: it names one pitch with its octave —
 * `C♯4`, not "C♯ on the A string" — and asks for it anywhere on the neck, so choosing the string
 * is part of the answer rather than part of the question. That is what you do when someone calls
 * a note at you, and `find` never asks it.
 */
export type PositionDirection = 'name' | 'find';
export type Direction = PositionDirection | 'pitch';

export const DIRECTIONS: Direction[] = ['name', 'find', 'pitch'];

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as string[]).includes(value);
}

/*
 * Card ids.
 *
 * `${direction}:${stringIndex}-${fret}`, with `:b` appended for the flat card — stable, sortable,
 * and readable in a stored deck, which matters when the only debugger available is a JSON dump
 * in devtools. `b` is how the songbook's transposer writes a flat in ASCII (`src/utils/chords.ts`).
 *
 * The **sharp card is the unsuffixed one**, and that is a migration rather than a preference: the
 * plain id is what every deck already stored and every logged answer already names, back when one
 * card asked "C♯/D♭" under both names at once. Reading it as the sharp card keeps the schedule
 * that card earnt, and leaves the flat card to arrive as the new material it genuinely is.
 *
 * A `pitch` card is not a position, so it is not keyed on one: `pitch:${midi}`, because the MIDI
 * number *is* the question — one pitch, one card, however many places on the neck sound it.
 */
const FLAT_SUFFIX = ':b';

export function cardId(
  direction: PositionDirection,
  stringIndex: number,
  fret: number,
  spelling: Spelling = 'sharp'
): string {
  const base = `${direction}:${stringIndex}-${fret}`;
  return spelling === 'flat' ? `${base}${FLAT_SUFFIX}` : base;
}

export function pitchCardId(midi: number, spelling: Spelling = 'sharp'): string {
  const base = `pitch:${midi}`;
  return spelling === 'flat' ? `${base}${FLAT_SUFFIX}` : base;
}

/**
 * Which name the card asks under. `sharp` wherever there is nothing to choose — on a natural,
 * which has one name, and on a `name` card, which asks for the pitch class and takes either name
 * as the answer.
 */
interface Spelt {
  spelling: Spelling;
}

export interface PositionCardKey extends Position, Spelt {
  direction: PositionDirection;
}

export interface PitchCardKey extends Spelt {
  direction: 'pitch';
  midi: number;
}

/*
 * A card is asked about a place on the neck or about a pitch, and the two carry different things.
 * The union is deliberate: it makes the compiler point at every site that assumed a card has a
 * string and a fret, which is most of what this feature had to visit.
 */
export type CardKey = PositionCardKey | PitchCardKey;

export function isPositionKey(key: CardKey): key is PositionCardKey {
  return key.direction !== 'pitch';
}

export function parseCardId(id: string): CardKey | null {
  const pitch = /^pitch:(\d{1,3})(:b)?$/.exec(id);
  if (pitch) {
    const midi = Number(pitch[1]);
    if (!isValidMidi(midi)) return null;
    const spelling: Spelling = pitch[2] ? 'flat' : 'sharp';
    if (spelling === 'flat' && !hasTwoSpellings(pitchClassOfMidi(midi))) return null;
    return { direction: 'pitch', midi, spelling };
  }

  const match = /^(name|find):(\d)-(\d{1,2})(:b)?$/.exec(id);
  if (!match) return null;
  const stringIndex = Number(match[2]);
  const fret = Number(match[3]);
  if (!isValidPosition(stringIndex, fret, Number.MAX_SAFE_INTEGER)) return null;
  const direction = match[1] as PositionDirection;
  const spelling: Spelling = match[4] ? 'flat' : 'sharp';
  // The flat card exists only where it asks a different question: a `find` card on a black key.
  // A flat `name` card, or a flat card on a natural, is not something `scopeIds` can mint, so an
  // id spelt that way is a typo or a corrupt record and not a card to fold answers into.
  if (spelling === 'flat' && (direction !== 'find' || !hasTwoSpellings(noteNameAt(stringIndex, fret)))) {
    return null;
  }
  return { direction, stringIndex, fret, spelling };
}

/**
 * What the note on a card is called, on the card.
 *
 * One spelling on a `find` or `pitch` card, because the spelling is the question; both on a `name`
 * card, because either is a right answer there. A `pitch` card carries its octave, which is the
 * whole of what it asks that `find` does not.
 */
export function cardNoteLabel(key: CardKey, notation: Notation): string {
  if (key.direction === 'pitch') return midiLabel(key.midi, key.spelling, notation);
  if (key.direction !== 'find') return noteLabelAt(key.stringIndex, key.fret, notation);
  return spellingLabel(noteNameAt(key.stringIndex, key.fret), key.spelling, notation);
}

/**
 * Every fret on one string that sounds the given note, within the scope.
 *
 * The answer to a `find` card is a pitch class, not a coordinate: on a twelve-fret neck the
 * open string and the twelfth fret are the same note, and marking the second one wrong would
 * be teaching something false.
 */
export function fretsSounding(
  stringIndex: number,
  note: NoteName,
  maxFret = MAX_FRET
): number[] {
  const target = PITCH_CLASSES.findIndex((p) => p.name === note);
  if (target < 0) return [];
  const frets: number[] = [];
  for (let fret = 0; fret <= maxFret; fret++) {
    if (midiAt(stringIndex, fret) % 12 === target) frets.push(fret);
  }
  return frets;
}

/**
 * Every place in the scope that sounds exactly this pitch.
 *
 * The cross-string sibling of `fretsSounding`, and the answer to a `pitch` card: the same pitch
 * lies under three or four fingers on a guitar, and all of them are right. Unlike `fretsSounding`
 * this compares the whole MIDI number rather than the pitch class, so the open low E and its
 * twelfth fret — an octave apart — are not confused for each other.
 */
export function positionsSounding(
  midi: number,
  strings: readonly number[],
  maxFret = MAX_FRET
): Position[] {
  const positions: Position[] = [];
  for (const stringIndex of [...strings].sort((a, b) => a - b)) {
    if (stringIndex < 0 || stringIndex >= STRING_COUNT) continue;
    const fret = midi - TUNING_MIDI[stringIndex];
    if (fret >= 0 && fret <= maxFret) positions.push({ stringIndex, fret });
  }
  return positions;
}

/** Every distinct pitch the scope can sound — one `pitch` card each, in ascending order. */
export function midisInScope(strings: readonly number[], maxFret = MAX_FRET): number[] {
  const midis = new Set<number>();
  for (const stringIndex of strings) {
    if (stringIndex < 0 || stringIndex >= STRING_COUNT) continue;
    for (let fret = 0; fret <= maxFret; fret++) midis.add(TUNING_MIDI[stringIndex] + fret);
  }
  return [...midis].sort((a, b) => a - b);
}
