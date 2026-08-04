/*
 * The six strings of standard tuning, and the arithmetic for saying how far a detected pitch
 * sits from one of them.
 *
 * Everything a tuner displays is a distance in cents, never a distance in hertz: a hertz is
 * worth 21 cents on the low E and 5 cents on the high E, so a needle calibrated in hertz would
 * mean something different on every string.
 */

/** A4, the pitch the whole equal-tempered table hangs off. */
export const A4_HZ = 440;

export interface GuitarString {
  /** 1 is the thinnest (high E), 6 the thickest (low E) — how guitarists number them. */
  readonly number: number;
  /** Scientific pitch notation, e.g. 'E2'. */
  readonly name: string;
  /** Note letter without the octave, for the big readout. */
  readonly letter: string;
  readonly octave: number;
  readonly frequency: number;
}

function equalTempered(semitonesFromA4: number): number {
  return A4_HZ * Math.pow(2, semitonesFromA4 / 12);
}

/** Low to high, the order they sit on the neck. */
export const STANDARD_TUNING: readonly GuitarString[] = [
  { number: 6, name: 'E2', letter: 'E', octave: 2, frequency: equalTempered(-29) },
  { number: 5, name: 'A2', letter: 'A', octave: 2, frequency: equalTempered(-24) },
  { number: 4, name: 'D3', letter: 'D', octave: 3, frequency: equalTempered(-19) },
  { number: 3, name: 'G3', letter: 'G', octave: 3, frequency: equalTempered(-14) },
  { number: 2, name: 'B3', letter: 'B', octave: 3, frequency: equalTempered(-10) },
  { number: 1, name: 'E4', letter: 'E', octave: 4, frequency: equalTempered(-5) },
];

/** How far `frequency` sits above `reference`, in cents. Negative is flat. */
export function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

export interface StringMatch {
  readonly string: GuitarString;
  /** Distance from that string's target pitch, in cents. Negative is flat. */
  readonly cents: number;
}

/*
 * Which string is being played.
 *
 * With auto-detection there is no way around a capture range: the closest neighbours in standard
 * tuning are B3 and G3, four semitones apart, so a string reads as itself only while it is within
 * 200 cents of where it belongs (250 for the five-semitone gaps). A string more than two semitones
 * flat — a fresh one still stretching in, most often — will be attributed to its lower neighbour.
 * That is inherent to auto-detection rather than a defect here, and it self-corrects as the string
 * comes up to pitch.
 */
export function nearestString(
  frequency: number,
  tuning: readonly GuitarString[] = STANDARD_TUNING,
): StringMatch {
  let best = tuning[0];
  let bestCents = centsBetween(frequency, best.frequency);

  for (const candidate of tuning) {
    const cents = centsBetween(frequency, candidate.frequency);
    if (Math.abs(cents) < Math.abs(bestCents)) {
      best = candidate;
      bestCents = cents;
    }
  }

  return { string: best, cents: bestCents };
}

/** Within this many cents, a string counts as in tune. Below a guitarist's ability to hear it. */
export const IN_TUNE_CENTS = 5;

export function isInTune(cents: number): boolean {
  return Math.abs(cents) <= IN_TUNE_CENTS;
}
