/*
 * The progress bar, which is an estimate and says so.
 *
 * The backend answers once, with an MP3. Between the tap and that answer it reverse-geocodes,
 * asks a model for facts, asks it again for a script, and pays a voice to read it - four steps
 * the browser cannot observe. So this is a clock, not a measurement: it walks a bar across
 * roughly the time the whole thing takes and names the step it is probably on.
 *
 * Two rules keep an estimate from becoming a lie:
 *
 *  - It stops at 95%. A bar that reaches the end and then sits there is worse than no bar,
 *    because it says "done" about something that is not.
 *  - The last stage is open-ended. Past the estimate the label stops advancing rather than
 *    inventing a fifth step; the bar creeps and the words stay honest.
 */

/** Measured on a warm function: about twenty seconds, most of it the voice. */
export const TOTAL_MS = 22_000;

/** The fraction the bar will not go past until the audio is actually here. */
export const CEILING = 0.95;

export type Stage = 'researching' | 'writing' | 'speaking' | 'finishing';

const STAGES: ReadonlyArray<{ from: number; stage: Stage }> = [
  { from: 0, stage: 'researching' },
  { from: 0.25, stage: 'writing' },
  { from: 0.55, stage: 'speaking' },
  { from: 0.85, stage: 'finishing' },
];

export function progressAt(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.min(elapsedMs / TOTAL_MS, CEILING);
}

export function stageAt(progress: number): Stage {
  let stage: Stage = STAGES[0].stage;
  for (const step of STAGES) {
    if (progress >= step.from) stage = step.stage;
  }
  return stage;
}

/**
 * When to admit it is taking too long.
 *
 * Not an error - the request is still running and may still answer - but past this the reader
 * deserves to be told that this is not the normal case, rather than watching a bar sit at 95%
 * and wondering whether the app has died.
 */
export const SLOW_MS = 30_000;
