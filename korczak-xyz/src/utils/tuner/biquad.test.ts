import { describe, expect, it } from 'vitest';
import { butterworthQs, highpass, lowpass, rms } from './biquad';

const SAMPLE_RATE = 48000;

function sine(frequency: number, length = 8192, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

/** Amplitude of the settled part of a filtered tone, skipping the startup transient. */
function settledAmplitude(frame: Float32Array): number {
  let peak = 0;
  for (let i = Math.floor(frame.length / 2); i < frame.length; i++) {
    peak = Math.max(peak, Math.abs(frame[i]));
  }
  return peak;
}

describe('butterworthQs', () => {
  it('gives the textbook Q pair for a 4th-order cascade', () => {
    const [first, second] = butterworthQs(4);
    expect(first).toBeCloseTo(0.5412, 4);
    expect(second).toBeCloseTo(1.3066, 4);
  });

  it('gives a single 0.7071 for one biquad', () => {
    expect(butterworthQs(2)[0]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('refuses odd orders, which cannot be built from biquads alone', () => {
    expect(() => butterworthQs(3)).toThrow();
    expect(() => butterworthQs(0)).toThrow();
  });
});

describe('lowpass', () => {
  it('passes a tone well below the cutoff essentially untouched', () => {
    expect(settledAmplitude(lowpass(sine(200), 2000, SAMPLE_RATE))).toBeGreaterThan(0.98);
  });

  it('is 3 dB down at the cutoff, which is what makes it Butterworth', () => {
    expect(settledAmplitude(lowpass(sine(1000), 1000, SAMPLE_RATE))).toBeCloseTo(0.707, 1);
  });

  it('rolls off at 24 dB per octave at 4th order', () => {
    const oneOctaveUp = settledAmplitude(lowpass(sine(2000), 1000, SAMPLE_RATE));
    const twoOctavesUp = settledAmplitude(lowpass(sine(4000), 1000, SAMPLE_RATE));
    // ~24 dB is a factor of ~16 per octave; allow slack for the transition band.
    expect(oneOctaveUp).toBeLessThan(0.08);
    expect(twoOctavesUp).toBeLessThan(oneOctaveUp / 8);
  });

  /*
   * The detector calls this every frame. Reusing the caller's buffer is the difference between
   * allocating 16 kB thirty times a second and allocating none.
   */
  it('writes into a supplied buffer without allocating', () => {
    const input = sine(200);
    const into = new Float32Array(input.length);
    const result = lowpass(input, 2000, SAMPLE_RATE, 4, into);
    expect(result).toBe(into);
    expect(input[100]).toBeCloseTo(sine(200)[100], 10); // input untouched
  });

  it('clamps a cutoff above Nyquist instead of folding into noise', () => {
    const result = lowpass(sine(200), SAMPLE_RATE, SAMPLE_RATE);
    expect(Number.isFinite(settledAmplitude(result))).toBe(true);
    expect(settledAmplitude(result)).toBeGreaterThan(0.5);
  });
});

describe('highpass', () => {
  /*
   * The pair of frequencies that matter: 70 Hz has to leave the low E at 82 Hz usable while
   * pushing handling rumble down far enough to matter.
   */
  it('leaves the low E mostly intact at the 70 Hz corner used by the capture graph', () => {
    expect(settledAmplitude(highpass(sine(82.41), 70, SAMPLE_RATE))).toBeGreaterThan(0.6);
  });

  it('pushes 25 Hz handling rumble far below the string it would otherwise mask', () => {
    const rumble = settledAmplitude(highpass(sine(25), 70, SAMPLE_RATE));
    const string = settledAmplitude(highpass(sine(82.41), 70, SAMPLE_RATE));
    expect(rumble).toBeLessThan(string / 20);
  });
});

describe('rms', () => {
  it('is the familiar 1/sqrt(2) for a unit sine', () => {
    expect(rms(sine(440))).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is zero for silence', () => {
    expect(rms(new Float32Array(1024))).toBe(0);
  });

  it('scales with amplitude', () => {
    expect(rms(sine(440, 8192, 0.5))).toBeCloseTo(Math.SQRT1_2 / 2, 2);
  });
});
