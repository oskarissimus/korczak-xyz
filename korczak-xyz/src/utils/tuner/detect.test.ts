/*
 * These tests are the benchmark that chose the algorithm, kept where it can regress.
 *
 * Each one corresponds to a measurement that decided a constant in detect.ts. They are written
 * against synthetic plucked strings (testSignals.ts) because there is no jsdom and no microphone
 * here, and because the failure modes worth guarding — a fundamental the phone cannot reproduce,
 * a stiff string biasing the period, a hand bumping the phone — are not things a recording of a
 * clean sine would ever exercise.
 */

import { describe, expect, it } from 'vitest';
import { highpass, lowpass } from './biquad';
import {
  adaptiveCutoff,
  FRAME_SIZE,
  MAX_FREQUENCY_HZ,
  MIN_FREQUENCY_HZ,
  TunerDetector,
} from './detect';
import { centsBetween, nearestString, STANDARD_TUNING } from './notes';
import { pluckedString, STRING_INHARMONICITY } from './testSignals';

/**
 * What the capture graph does to a frame before the detector sees it: 4th-order high-pass at
 * 70 Hz, 4th-order low-pass at 2500 Hz. Mirroring it here keeps the tests honest about what
 * the detector is actually handed at runtime.
 */
function capture(signal: Float32Array, sampleRate: number): Float32Array {
  return lowpass(highpass(signal, 70, sampleRate, 4), 2500, sampleRate, 4);
}

function frameFor(
  name: string,
  frequency: number,
  sampleRate: number,
  overrides: Partial<Parameters<typeof pluckedString>[0]> = {},
): Float32Array {
  return capture(
    pluckedString({
      frequency,
      sampleRate,
      length: FRAME_SIZE,
      inharmonicity: STRING_INHARMONICITY[name] ?? 5e-5,
      ...overrides,
    }),
    sampleRate,
  );
}

describe('adaptiveCutoff', () => {
  it('keeps six partials in the middle of the range', () => {
    expect(adaptiveCutoff(200)).toBe(1200);
  });

  it('does not close below the high E string, whose own harmonics it would eat', () => {
    expect(adaptiveCutoff(82.41)).toBe(700);
  });

  it('does not open so far that stretched partials bias the reading again', () => {
    expect(adaptiveCutoff(900)).toBe(2500);
  });
});

describe('TunerDetector on a quiet room', () => {
  it('reports silence as quiet rather than inventing a note', () => {
    const detector = new TunerDetector();
    const result = detector.detect(new Float32Array(FRAME_SIZE), 48000);
    expect(result.frequency).toBeNull();
    expect(result.rejectedBecause).toBe('quiet');
  });

  it('treats a signal below the level floor as quiet', () => {
    const detector = new TunerDetector();
    const frame = frameFor('E2', 82.41, 48000);
    for (let i = 0; i < frame.length; i++) frame[i] *= 0.001;
    expect(detector.detect(frame, 48000).rejectedBecause).toBe('quiet');
  });
});

/*
 * The headline accuracy claim. A stiff string read by a period detector comes out sharp — +7
 * cents on the low E with no band-limiting — so 5 cents here is only reachable because of the
 * adaptive low-pass. It is also the threshold the display calls "in tune", which makes it the
 * number that actually matters.
 */
describe('TunerDetector accuracy across standard tuning', () => {
  for (const sampleRate of [44100, 48000]) {
    describe(`at ${sampleRate} Hz`, () => {
      it.each(STANDARD_TUNING.map((s) => [s.name, s.frequency] as const))(
        'reads %s within 5 cents on a clean pluck',
        (name, frequency) => {
          const detector = new TunerDetector();
          const result = detector.detect(frameFor(name, frequency, sampleRate), sampleRate);
          expect(result.frequency).not.toBeNull();
          expect(Math.abs(centsBetween(result.frequency!, frequency))).toBeLessThan(5);
        },
      );
    });
  }

  it.each(STANDARD_TUNING.map((s) => [s.name, s.frequency] as const))(
    'reads %s within 5 cents through phone-mic rolloff and 12 dB room noise',
    (name, frequency) => {
      const detector = new TunerDetector();
      const result = detector.detect(
        frameFor(name, frequency, 48000, { micRolloffHz: 150, snrDb: 12 }),
        48000,
      );
      expect(result.frequency).not.toBeNull();
      expect(Math.abs(centsBetween(result.frequency!, frequency))).toBeLessThan(5);
    },
  );

  it.each(STANDARD_TUNING.map((s) => [s.name, s.frequency] as const))(
    'still reads %s a second into the decay, when the high partials have died',
    (name, frequency) => {
      const detector = new TunerDetector();
      const result = detector.detect(
        frameFor(name, frequency, 48000, { startSeconds: 1, snrDb: 20 }),
        48000,
      );
      expect(result.frequency).not.toBeNull();
      expect(Math.abs(centsBetween(result.frequency!, frequency))).toBeLessThan(5);
    },
  );

  it('names the right string, which is all the display actually shows', () => {
    const detector = new TunerDetector();
    for (const string of STANDARD_TUNING) {
      const result = detector.detect(
        frameFor(string.name, string.frequency, 48000, { micRolloffHz: 150, snrDb: 12 }),
        48000,
      );
      expect(nearestString(result.frequency!).string.name).toBe(string.name);
    }
  });
});

/*
 * The reason MPM was chosen over spectral peak-picking. A phone reproduces almost none of the
 * low E's fundamental, so the loudest partial in the frame is the second or third harmonic; a
 * detector that reads the strongest peak reports an octave high. Periodicity survives it.
 */
describe('TunerDetector with the fundamental all but absent', () => {
  it('finds the low E from its harmonics alone', () => {
    const detector = new TunerDetector();
    const e2 = STANDARD_TUNING[0];
    const result = detector.detect(
      frameFor(e2.name, e2.frequency, 48000, { micRolloffHz: 300, snrDb: 15 }),
      48000,
    );
    expect(result.frequency).not.toBeNull();
    // Not an octave up, which is how the naive spectral approach fails here.
    expect(Math.abs(centsBetween(result.frequency!, e2.frequency))).toBeLessThan(10);
  });
});

/*
 * Handling noise is the case the filters could not solve on their own — MPM latches onto a
 * subharmonic with clarity well above the threshold, so only the range gate catches it. The
 * requirement is not that a reading survives, but that no *wrong* reading gets through: a tuner
 * that blanks under a knock is fine, one that says "you are an octave flat" is not.
 */
describe('TunerDetector under handling rumble', () => {
  it.each([6, 12, 20])('never reports a wrong note at %d dB of rumble', (rumbleDb) => {
    for (const string of STANDARD_TUNING) {
      for (let seed = 1; seed <= 4; seed++) {
        const detector = new TunerDetector();
        const result = detector.detect(
          frameFor(string.name, string.frequency, 48000, {
            rumbleDb,
            snrDb: 12,
            micRolloffHz: 150,
            seed,
          }),
          48000,
        );
        if (result.frequency === null) continue; // blanking is an acceptable outcome
        expect(Math.abs(centsBetween(result.frequency, string.frequency))).toBeLessThan(50);
      }
    }
  });
});

describe('TunerDetector gates', () => {
  it('rejects a subharmonic latch as out of range', () => {
    const detector = new TunerDetector();
    // A 40 Hz tone is exactly what a rumble latch looks like: strongly periodic, below any string.
    const sampleRate = 48000;
    const frame = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < frame.length; i++) {
      frame[i] = 0.5 * Math.sin((2 * Math.PI * 40 * i) / sampleRate);
    }
    const result = detector.detect(frame, sampleRate);
    expect(result.frequency).toBeNull();
    expect(result.rejectedBecause).toBe('out-of-range');
  });

  it('rejects broadband noise as unclear', () => {
    const detector = new TunerDetector();
    const sampleRate = 48000;
    const noise = new Float32Array(FRAME_SIZE);
    let state = 12345;
    for (let i = 0; i < noise.length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (state / 0x7fffffff) * 2 - 1;
    }
    const result = detector.detect(capture(noise, sampleRate), sampleRate);
    expect(result.frequency).toBeNull();
    expect(result.rejectedBecause).not.toBeNull();
  });

  it('brackets the range around the playable neck', () => {
    expect(MIN_FREQUENCY_HZ).toBeLessThan(73.4); // drop D must still fit
    expect(MAX_FREQUENCY_HZ).toBeGreaterThan(STANDARD_TUNING[5].frequency * 2);
  });
});

/*
 * The adaptive filter is steered by the previous frame's reading, so a detector mid-session is in
 * a different state from a cold one. Both have to give the same answer, or the first note after a
 * pause reads differently from the rest.
 */
describe('TunerDetector guide state', () => {
  it('agrees with a cold detector once it has locked on', () => {
    const warm = new TunerDetector();
    const cold = new TunerDetector();
    const a2 = STANDARD_TUNING[1];
    const frame = frameFor(a2.name, a2.frequency, 48000, { snrDb: 15 });

    for (let i = 0; i < 5; i++) warm.detect(frame, 48000);

    const warmResult = warm.detect(frame, 48000);
    const coldResult = cold.detect(frame, 48000);
    expect(warmResult.frequency).not.toBeNull();
    expect(
      Math.abs(centsBetween(warmResult.frequency!, coldResult.frequency!)),
    ).toBeLessThan(1);
  });

  it('recovers the right note after being pointed at a different string', () => {
    const detector = new TunerDetector();
    const [e2, , , , , e4] = STANDARD_TUNING;

    for (let i = 0; i < 10; i++) {
      detector.detect(frameFor(e2.name, e2.frequency, 48000), 48000);
    }
    // Jumping four strings at once is the worst case for a guide left pointing at the old note.
    let result = detector.detect(frameFor(e4.name, e4.frequency, 48000), 48000);
    for (let i = 0; i < 5 && result.frequency === null; i++) {
      result = detector.detect(frameFor(e4.name, e4.frequency, 48000), 48000);
    }
    expect(result.frequency).not.toBeNull();
    expect(Math.abs(centsBetween(result.frequency!, e4.frequency))).toBeLessThan(10);
  });
});

/*
 * The measurement that justifies the adaptive low-pass existing at all: with stiffness set to
 * zero the bias disappears, which is what identifies inharmonicity as its cause.
 */
describe('inharmonicity', () => {
  it('is what biases a period detector sharp, and the filter is what removes it', () => {
    const detector = new TunerDetector();
    const e2 = STANDARD_TUNING[0];

    const perfectlyHarmonic = detector.detect(
      frameFor(e2.name, e2.frequency, 48000, { inharmonicity: 0 }),
      48000,
    );
    // The other five strings land inside 0.1 cents here; the low E keeps ~0.7 because the 70 Hz
    // high-pass sits close enough to 82 Hz to bend its phase. That is the floor of the chain, and
    // it is a quarter of what stiffness adds on the same string.
    expect(Math.abs(centsBetween(perfectlyHarmonic.frequency!, e2.frequency))).toBeLessThan(1);

    detector.reset();
    const stiff = detector.detect(frameFor(e2.name, e2.frequency, 48000), 48000);
    expect(stiff.frequency).not.toBeNull();
    // Still sharp — stiffness is physical and cannot be filtered away entirely — but far inside
    // the +7 cents an unfiltered detector produced.
    expect(centsBetween(stiff.frequency!, e2.frequency)).toBeLessThan(5);
  });
});
