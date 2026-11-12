/*
 * A body that has stopped holding itself up (owner, 12 Nov 2026: "Dodajmy ragdoll jak jest
 * fragowane"). The physics half: a handful of points — the joints — joined by sticks, moved by
 * Verlet integration and held to their lengths by relaxation (Jakobsen, *Advanced Character
 * Physics*, the Hitman ragdoll). No physics engine: a person is ~17 points and ~45 sticks, which a
 * phone does in a fraction of a millisecond, and nothing here needs a contact solver beyond "not
 * below the ground".
 *
 * A stick is a length held between `lo` and `hi` times the length it had when the body went limp:
 * 1–1 for a bone, a band for a spine that bends a little, `lo` alone (with `hi` Infinity) for a limit
 * — a hand that may not fold back into its shoulder, a head that may not fold into its chest.
 *
 * Plain numbers and no Three.js, so it is tested (`ragdoll.test.ts`); `components/Rpg/ragdoll.ts`
 * reads the joints off a skeleton and turns the points back into bone rotations.
 */

export type Vec3 = [number, number, number];

export interface Stick {
  a: number;
  b: number;
  /** The length at rest; held between `rest * lo` and `rest * hi`. */
  rest: number;
  lo: number;
  hi: number;
}

export interface Body {
  /** xyz per point, now and one step ago (the velocity is their difference). */
  pos: Float64Array;
  prev: Float64Array;
  /** How far above the ground each point's surface is: a torso is thicker than a wrist. */
  radius: Float64Array;
  sticks: Stick[];
  /** Seconds not yet stepped (fixed steps of `STEP`). */
  carry: number;
  /** Seconds the body has barely moved; past `SLEEP_AFTER` it is `asleep` and costs nothing. */
  still: number;
  asleep: boolean;
}

export const GRAVITY = 9.8;
/** One step: fixed, so the same fall falls the same on a 30 Hz phone and a 144 Hz monitor. */
export const STEP = 1 / 60;
/** Relaxation passes per step: enough that a limb does not stretch visibly as it lands. */
export const ITERATIONS = 8;
/** Air: the share of the velocity kept each step. */
const DAMPING = 0.995;
/** Ground: the share of the sliding velocity lost each step a point touches it. */
const FRICTION = 0.35;
/** Moving less than this (metres a step) for `SLEEP_AFTER` seconds, it has come to rest. */
const SLEEP_SPEED = 0.0012;
const SLEEP_AFTER = 0.6;
/** A frame longer than this is not caught up on (a tab that was in the background). */
const MAX_FRAME = 0.1;

/** `[a, b, lo, hi]`: hi defaults to lo (a bone is `[a, b, 1]`), and `lo` alone with `hi` Infinity is a limit. */
export type StickSpec = [number, number, number, number?];

export function makeBody(points: Vec3[], sticks: StickSpec[], radius: number[] | number): Body {
  const n = points.length;
  const pos = new Float64Array(n * 3);
  points.forEach((p, i) => pos.set(p, i * 3));
  return {
    pos,
    prev: pos.slice(),
    radius: Float64Array.from({ length: n }, (_, i) => (typeof radius === 'number' ? radius : radius[i] ?? 0.05)),
    sticks: sticks.map(([a, b, lo, hi]) => ({ a, b, rest: dist(pos, a, b), lo, hi: hi ?? lo })),
    carry: 0,
    still: 0,
    asleep: false,
  };
}

/** Gives point `i` a velocity (m/s), as a blow does. */
export function kick(body: Body, i: number, v: Vec3) {
  for (let k = 0; k < 3; k++) body.prev[i * 3 + k] = body.pos[i * 3 + k] - v[k] * STEP;
  body.asleep = false;
  body.still = 0;
}

export function point(body: Body, i: number): Vec3 {
  return [body.pos[i * 3], body.pos[i * 3 + 1], body.pos[i * 3 + 2]];
}

function dist(p: Float64Array, a: number, b: number): number {
  return Math.hypot(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
}

/** Advances the body by `dt` seconds over ground whose height is `groundAt(x, z)`. */
export function stepBody(body: Body, dt: number, groundAt: (x: number, z: number) => number) {
  if (body.asleep) return;
  body.carry = Math.min(body.carry + dt, MAX_FRAME);
  while (body.carry >= STEP) {
    body.carry -= STEP;
    const moved = once(body, groundAt);
    body.still = moved < SLEEP_SPEED ? body.still + STEP : 0;
    if (body.still >= SLEEP_AFTER) {
      body.asleep = true;
      return;
    }
  }
}

/** One fixed step; answers the most any point moved. */
function once(body: Body, groundAt: (x: number, z: number) => number): number {
  const { pos, prev, radius, sticks } = body;
  const n = radius.length;
  const g = GRAVITY * STEP * STEP;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    for (let k = 0; k < 3; k++) {
      const now = pos[j + k];
      pos[j + k] += (now - prev[j + k]) * DAMPING - (k === 1 ? g : 0);
      prev[j + k] = now;
    }
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (const s of sticks) {
      const a = s.a * 3;
      const b = s.b * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      const target = Math.min(Math.max(d, s.rest * s.lo), s.rest * s.hi);
      if (target === d) continue;
      // Each end moves half the error, along the stick.
      const f = ((d - target) / d) * 0.5;
      pos[a] += dx * f;
      pos[a + 1] += dy * f;
      pos[a + 2] += dz * f;
      pos[b] -= dx * f;
      pos[b + 1] -= dy * f;
      pos[b + 2] -= dz * f;
    }
    // The ground inside the loop, so a stick cannot pull a point back under it after it was lifted.
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const floor = groundAt(pos[j], pos[j + 2]) + radius[i];
      if (pos[j + 1] < floor) {
        pos[j + 1] = floor;
        if (prev[j + 1] < floor) prev[j + 1] = floor;
        // Rubbing along the ground slows it: the step's slide is taken partly back.
        prev[j] += (pos[j] - prev[j]) * FRICTION;
        prev[j + 2] += (pos[j + 2] - prev[j + 2]) * FRICTION;
      }
    }
  }
  let most = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    most = Math.max(most, Math.abs(pos[j] - prev[j]), Math.abs(pos[j + 1] - prev[j + 1]), Math.abs(pos[j + 2] - prev[j + 2]));
  }
  return most;
}

/**
 * A rigid thing tipping over from its feet — a body with no skeleton to go limp (a still model, the
 * capsule): the angle from upright after `t` seconds of falling as a rod of `height` pivoting on its
 * base, from a nudge, landing flat at π/2 with a small bounce.
 */
export function toppleAngle(t: number, height: number): number {
  // θ'' = (3g / 2h)·sin θ for a uniform rod on its end; stepped, since it has no closed form.
  const k = (3 * GRAVITY) / (2 * Math.max(0.3, height));
  let theta = 0.05;
  let omega = 0.6;
  const h = 1 / 120;
  let landed = false;
  for (let s = 0; s * h < t; s++) {
    if (!landed) {
      omega += k * Math.sin(theta) * h;
      theta += omega * h;
      if (theta >= Math.PI / 2) {
        theta = Math.PI / 2;
        omega = -omega * 0.18;
        landed = true;
      }
    } else {
      // A little bounce, back down under gravity.
      omega += k * h;
      theta = Math.min(Math.PI / 2, theta + omega * h);
    }
  }
  return theta;
}
