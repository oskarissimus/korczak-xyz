// Chord notation used by the song pages.
//
// German/Polish note names: B is B-flat and H is B-natural. There is no `Hb` among the
// output names because `B` already *means* B-flat — but `Hb` is accepted on input, and is
// the spelling to reach for when writing a flat, since `Bb` reads as "B-flat flattened" (= A)
// and is almost never what someone means.
//
// A chord token is `root accidental? quality* variant?`:
//   root       A-H, lowercase for minor (`g` is Gm, `G` is G major)
//   accidental # b, or German is/es (`fis` = F#, `es` = Eb)
//   quality    maj min sus add aug dim m and the numbers — matched case-insensitively, so
//              `gMaj7` is Gm(maj7) and `GMaj7` is Gmaj7
//   variant    one or more `*`, marking an alternate voicing of the same chord. It carries no
//              pitch, so it survives transposition untouched: `g*` up one is `g#*`. Songs use
//              it when a shape matters — the descending line in "Shine On You Crazy Diamond"
//              starts from a different Gm shape than the one the song opens with.

export type AccidentalPreference = 'sharp' | 'flat';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'];

const ROOT = '[A-Ha-h]';
// Case-sensitive on purpose: with a blanket /i the `b` accidental would also match `B`, and
// every "AB" in a lyric would start parsing as A-flat.
const ACCIDENTAL = '(?:#|b|is|es)';

// Longest first. If bare `m` came first, `maj7` would match as just `m` and the leftover `aj7`
// would be rescanned — where `a` is a valid root and gets transposed, turning Amaj7 into Bmbj7.
const QUALITY_WORDS = ['maj', 'min', 'sus', 'add', 'aug', 'dim', 'm'];
const QUALITY_NUMBERS = ['13', '11', '9', '7', '6', '5', '4', '2'];

function anyCase(word: string): string {
  return word
    .split('')
    .map(ch => `[${ch.toLowerCase()}${ch.toUpperCase()}]`)
    .join('');
}

const QUALITY = `(?:${[...QUALITY_WORDS.map(anyCase), ...QUALITY_NUMBERS].join('|')})`;
const VARIANT = '\\*+';

const TOKEN_SOURCE = `${ROOT}${ACCIDENTAL}?${QUALITY}*(?:${VARIANT})?`;

const TOKEN_ANYWHERE = new RegExp(TOKEN_SOURCE, 'g');
const TOKEN_EXACT = new RegExp(`^${TOKEN_SOURCE}$`);
const TOKEN_PARTS = new RegExp(`^(${ROOT})(${ACCIDENTAL})?((?:${QUALITY})*)(\\**)$`);

export function isChordLine(line: string): boolean {
  if (line.trim() === '') return false;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  return tokens.every(token => {
    if (token === '') return true;
    // Verse numbers ("1.") and section markers ("Ref.:") open lyric lines, not chord lines.
    if (/^\d+\.$/.test(token) || /^Ref\.?:?$/.test(token)) return false;
    return TOKEN_EXACT.test(token);
  });
}

export interface ParsedChord {
  /** 0 = C, 11 = B natural (`H`). */
  pitchClass: number;
  /** Whether the symbol names a minor chord — a lowercase root, or an `m` that is not `maj`. */
  minor: boolean;
  /** Everything after the root and its accidental: `7`, `maj7`, `sus4`, and so on. */
  quality: string;
}

/**
 * Read a chord symbol as a pitch class.
 *
 * Exported for the transposition trainer, which reads the songbook to find out which keys and
 * progressions actually turn up in it. It shares this file's grammar rather than carrying a
 * second copy of the token regex, because a parser that drifts from the one the song pages use
 * would quietly disagree with them about what a song is written in.
 */
export function parseChord(token: string): ParsedChord | null {
  const parts = token.match(TOKEN_PARTS);
  if (!parts) return null;

  const [, root, accidental = '', quality] = parts;
  let pitchClass = SHARP_NAMES.indexOf(root.toUpperCase());
  if (pitchClass === -1) return null;

  if (accidental === '#' || accidental === 'is') {
    pitchClass = (pitchClass + 1) % 12;
  } else if (accidental === 'b' || accidental === 'es') {
    pitchClass = (pitchClass + 11) % 12;
  }

  // A lowercase root is the songbook's own way of writing a minor chord; `m` is everyone else's.
  // `maj` is not it — `GMaj7` is a major seventh, and the `m` in it belongs to the word.
  const minor = root === root.toLowerCase() || /m(?!aj)/i.test(quality);
  return { pitchClass, minor, quality };
}

export function transposeChord(
  chord: string,
  semitones: number,
  prefer: AccidentalPreference = 'sharp'
): string {
  if (semitones === 0) return chord;

  const parts = chord.match(TOKEN_PARTS);
  if (!parts) return chord;

  const [, root, accidental = '', quality, variant] = parts;

  let noteIndex = SHARP_NAMES.indexOf(root.toUpperCase());
  if (noteIndex === -1) return chord;

  if (accidental === '#' || accidental === 'is') {
    noteIndex = (noteIndex + 1) % 12;
  } else if (accidental === 'b' || accidental === 'es') {
    noteIndex = (noteIndex - 1 + 12) % 12;
  }

  noteIndex = (noteIndex + (semitones % 12) + 12) % 12;

  let name = (prefer === 'flat' ? FLAT_NAMES : SHARP_NAMES)[noteIndex];
  if (root === root.toLowerCase()) name = name.toLowerCase();

  return name + quality + variant;
}

// Transposing changes how wide a chord prints (`D#` becomes `E`, `g` becomes `g#`), so
// rewriting the line in place would drag every later chord off the word it sits above. Each
// chord is put back at the column it started in, and only shoved right when the chord before
// it grew enough to collide.
export function transposeLine(
  line: string,
  semitones: number,
  prefer: AccidentalPreference = 'sharp'
): string {
  if (semitones === 0 || !isChordLine(line)) return line;

  let out = '';
  let match: RegExpExecArray | null;
  TOKEN_ANYWHERE.lastIndex = 0;

  while ((match = TOKEN_ANYWHERE.exec(line)) !== null) {
    if (match[0] === '') {
      TOKEN_ANYWHERE.lastIndex++;
      continue;
    }
    const column = out.length === 0 ? match.index : Math.max(match.index, out.length + 1);
    out = out.padEnd(column) + transposeChord(match[0], semitones, prefer);
  }

  return out;
}

// Which way a song spells its accidentals, so transposing a song written in flats doesn't
// silently answer in sharps. Ties go to sharps, matching how the pages behaved before.
export function detectAccidentalPreference(text: string): AccidentalPreference {
  let flats = 0;
  let sharps = 0;

  for (const line of text.split('\n')) {
    if (!isChordLine(line)) continue;
    for (const token of line.trim().split(/\s+/)) {
      const parts = token.match(TOKEN_PARTS);
      if (!parts) continue;
      const accidental = parts[2];
      if (accidental === 'b' || accidental === 'es') flats++;
      else if (accidental === '#' || accidental === 'is') sharps++;
    }
  }

  return flats > sharps ? 'flat' : 'sharp';
}
