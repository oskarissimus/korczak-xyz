// Momentary typing speed for the live pulse tile.
//
// The WPM shown in the stats bar is cumulative over the whole session, which
// hides the fact that typing comes in bursts and stalls. This module turns the
// raw keystroke times into a smooth, continuously-varying WPM curve over the
// last few seconds.
import type { RecentChar } from './types';

// How much history the pulse chart shows.
export const PULSE_WINDOW_MS = 5000;

// Points across the window (~83ms apart), enough to look continuous at this size.
export const PULSE_SAMPLES = 60;

// Time constant of the smoothing pass below: how wide a neighbourhood each
// sample borrows from. Big enough to round the corners at the keystrokes,
// small enough not to smear a real burst.
export const PULSE_SMOOTH_MS = 250;

// The keystroke just before the window's left edge supplies that edge's gap, so
// fetch a little further back than we draw.
export const PULSE_LOOKBACK_MS = PULSE_WINDOW_MS + 2000;

// Standard "word" = 5 characters; a steady gap of g ms between keystrokes is
// therefore 60000 / 5 / g = 12000/g WPM. Same constant as WPM_FROM_MS in
// keyStats.ts, so the pulse and the per-key stats page agree.
const WPM_PER_CHAR_PER_MS = 12000;

// Floor for a keystroke gap, so key-repeat bursts can't divide by ~zero.
const MIN_GAP_MS = 30;

export interface PulseSample {
  t: number; // epoch ms
  wpm: number;
}

// Momentary WPM at each sample time, over the window ending at `now`.
//
// Each keystroke gets an instantaneous speed from the gap it took (12000/gap),
// those points are linearly interpolated over time — continuous by construction,
// so steady typing draws a flat line rather than a sawtooth — and the curve is
// then smoothed a little to round the corners at the keystrokes.
//
// The silence since the last keystroke counts too: the curve's right edge is
// 12000/max(lastGap, now - lastKey), so a hesitation bends the pulse down
// toward zero instead of freezing it at the last keystroke's speed.
//
// `chars` must be ascending by `t`; pass everything from the last
// PULSE_LOOKBACK_MS so the left edge has its preceding keystroke.
export function samplePulse(chars: RecentChar[], now: number): PulseSample[] {
  const step = PULSE_WINDOW_MS / (PULSE_SAMPLES - 1);
  const start = now - PULSE_WINDOW_MS;

  // Instantaneous speed at each keystroke, from the gap since the previous
  // correct one. Correct chars only, so a typo-and-fix stretch reads as one
  // long gap — a slowdown — matching the net WPM in the stats bar.
  const knotT: number[] = [];
  const knotV: number[] = [];
  let prevT: number | null = null;
  for (const c of chars) {
    if (!c.correct) continue;
    if (prevT != null) {
      const gap = Math.max(c.t - prevT, MIN_GAP_MS);
      knotT.push(c.t);
      knotV.push(WPM_PER_CHAR_PER_MS / gap);
    }
    prevT = c.t;
  }

  // The gap currently in progress: while typing steadily this pins the right
  // edge at the latest speed; during a stall it decays hyperbolically to zero.
  if (prevT != null) {
    const lastGap = knotV.length > 0 ? WPM_PER_CHAR_PER_MS / knotV[knotV.length - 1] : MIN_GAP_MS;
    const pending = Math.max(now - prevT, lastGap, MIN_GAP_MS);
    knotT.push(now);
    knotV.push(WPM_PER_CHAR_PER_MS / pending);
  }

  // Sample the piecewise-linear signal through the knots; hold flat before the
  // first knot and (only possible at t = now) after the last.
  const samples: PulseSample[] = [];
  let seg = 0;
  for (let i = 0; i < PULSE_SAMPLES; i++) {
    const t = start + i * step;
    let wpm = 0;
    if (knotT.length > 0) {
      while (seg < knotT.length && knotT[seg] < t) seg++;
      if (seg === 0) wpm = knotV[0];
      else if (seg === knotT.length) wpm = knotV[knotT.length - 1];
      else {
        const t0 = knotT[seg - 1];
        const t1 = knotT[seg];
        const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        wpm = knotV[seg - 1] + (knotV[seg] - knotV[seg - 1]) * f;
      }
    }
    samples.push({ t, wpm });
  }

  // Forward+backward exponential pass: two directions cancel each other's phase
  // lag, so smoothing rounds the corners without shifting where a burst peaks.
  const alpha = 1 - Math.exp(-step / PULSE_SMOOTH_MS);
  let acc = samples[0].wpm;
  for (let i = 1; i < samples.length; i++) {
    acc += alpha * (samples[i].wpm - acc);
    samples[i].wpm = acc;
  }
  acc = samples[samples.length - 1].wpm;
  for (let i = samples.length - 2; i >= 0; i--) {
    acc += alpha * (samples[i].wpm - acc);
    samples[i].wpm = acc;
  }

  return samples;
}

// Top of the vertical scale. Quantised so the axis doesn't twitch every frame,
// and anchored at twice the session average so that average line sits near
// mid-height — above it means you're currently faster than your own pace.
export function pulseDomainTop(averageWpm: number, peakWpm: number): number {
  const wanted = Math.max(averageWpm * 2, peakWpm, 40);
  return Math.ceil(wanted / 20) * 20;
}
