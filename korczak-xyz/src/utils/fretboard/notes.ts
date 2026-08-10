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

// Which octave the position sounds in, in scientific pitch notation (middle C = C4).
export function octaveAt(stringIndex: number, fret: number): number {
  return Math.floor(midiAt(stringIndex, fret) / 12) - 1;
}

/*
 * Which way round a position is asked.
 *
 * `name` shows the dot and asks what it is called; `find` names the note and a string and asks
 * where it is. They are separate cards on separate schedules because they are separate skills —
 * reading a diagram fluently does nothing for finding G on the A string mid-song, and the
 * scheduler has no business assuming one implies the other.
 */
export type Direction = 'name' | 'find';

export const DIRECTIONS: Direction[] = ['name', 'find'];

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
 */
const FLAT_SUFFIX = ':b';

export function cardId(
  direction: Direction,
  stringIndex: number,
  fret: number,
  spelling: Spelling = 'sharp'
): string {
  const base = `${direction}:${stringIndex}-${fret}`;
  return spelling === 'flat' ? `${base}${FLAT_SUFFIX}` : base;
}

export interface CardKey extends Position {
  direction: Direction;
  /**
   * Which name the card asks the position under. `sharp` wherever there is nothing to choose —
   * on a natural, which has one name, and on a `name` card, which asks for the pitch class and
   * takes either name as the answer.
   */
  spelling: Spelling;
}

export function parseCardId(id: string): CardKey | null {
  const match = /^(name|find):(\d)-(\d{1,2})(:b)?$/.exec(id);
  if (!match) return null;
  const stringIndex = Number(match[2]);
  const fret = Number(match[3]);
  if (!isValidPosition(stringIndex, fret, Number.MAX_SAFE_INTEGER)) return null;
  const direction = match[1] as Direction;
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
 * One spelling on a `find` card, because the spelling is the question; both on a `name` card,
 * because either is a right answer there.
 */
export function cardNoteLabel(key: CardKey, notation: Notation): string {
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
