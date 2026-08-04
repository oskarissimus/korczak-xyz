/*
 * A synthesiser for plucked steel strings, used to test the detector.
 *
 * There is no jsdom and no audio hardware in this project's tests, so a real guitar is not a
 * reachable state. This stands in for one, and it exists because the detector's constants were
 * chosen by measurement rather than by taste: without a signal source that reproduces the things
 * that actually break phone tuners, those numbers would be unfalsifiable.
 *
 * What it models, and why each part earns its place:
 *
 * - **Stiffness.** A real string's partials sit at n*f0*sqrt(1 + B n^2), progressively sharp of
 *   exact harmonics. This is the reason the detector low-passes adaptively; with B set to zero the
 *   measured error collapses to 0.00 cents and the filter looks like superstition.
 * - **Per-harmonic decay.** High partials die first, so a note sounds different a second after the
 *   pluck than at the attack — and reads differently too.
 * - **Pick position.** Plucking a fifth of the way along nulls every fifth harmonic.
 * - **Microphone rolloff.** A phone barely reproduces 82 Hz. This is what makes periodicity-based
 *   detection non-negotiable.
 * - **Rumble.** A hand bumping the phone. The one thing that still defeated the filters, and the
 *   reason there is a frequency range gate.
 */

/** Realistic inharmonicity coefficients: wound bass strings are far stiffer than plain trebles. */
export const STRING_INHARMONICITY: Readonly<Record<string, number>> = {
  E2: 1.0e-4,
  A2: 7e-5,
  D3: 5e-5,
  G3: 2e-5,
  B3: 8e-6,
  E4: 5e-6,
};

export interface PluckOptions {
  frequency: number;
  sampleRate: number;
  /** Number of samples to generate. */
  length: number;
  /** Inharmonicity coefficient B. Zero gives a perfectly harmonic (physically impossible) string. */
  inharmonicity?: number;
  /** Seconds into the note the frame starts — 0 is the attack, where high partials dominate. */
  startSeconds?: number;
  /** Spectral slope: amplitude of harmonic n falls as n^-brightness. Lower is brighter. */
  brightness?: number;
  /** Fraction along the string the pick strikes, which nulls harmonics at multiples of 1/pos. */
  pickPosition?: number;
  /** Corner below which the microphone rolls off at 12 dB/octave. Zero disables. */
  micRolloffHz?: number;
  /** Signal-to-noise ratio in dB for added broadband room noise. */
  snrDb?: number;
  /** Level of 25/41/55 Hz handling rumble relative to the signal, in dB. */
  rumbleDb?: number;
  seed?: number;
}

/** A small deterministic PRNG, so a failing test always fails the same way. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARMONIC_COUNT = 30;

export function pluckedString({
  frequency,
  sampleRate,
  length,
  inharmonicity = 5e-5,
  startSeconds = 0,
  brightness = 1.2,
  pickPosition = 0.2,
  micRolloffHz = 0,
  snrDb = Infinity,
  rumbleDb = -Infinity,
  seed = 1,
}: PluckOptions): Float32Array {
  const random = mulberry32(seed);
  const phases = Array.from({ length: HARMONIC_COUNT + 1 }, () => random() * 2 * Math.PI);
  const out = new Float32Array(length);

  for (let h = 1; h <= HARMONIC_COUNT; h++) {
    const partialHz = h * frequency * Math.sqrt(1 + inharmonicity * h * h);
    if (partialHz > sampleRate * 0.45) break;

    let amplitude = Math.pow(h, -brightness) * Math.abs(Math.sin(Math.PI * h * pickPosition));
    if (micRolloffHz > 0 && partialHz < micRolloffHz) {
      amplitude *= Math.pow(partialHz / micRolloffHz, 2);
    }

    const tau = 2.5 / Math.pow(h, 0.6); // seconds; higher partials decay faster
    const omega = (2 * Math.PI * partialHz) / sampleRate;
    for (let i = 0; i < length; i++) {
      const t = startSeconds + i / sampleRate;
      out[i] += amplitude * Math.exp(-t / tau) * Math.sin(omega * i + phases[h]);
    }
  }

  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;

  let power = 0;
  for (let i = 0; i < length; i++) power += out[i] * out[i];
  const signalRms = Math.sqrt(power / length);

  if (Number.isFinite(snrDb)) {
    const noiseRms = signalRms * Math.pow(10, -snrDb / 20);
    for (let i = 0; i < length; i++) {
      // Four uniforms summed is a serviceable Gaussian, and cheaper than Box-Muller.
      out[i] += noiseRms * (random() + random() + random() + random() - 2) * 1.2;
    }
  }

  if (Number.isFinite(rumbleDb)) {
    const level = signalRms * Math.pow(10, rumbleDb / 20);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      out[i] +=
        level *
        (Math.sin(2 * Math.PI * 25 * t) +
          0.7 * Math.sin(2 * Math.PI * 41 * t + 1) +
          0.5 * Math.sin(2 * Math.PI * 55 * t + 2));
    }
  }

  return out;
}
