/*
 * How a quest's creatures move (owner, 30 Oct 2026: "generate the enemies like the other NPCs").
 * A beast or a blob is a TRELLIS model like a clue's (`creaturePrompt`, `ensureCreatureModel`), and
 * nothing rigs it: Meshy's rigging and our own `selfRig` both fit a human skeleton, and a rat, a
 * wolf, a slime or a beetle has no bones in common with one, nor with each other. So it moves the
 * way a puppet does, from outside, and the same few numbers move any shape:
 *
 * - **Its legs** are whatever is below `LEG_TOP` of its height. In the vertex shader
 *   (`components/Rpg/creatureBody.ts`) that part swings along its length, more the nearer the ground,
 *   in diagonal pairs (front-left with back-right), and lifts on the way forward: a trot. A body that
 *   came out without legs only shuffles at the hem, which reads as crawling.
 * - **A blob hops**, squashing as it lands and stretching as it leaves, and swings nothing.
 * - **The bite** is a lunge, nose down; **a hit** throws it back, nose up; **it dies** rolling onto
 *   its side and sinking into the ground, and is gone.
 *
 * Plain numbers and no Three.js, so it is tested (`creature.test.ts`).
 */

export type CreatureShape = 'beast' | 'blob';

/** The share of the height that is legs: below it a vertex swings, the lower the more. */
export const LEG_TOP = 0.45;
/** Seconds of the lunge, of the flinch, and of falling and sinking. */
export const BITE_SECONDS = 0.45;
export const FLINCH_SECONDS = 0.3;
export const DEATH_SECONDS = 1.6;
/** Its fastest, the chase (`updateEnemies`), at which the gait is at its fullest. */
export const RUN_SPEED = 3.2;

export interface CreatureState {
  /** Radians through the stride: advanced by the distance covered (`stride`), and by time when still. */
  phase: number;
  /** Ground speed now, m/s. */
  speed: number;
  /** Seconds since it started each, or null when it is not doing it. */
  bite: number | null;
  flinch: number | null;
  death: number | null;
  /** Seconds alive, for the breathing. */
  time: number;
}

/** What the scene does to the body: all in the creature's own frame, +Z its front, metres and radians. */
export interface CreaturePose {
  /** Up off the ground. */
  lift: number;
  /** Down into it, as it dies. */
  sink: number;
  /** Forward along its front. */
  lunge: number;
  /** Nose down for positive (a turn about X). */
  pitch: number;
  /** Over onto its side (a turn about Z). */
  roll: number;
  /** Height multiplier; the width takes the inverse square root, so it keeps its volume. */
  squash: number;
  /** How far a leg swings, as a share of the height; 0 for a blob. */
  stride: number;
}

export function newCreature(seed = 0): CreatureState {
  return {
    phase: seed,
    speed: 0,
    bite: null,
    flinch: null,
    death: null,
    time: seed,
  };
}

/** Strides per metre for a body of `height`: a small thing patters, a big one lopes. */
export function cadence(height: number): number {
  return 1.6 / Math.max(0.3, height);
}

/** Moves the clocks on by `dt` at `speed`, ending a bite or a flinch that has run its course. */
export function step(s: CreatureState, dt: number, speed: number, height: number): void {
  s.speed = speed;
  s.time += dt;
  // Still, it shifts its weight now and then rather than freezing mid-stride.
  s.phase += dt * (speed > 0.05 ? speed * cadence(height) * Math.PI : 0.6);
  if (s.bite !== null && (s.bite += dt) >= BITE_SECONDS) s.bite = null;
  if (s.flinch !== null && (s.flinch += dt) >= FLINCH_SECONDS) s.flinch = null;
  if (s.death !== null) s.death = Math.min(DEATH_SECONDS, s.death + dt);
}

/** The pose now, for a body of `height` metres. */
export function pose(s: CreatureState, shape: CreatureShape, height: number): CreaturePose {
  const gait = Math.min(1, s.speed / RUN_SPEED);
  const p: CreaturePose = {
    lift: 0,
    sink: 0,
    lunge: 0,
    pitch: 0,
    roll: 0,
    squash: 1,
    stride: 0,
  };
  const breath = Math.sin(s.time * 2.4) * 0.025;
  if (shape === 'blob') {
    // A hop a stride: up in the middle of it, squashed at the bottom, stretched on the way up.
    const hop = Math.abs(Math.sin(s.phase / 2));
    p.lift = hop * height * 0.28 * gait;
    p.squash = 1 + breath * 1.5 + gait * (hop > 0.25 ? 0.1 * hop : -0.18 * (1 - hop / 0.25));
  } else {
    p.stride = (0.03 + 0.13 * gait) * (s.death === null ? 1 : 0);
    // Two footfalls a stride: the body dips on each and rocks a little fore and aft.
    p.lift = Math.abs(Math.cos(s.phase)) * height * 0.035 * gait;
    p.pitch = Math.sin(s.phase * 2) * 0.05 * gait;
    p.squash = 1 + breath;
  }
  if (s.bite !== null) {
    const k = Math.sin((Math.PI * s.bite) / BITE_SECONDS);
    p.lunge += k * Math.max(0.35, height * 0.5);
    p.pitch += k * 0.3;
    if (shape === 'blob') p.squash *= 1 - 0.2 * k;
  }
  if (s.flinch !== null) {
    const k = Math.sin((Math.PI * s.flinch) / FLINCH_SECONDS);
    p.lunge -= k * 0.25;
    p.pitch -= k * 0.35;
  }
  if (s.death !== null) {
    const fall = Math.min(1, s.death / (DEATH_SECONDS * 0.4));
    const under = Math.max(0, (s.death - DEATH_SECONDS * 0.55) / (DEATH_SECONDS * 0.45));
    p.lift = 0;
    p.lunge = 0;
    p.pitch = 0;
    // A blob does not fall over; it slumps flat.
    if (shape === 'blob') p.squash = 1 - 0.6 * fall;
    else p.roll = fall * fall * (Math.PI / 2);
    p.sink = under * height * 1.1;
  }
  return p;
}

/** Done dying: under the ground and ready to be taken away. */
export function gone(s: CreatureState): boolean {
  return s.death !== null && s.death >= DEATH_SECONDS;
}
