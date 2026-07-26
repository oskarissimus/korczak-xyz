// Momentary typing speed for the live pulse tile.
//
// The WPM shown in the stats bar is cumulative over the whole session, which
// hides the fact that typing comes in bursts and stalls. This module turns the
// raw keystroke times into a smooth, continuously-varying WPM curve over the
// last few seconds.
import type { RecentChar } from './types';

// How much history the pulse chart shows.
export const PULSE_WINDOW_MS = 5000;

// Smoothing time constant of the kernel below. Roughly "how far back a keystroke
// still counts": small enough to react within a word, large enough that one slow
// key is a dip rather than a spike.
export const PULSE_TAU_MS = 500;

// Points across the window (~83ms apart), enough to look continuous at this size.
export const PULSE_SAMPLES = 60;

// Keystrokes just left of the window still contribute to the samples near its
// left edge. Five time constants in, their weight is under 1% — negligible.
export const PULSE_LOOKBACK_MS = PULSE_WINDOW_MS + 5 * PULSE_TAU_MS;

// Standard "word" = 5 characters; chars/ms -> words/min is therefore
// 60000 / 5 = 12000. Same constant as WPM_FROM_MS in keyStats.ts, so a steady
// gap of g ms reads as 12000/g WPM in both places.
const WPM_PER_CHAR_PER_MS = 12000;

export interface PulseSample {
  t: number; // epoch ms
  wpm: number;
}

// Momentary WPM at each sample time, over the window ending at `now`.
//
// The estimate is a causal exponential kernel over the keystroke times:
//
//   rate(t) = sum over keys k <= t of exp(-(t - t_k) / TAU) / TAU   [chars per ms]
//
// Causal (nothing leaks back from keystrokes that haven't happened yet, so the
// right edge really is "now"), smooth, and it decays to zero when typing stops,
// so a pause reads as the pulse dying away. Typing steadily at gap g gives
// rate = 1/g, i.e. exactly 12000/g WPM.
//
// `chars` must be ascending by `t`; pass everything from the last
// PULSE_LOOKBACK_MS so the samples at the left edge are warmed up.
export function samplePulse(chars: RecentChar[], now: number): PulseSample[] {
  const step = PULSE_WINDOW_MS / (PULSE_SAMPLES - 1);
  const start = now - PULSE_WINDOW_MS;
  // Per-sample decay is constant because the samples are evenly spaced, so the
  // whole curve costs one pass over the samples plus one over the keystrokes.
  const decay = Math.exp(-step / PULSE_TAU_MS);

  const samples: PulseSample[] = [];
  let acc = 0;
  let next = 0;

  // Warm-up: fold in the keystrokes from before the window's left edge.
  while (next < chars.length && chars[next].t < start) {
    const c = chars[next++];
    if (c.correct) acc += Math.exp(-(start - c.t) / PULSE_TAU_MS);
  }

  for (let i = 0; i < PULSE_SAMPLES; i++) {
    const t = start + i * step;
    if (i > 0) acc *= decay;
    while (next < chars.length && chars[next].t <= t) {
      const c = chars[next++];
      // Correct chars only, so this matches the net WPM in the stats bar.
      if (c.correct) acc += Math.exp(-(t - c.t) / PULSE_TAU_MS);
    }
    samples.push({ t, wpm: (acc / PULSE_TAU_MS) * WPM_PER_CHAR_PER_MS });
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
