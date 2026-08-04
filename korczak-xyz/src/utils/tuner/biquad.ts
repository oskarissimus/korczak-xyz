/*
 * Butterworth filtering over a captured frame.
 *
 * The capture graph does its filtering with BiquadFilterNodes, but one of the filters has to run
 * here instead: the detector needs to see the same frame band-limited two different ways (see
 * detect.ts), and a Web Audio graph can only hand back what it has already filtered. So this
 * mirrors BiquadFilterNode — the same RBJ cookbook coefficients the spec prescribes — and the two
 * halves of the chain stay comparable.
 *
 * Each frame is filtered from zero state. The startup transient lasts a few dozen samples out of
 * 4096 and the detector is measuring periodicity over the whole window, so it costs nothing worth
 * carrying per-frame state around for.
 */

/**
 * The Q values that make a cascade of `order / 2` biquads add up to a Butterworth response —
 * a maximally flat passband, so the partials that survive the filter keep their relative sizes.
 */
export function butterworthQs(order: number): number[] {
  if (order < 2 || order % 2 !== 0) {
    throw new Error(`Butterworth cascade needs an even order of at least 2, got ${order}`);
  }
  const qs: number[] = [];
  for (let stage = 0; stage < order / 2; stage++) {
    qs.push(1 / (2 * Math.cos((Math.PI * (2 * stage + 1)) / (2 * order))));
  }
  return qs;
}

type BiquadKind = 'lowpass' | 'highpass';

function biquadStage(
  input: Float32Array,
  output: Float32Array,
  kind: BiquadKind,
  cutoffHz: number,
  q: number,
  sampleRate: number,
): void {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);

  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'lowpass') {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  } else {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    output[i] = y0;
  }
}

function butterworth(
  frame: Float32Array,
  kind: BiquadKind,
  cutoffHz: number,
  sampleRate: number,
  order: number,
  into?: Float32Array,
): Float32Array {
  // Above Nyquist the cookbook formulas fold over and the filter turns into noise; clamp instead.
  const cutoff = Math.min(cutoffHz, sampleRate * 0.49);
  const out = into && into.length === frame.length ? into : new Float32Array(frame.length);
  out.set(frame);
  for (const q of butterworthQs(order)) {
    biquadStage(out, out, kind, cutoff, q, sampleRate);
  }
  return out;
}

/**
 * Low-pass `frame` in place of a fresh array when `into` is supplied, so the detector can run
 * every frame without handing the garbage collector a new buffer 30 times a second.
 */
export function lowpass(
  frame: Float32Array,
  cutoffHz: number,
  sampleRate: number,
  order = 4,
  into?: Float32Array,
): Float32Array {
  return butterworth(frame, 'lowpass', cutoffHz, sampleRate, order, into);
}

export function highpass(
  frame: Float32Array,
  cutoffHz: number,
  sampleRate: number,
  order = 4,
  into?: Float32Array,
): Float32Array {
  return butterworth(frame, 'highpass', cutoffHz, sampleRate, order, into);
}

/** Root mean square of a frame — the level gate's input, and what the signal meter displays. */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
