/*
 * How long a character's line sits on screen before its voice is heard (owner, 10 Nov 2026: "do we
 * have a metric for the time between a character's text appearing and the sound starting?"). One
 * record per line spoken in a character's voice, kept for the session, for the developer console:
 * the number beside each line in *Dialogue*, and the median and p90 in *Performance*. The same
 * numbers go to Sentry Logs as `rpg.voice.lag` (`Rpg.tsx`), never the words.
 *
 * - `lagMs`: text on screen → the `<audio>` element's `playing`. A line held behind the hero's own
 *   is shown the moment its clip is in hand and the hero has finished (`speakLines`' `onStart`), so
 *   its lag is only the element starting; a line shown at once waits for its whole clip as well.
 * - `fetchMs`: from the line being asked to speak until its clip was in hand (0 when prefetched).
 * - `afterHeroMs`: the silence between the end of the hero's line and this one's first sound —
 *   what a player actually hears as a pause after a picked or typed line.
 */

export interface VoiceLag {
  at: number;
  who: string;
  text: string;
  lagMs: number;
  fetchMs: number;
  startMs: number;
  afterHeroMs: number | null;
  /** The clip was already asked for when the line came (a prefetch, or heard before). */
  cached: boolean;
  /** The answer to a line the hero typed. */
  free: boolean;
}

const LIMIT = 200;
let lags: VoiceLag[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function recordVoiceLag(lag: VoiceLag): void {
  lags = [...lags, lag].slice(-LIMIT);
  version += 1;
  for (const l of listeners) l();
}

export function voiceLags(): readonly VoiceLag[] {
  return lags;
}

export function subscribeVoiceLags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function voiceLagVersion(): number {
  return version;
}

/** The latest record for this speaker and line, for the transcript. */
export function lagFor(who: string, text: string): VoiceLag | undefined {
  for (let i = lags.length - 1; i >= 0; i--) if (lags[i].who === who && lags[i].text === text) return lags[i];
  return undefined;
}

/** Nearest-rank percentile, `p` in 0–1; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export interface LagSummary {
  n: number;
  median: number | null;
  p90: number | null;
}

export function summarize(values: readonly number[]): LagSummary {
  return { n: values.length, median: percentile(values, 0.5), p90: percentile(values, 0.9) };
}
