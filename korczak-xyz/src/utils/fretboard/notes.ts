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
 * German (and Polish) notation is a different set of names, not a different way of writing the
 * same ones: the accidentals are spelt out as syllables — `Cis`, `Des`, `Fis`, `Ges` — the black
 * key below B natural is called B outright, and B natural takes a letter of its own, H.
 *
 * Exactly six of the twelve come out differently; the naturals C D E F G A are the same word in
 * both. That sparse table is what `hasTwoNotations` reads, so which cards a second notation adds
 * to the deck is a consequence of the names rather than a list kept in step with them.
 *
 * This is **not** a display choice, and has not been one since the deck gained a notation axis:
 * "what is this called in German" is a question of its own, drilled on its own schedule, exactly
 * as the two spellings of a black key are. What stays international is `name` above — the value
 * answers are compared against and the value written into `ReviewEvent.answered` — because a deck
 * practised under one notation and reviewed under the other has to remain one deck with one
 * history.
 *
 * The songbook's chord transposer (`src/utils/chords.ts`) prints `H` and `B` the same way but
 * keeps `#` for the rest, and that is not a disagreement: a chord symbol is written `C#m` in
 * Poland as everywhere else, while the *note* under it is called cis. Chord symbols and note
 * names are two notations, and only one of them is this module's business.
 */
export type Notation = 'international' | 'german';

export const NOTATIONS: Notation[] = ['international', 'german'];

export function isNotation(value: unknown): value is Notation {
  return typeof value === 'string' && (NOTATIONS as string[]).includes(value);
}

const GERMAN_LABELS: Partial<Record<NoteName, Record<Spelling, string>>> = {
  'C#': { sharp: 'Cis', flat: 'Des' },
  'D#': { sharp: 'Dis', flat: 'Es' },
  'F#': { sharp: 'Fis', flat: 'Ges' },
  'G#': { sharp: 'Gis', flat: 'As' },
  'A#': { sharp: 'Ais', flat: 'B' },
  B: { sharp: 'H', flat: 'H' },
};

/**
 * What a pitch class is called under one of its two spellings.
 *
 * Note that the notation only renames; it never merges or splits. `A♯` is still spelt two ways
 * under German notation — `Ais` and `B` rather than `A♯` and `B♭` — so which positions are two
 * *spellings* is the same question under either, and `hasTwoSpellings` can answer it without
 * being told the notation at all. The notation multiplies that count; it never changes it.
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

/**
 * Which notation to print where there is no card to take it from.
 *
 * The settings panel's string row and the stats heatmap are pictures of the instrument rather
 * than questions, so nothing on them insists on a notation the way a card does. German wins when
 * it is in the deck at all, because it is the marked case: nobody adds it without reading it, and
 * a player who has it in the deck wants the 2nd string called H everywhere else too.
 */
export function displayNotation(notations: readonly Notation[]): Notation {
  return notations.includes('german') ? 'german' : 'international';
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
 *
 * `allNote` and `allPitch` ask for **every** place at once — mark every E on the neck, mark every
 * E3 — and are graded on the whole set. `find` and `pitch` are satisfied by the first place you
 * think of, which is why they teach nothing about the others: the octave shapes, and the fact
 * that a pitch class comes round every twelve frets, are exactly what being asked for one
 * position at a time never makes you look at. So they are two more directions rather than a
 * harder way of scoring the two that exist.
 */
export type PositionDirection = 'name' | 'find';
/** The directions keyed on one exact pitch rather than on a place: `pitch:64`, `allPitch:64`. */
export type PitchDirection = 'pitch' | 'allPitch';
export type Direction = PositionDirection | PitchDirection | 'allNote';

export const DIRECTIONS: Direction[] = ['name', 'find', 'pitch', 'allNote', 'allPitch'];

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as string[]).includes(value);
}

export function isPositionDirection(direction: Direction): direction is PositionDirection {
  return direction === 'name' || direction === 'find';
}

/*
 * Card ids.
 *
 * `${direction}:${stringIndex}-${fret}`, with `:b` appended for the flat card and `:de` for the
 * German-notation one — stable, sortable, and readable in a stored deck, which matters when the
 * only debugger available is a JSON dump in devtools. `b` is how the songbook's transposer writes
 * a flat in ASCII (`src/utils/chords.ts`); `de` is the language tag, since the notation is the
 * German one and not a property of the page's language.
 *
 * The **sharp, international card is the unsuffixed one**, and that is a migration rather than a
 * preference: the plain id is what every deck already stored and every logged answer already
 * names, from back when one card asked "C♯/D♭" under both spellings at once and the notation was
 * a display setting that never reached an id. Reading it as sharp-and-international keeps the
 * schedule that card earnt, and leaves the flat and German cards to arrive as the new material
 * they genuinely are.
 *
 * A `pitch` card is not a position, so it is not keyed on one: `pitch:${midi}`, because the MIDI
 * number *is* the question — one pitch, one card, however many places on the neck sound it. An
 * `allPitch` card asks about the same pitch and is keyed the same way, under its own direction.
 *
 * An `allNote` card is not even a pitch: it is a pitch class, asked over the whole neck, so it is
 * keyed on the index into `PITCH_CLASSES` — `allNote:4` is E. The index rather than the name
 * because a name would have to be spelt, and the spelling is already the `:b` suffix's job.
 */
const FLAT_SUFFIX = ':b';
const GERMAN_SUFFIX = ':de';

/**
 * The suffixes a card's two naming axes add to its id.
 *
 * `:de` is dropped where the card would print the same word either way — `find:1-3` is C on the A
 * string in both notations, and two ids for one question would be two schedules for one thing
 * learnt once. That normalisation is what lets `scopeIds` loop over the selected notations
 * without minting duplicates, and it is the same rule `parseCardId` enforces from the other side.
 */
function nameSuffix(key: CardKey): string {
  const spelt = key.spelling === 'flat' ? FLAT_SUFFIX : '';
  const german = key.notation === 'german' && hasTwoNotations(key) ? GERMAN_SUFFIX : '';
  return `${spelt}${german}`;
}

export function cardId(
  direction: PositionDirection,
  stringIndex: number,
  fret: number,
  spelling: Spelling = 'sharp',
  notation: Notation = 'international'
): string {
  const key: PositionCardKey = { direction, stringIndex, fret, spelling, notation };
  return `${direction}:${stringIndex}-${fret}${nameSuffix(key)}`;
}

export function pitchCardId(
  direction: PitchDirection,
  midi: number,
  spelling: Spelling = 'sharp',
  notation: Notation = 'international'
): string {
  return `${direction}:${midi}${nameSuffix({ direction, midi, spelling, notation })}`;
}

export function pitchClassIndex(note: NoteName): number {
  return PITCH_CLASSES.findIndex((p) => p.name === note);
}

export function noteCardId(
  note: NoteName,
  spelling: Spelling = 'sharp',
  notation: Notation = 'international'
): string {
  const key: NoteCardKey = { direction: 'allNote', note, spelling, notation };
  return `allNote:${pitchClassIndex(note)}${nameSuffix(key)}`;
}

/**
 * What the card calls its note: which of the two spellings, and under which notation.
 *
 * `spelling` is `sharp` wherever there is nothing to choose — on a natural, which has one name,
 * and on a `name` card, which asks for the pitch class and takes either name as the answer.
 * `notation` is `international` wherever the two agree, so a card that reads the same in both is
 * one card and carries the unsuffixed id.
 */
interface Named {
  spelling: Spelling;
  notation: Notation;
}

export interface PositionCardKey extends Position, Named {
  direction: PositionDirection;
}

export interface PitchCardKey extends Named {
  direction: PitchDirection;
  midi: number;
}

export interface NoteCardKey extends Named {
  direction: 'allNote';
  note: NoteName;
}

/*
 * A card is asked about a place on the neck, about a pitch, or about a pitch class, and the three
 * carry different things. The union is deliberate: it makes the compiler point at every site that
 * assumed a card has a string and a fret, which is most of what these features had to visit.
 */
export type CardKey = PositionCardKey | PitchCardKey | NoteCardKey;

export function isPositionKey(key: CardKey): key is PositionCardKey {
  return isPositionDirection(key.direction);
}

export function isPitchKey(key: CardKey): key is PitchCardKey {
  return key.direction === 'pitch' || key.direction === 'allPitch';
}

/**
 * Whether the card is answered by marking every place at once rather than by one tap.
 *
 * The distinction the answer surface turns on, and the reason it is asked of the key rather than
 * read off the direction at each site: `allNote` and `allPitch` are keyed on different things and
 * have nothing else in common, so the direction pair would otherwise be spelt out in the session,
 * the grader and the timer alike.
 */
export function asksEveryPlace(key: CardKey): boolean {
  return key.direction === 'allNote' || key.direction === 'allPitch';
}

export function parseCardId(id: string): CardKey | null {
  const pitch = /^(pitch|allPitch):(\d{1,3})(:b)?(:de)?$/.exec(id);
  if (pitch) {
    const midi = Number(pitch[2]);
    if (!isValidMidi(midi)) return null;
    const spelling: Spelling = pitch[3] ? 'flat' : 'sharp';
    if (spelling === 'flat' && !hasTwoSpellings(pitchClassOfMidi(midi))) return null;
    const key: PitchCardKey = {
      direction: pitch[1] as PitchDirection,
      midi,
      spelling,
      notation: pitch[4] ? 'german' : 'international',
    };
    return pitch[4] && !hasTwoNotations(key) ? null : key;
  }

  const note = /^allNote:(\d{1,2})(:b)?(:de)?$/.exec(id);
  if (note) {
    const pitchClass = PITCH_CLASSES[Number(note[1])];
    if (!pitchClass) return null;
    const spelling: Spelling = note[2] ? 'flat' : 'sharp';
    if (spelling === 'flat' && !hasTwoSpellings(pitchClass.name)) return null;
    const key: NoteCardKey = {
      direction: 'allNote',
      note: pitchClass.name,
      spelling,
      notation: note[3] ? 'german' : 'international',
    };
    return note[3] && !hasTwoNotations(key) ? null : key;
  }

  const match = /^(name|find):(\d)-(\d{1,2})(:b)?(:de)?$/.exec(id);
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
  const key: PositionCardKey = {
    direction,
    stringIndex,
    fret,
    spelling,
    notation: match[5] ? 'german' : 'international',
  };
  // And the German card exists only where the two notations print different words. `find:1-3:de`
  // would be C on the A string called C, which is what `find:1-3` already is.
  return match[5] && !hasTwoNotations(key) ? null : key;
}

/**
 * What the note on a card is called, under a notation the card need not be the one asking in.
 *
 * One spelling everywhere the spelling is the question — which is every direction except `name`,
 * where either spelling is a right answer and both are therefore shown. A `pitch` or `allPitch`
 * card carries its octave, which is the whole of what those ask that `find` and `allNote` do not.
 */
function labelUnder(key: CardKey, notation: Notation): string {
  if (isPitchKey(key)) return midiLabel(key.midi, key.spelling, notation);
  if (key.direction === 'allNote') return spellingLabel(key.note, key.spelling, notation);
  if (key.direction === 'name') return noteLabelAt(key.stringIndex, key.fret, notation);
  return spellingLabel(noteNameAt(key.stringIndex, key.fret), key.spelling, notation);
}

/** The pitch class a card is about, whatever the card is keyed on. */
export function cardNote(key: CardKey): NoteName {
  if (isPitchKey(key)) return pitchClassOfMidi(key.midi);
  if (key.direction === 'allNote') return key.note;
  return noteNameAt(key.stringIndex, key.fret);
}

/**
 * Whether this card is two cards — one per notation — or one.
 *
 * Decided by what the card would print, not by a list of pitch classes, so the axis cannot drift
 * from the names: two cards exactly where the two notations disagree about the word. That is the
 * six of `GERMAN_LABELS` and nothing else, in every direction — a `name` card on C♯ asks for
 * `Cis/Des` rather than `C♯/D♭`, and one on D asks for `D` either way.
 */
export function hasTwoNotations(key: CardKey): boolean {
  return labelUnder(key, 'german') !== labelUnder(key, 'international');
}

/** What the note on a card is called, on the card — under the notation the card asks in. */
export function cardNoteLabel(key: CardKey): string {
  return labelUnder(key, key.notation);
}

/**
 * Which notation to draw the whole card in — the pad, the string letters, the keyboard map.
 *
 * The card's own, where it has one to insist on. A card that reads the same in both is normalised
 * to `international` and has no opinion, so it borrows the display notation instead: otherwise a
 * player drilling German names would meet an international pad on every `name` card that happened
 * to land on a natural, mid-sitting, for no reason they could see.
 */
export function cardNotation(key: CardKey, display: Notation): Notation {
  return hasTwoNotations(key) ? key.notation : display;
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

/**
 * Every place in the scope that sounds the pitch class — the answer to an `allNote` card.
 *
 * `fretsSounding` across all the strings rather than one, so the same note recurs every twelve
 * frets on each of them. Low string first, then up the neck: the order a player would read them
 * off, and the order the readout under a missed card prints them in.
 */
export function positionsOfNote(
  note: NoteName,
  strings: readonly number[],
  maxFret = MAX_FRET
): Position[] {
  const positions: Position[] = [];
  for (const stringIndex of [...strings].sort((a, b) => a - b)) {
    if (stringIndex < 0 || stringIndex >= STRING_COUNT) continue;
    for (const fret of fretsSounding(stringIndex, note, maxFret)) {
      positions.push({ stringIndex, fret });
    }
  }
  return positions;
}

/** Every pitch class the scope can sound — one `allNote` card each, in `PITCH_CLASSES` order. */
export function notesInScope(strings: readonly number[], maxFret = MAX_FRET): NoteName[] {
  const names = new Set(midisInScope(strings, maxFret).map(pitchClassOfMidi));
  return PITCH_CLASSES.filter((p) => names.has(p.name)).map((p) => p.name);
}

/**
 * Every place in the scope that answers the card — empty for a `name` card, which is not answered
 * on the neck at all.
 *
 * One function rather than a branch at each call site because three things have to agree about
 * this set and they are in three files: the grader, the marks the verdict lights up, and the
 * per-position budget the rating is measured against. They disagreed once already, when `find`
 * counted the twelfth-fret octave and the readout under it did not.
 *
 * Note that the answer moves with the scope — widen the fret range and a `find` card gains its
 * octave, an `allNote` card gains a whole string's worth. That is deliberate and as old as
 * `fretsSounding`: the scope is the neck as far as this deck is concerned, and marking a position
 * outside it would be marking something the card never showed.
 */
export function positionsAnswering(
  key: CardKey,
  strings: readonly number[],
  maxFret = MAX_FRET
): Position[] {
  if (isPitchKey(key)) return positionsSounding(key.midi, strings, maxFret);
  if (key.direction === 'allNote') return positionsOfNote(key.note, strings, maxFret);
  if (key.direction !== 'find') return [];
  // The asked string only, and every fret on it that sounds the note: the card named the string,
  // so the rest of the neck is not what it asked about.
  return fretsSounding(key.stringIndex, noteNameAt(key.stringIndex, key.fret), maxFret).map(
    (fret) => ({ stringIndex: key.stringIndex, fret })
  );
}
