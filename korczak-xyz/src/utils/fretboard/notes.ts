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

// The twelve answers. `name` is what gets stored and compared; `label` is what the button
// shows — a flashcard that only ever says "A♯" teaches half of what that fret is called.
export const PITCH_CLASSES = [
  { name: 'C', label: 'C' },
  { name: 'C#', label: 'C♯/D♭' },
  { name: 'D', label: 'D' },
  { name: 'D#', label: 'D♯/E♭' },
  { name: 'E', label: 'E' },
  { name: 'F', label: 'F' },
  { name: 'F#', label: 'F♯/G♭' },
  { name: 'G', label: 'G' },
  { name: 'G#', label: 'G♯/A♭' },
  { name: 'A', label: 'A' },
  { name: 'A#', label: 'A♯/B♭' },
  { name: 'B', label: 'B' },
] as const;

export type NoteName = (typeof PITCH_CLASSES)[number]['name'];

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

const GERMAN_LABELS: Partial<Record<NoteName, string>> = { 'A#': 'A♯/B', B: 'H' };

/** What a pitch class is called. */
export function pitchLabel(name: NoteName, notation: Notation): string {
  if (notation === 'german' && GERMAN_LABELS[name]) return GERMAN_LABELS[name] as string;
  return PITCH_CLASSES.find((p) => p.name === name)?.label ?? name;
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
 * `${direction}:${stringIndex}-${fret}` — stable, sortable, and readable in a stored deck,
 * which matters when the only debugger available is a JSON dump in devtools.
 */
export function cardId(direction: Direction, stringIndex: number, fret: number): string {
  return `${direction}:${stringIndex}-${fret}`;
}

export interface CardKey extends Position {
  direction: Direction;
}

export function parseCardId(id: string): CardKey | null {
  const match = /^(name|find):(\d)-(\d{1,2})$/.exec(id);
  if (!match) return null;
  const stringIndex = Number(match[2]);
  const fret = Number(match[3]);
  if (!isValidPosition(stringIndex, fret, Number.MAX_SAFE_INTEGER)) return null;
  return { direction: match[1] as Direction, stringIndex, fret };
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
