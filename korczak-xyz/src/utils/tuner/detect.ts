/*
 * Pitch detection for the tuner: McLeod (MPM) over a band-limited frame, behind three gates.
 *
 * Why MPM. The detector has to work from *periodicity*, not from a spectral peak, because the
 * fundamental it is looking for is the part a phone is worst at. An iPhone microphone barely
 * reproduces the low E's 82 Hz, and iOS's voice-processing path high-passes near 100 Hz on top of
 * that — so the loudest thing in the frame is routinely the second or third harmonic. An
 * autocorrelation-family method still finds the right period from those harmonics alone;
 * FFT peak-picking reads an octave high. Measured against YIN and AMDF on synthetic plucked
 * strings, MPM was ~10x faster (its NSDF is FFT-accelerated) and, unlike YIN, never octave-flipped
 * under noise — YIN produced gross errors on 17% of frames at 6 dB SNR where MPM produced none.
 * MPM's normalised NSDF also yields the 0..1 clarity value the gates below depend on.
 *
 * Why the frame gets low-passed twice over. A real string is stiff, so its partials are stretched
 * sharp of exact harmonics, and a period detector reading all of them settles on a period shorter
 * than the fundamental's. Measured: with stiffness set to zero the error is 0.00 cents; with
 * realistic values it is +7 cents on the low E. Keeping only the first several partials removes
 * the pull, but no single cut-off serves the whole instrument — one low enough to fix the wound
 * strings takes the high E's own harmonics with it. So the cut-off tracks the note being played,
 * which held the worst-case error to ~3 cents across all six strings where a fixed 1200 Hz left
 * 5.4 cents on the low E.
 *
 * Why there is a range gate. Handling noise — a hand bumping the phone, 25-55 Hz — makes MPM latch
 * onto a subharmonic *with clarity above 0.9*, so the clarity gate does not catch it. Steeper
 * high-passing does not fix it either; an 8th-order high-pass at 75 Hz still failed. Every such
 * latch lands below the lowest string, so a plain frequency range removes them. With the range
 * gate plus a median window, simulated sessions under a +12 dB rumble burst produced zero wrong
 * readings — the display goes blank instead, which is the right way for a tuner to fail.
 */

import { PitchDetector } from 'pitchy';
import { lowpass, rms } from './biquad';

/** 4096 at 48 kHz is 85 ms — about seven periods of the low E, and short enough to feel live. */
export const FRAME_SIZE = 4096;

/** Nothing below this is a guitar string; drop D at 73.4 Hz is the lowest note worth allowing. */
export const MIN_FREQUENCY_HZ = 68;
/** Above the 24th fret of the high E. Anything higher is a harmonic or a squeak. */
export const MAX_FREQUENCY_HZ = 1320;

export const MIN_CLARITY = 0.9;

/** Roughly -50 dBFS. Below this the frame is room tone and detecting on it only invents notes. */
export const MIN_RMS = 0.003;

/*
 * The adaptive low-pass keeps partials up to ~6x the fundamental. Below 700 Hz the filter starts
 * eating the high E's own harmonics; above 2500 Hz it stops suppressing the stretched partials
 * that bias the wound strings sharp.
 */
const PARTIALS_KEPT = 6;
const MIN_ADAPTIVE_CUTOFF_HZ = 700;
const MAX_ADAPTIVE_CUTOFF_HZ = 2500;

export function adaptiveCutoff(fundamentalHz: number): number {
  return Math.min(
    MAX_ADAPTIVE_CUTOFF_HZ,
    Math.max(MIN_ADAPTIVE_CUTOFF_HZ, PARTIALS_KEPT * fundamentalHz),
  );
}

/** Why a frame produced no reading — the display turns this into something the user can act on. */
export type RejectionReason = 'quiet' | 'unclear' | 'out-of-range';

export interface Detection {
  /** The detected fundamental, or null when the frame failed a gate. */
  readonly frequency: number | null;
  readonly clarity: number;
  readonly rms: number;
  readonly rejectedBecause: RejectionReason | null;
}

/**
 * How many frames a previous reading stays usable as the guide for the adaptive filter. At ~30
 * frames a second this is about half a second, well inside the time a plucked note holds pitch.
 */
const GUIDE_LIFETIME_FRAMES = 15;

export interface DetectorOptions {
  frameSize?: number;
  minClarity?: number;
  minRms?: number;
}

/**
 * Holds the pitchy detector, its scratch buffer and the running estimate that steers the adaptive
 * filter. Stateful only as an optimisation — `detect` on the same frame always gives the same
 * answer for a given guide, and `reset` returns it to a cold start.
 */
export class TunerDetector {
  private readonly pitchDetector: PitchDetector<Float32Array>;
  private readonly filtered: Float32Array;
  private readonly minClarity: number;
  private readonly minRms: number;
  private guideHz: number | null = null;
  private guideAgeFrames = 0;

  constructor({ frameSize = FRAME_SIZE, minClarity = MIN_CLARITY, minRms = MIN_RMS }: DetectorOptions = {}) {
    this.pitchDetector = PitchDetector.forFloat32Array(frameSize);
    // pitchy's own volume gate is a blunt instrument that returns 0 Hz; gate on RMS here instead,
    // where a quiet frame can be reported as quiet rather than as a bogus reading.
    this.pitchDetector.minVolumeDecibels = -100;
    this.filtered = new Float32Array(frameSize);
    this.minClarity = minClarity;
    this.minRms = minRms;
  }

  /**
   * @param frame Time-domain samples, already high-passed at 70 Hz and low-passed at 2500 Hz by
   *   the capture graph. Length must match the frame size the detector was built for.
   */
  detect(frame: Float32Array, sampleRate: number): Detection {
    const level = rms(frame);
    if (level < this.minRms) {
      this.expireGuide();
      return { frequency: null, clarity: 0, rms: level, rejectedBecause: 'quiet' };
    }

    // With a fresh guide the coarse pass is redundant: pitch barely moves in a thirtieth of a
    // second, so steady state costs one MPM call rather than two.
    let guide = this.guideHz;
    if (guide === null || this.guideAgeFrames > GUIDE_LIFETIME_FRAMES) {
      const [coarse, coarseClarity] = this.pitchDetector.findPitch(frame, sampleRate);
      guide = inRange(coarse) && coarseClarity >= this.minClarity ? coarse : null;
    }

    // With no usable guide, open the filter as wide as it goes rather than guessing a note: a
    // wrong guess narrows the band around the wrong place and suppresses the real fundamental.
    const cutoff = guide === null ? MAX_ADAPTIVE_CUTOFF_HZ : adaptiveCutoff(guide);
    lowpass(frame, cutoff, sampleRate, 4, this.filtered);
    const [frequency, clarity] = this.pitchDetector.findPitch(this.filtered, sampleRate);

    if (clarity < this.minClarity) {
      this.expireGuide();
      return { frequency: null, clarity, rms: level, rejectedBecause: 'unclear' };
    }
    if (!inRange(frequency)) {
      this.expireGuide();
      return { frequency: null, clarity, rms: level, rejectedBecause: 'out-of-range' };
    }

    this.guideHz = frequency;
    this.guideAgeFrames = 0;
    return { frequency, clarity, rms: level, rejectedBecause: null };
  }

  private expireGuide(): void {
    this.guideAgeFrames++;
    if (this.guideAgeFrames > GUIDE_LIFETIME_FRAMES) this.guideHz = null;
  }

  reset(): void {
    this.guideHz = null;
    this.guideAgeFrames = 0;
  }
}

function inRange(frequency: number): boolean {
  return frequency >= MIN_FREQUENCY_HZ && frequency <= MAX_FREQUENCY_HZ;
}
