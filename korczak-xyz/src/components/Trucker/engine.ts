/*
 * The game state and the rules, with no DOM in them: the component owns the loop and the canvas,
 * this file owns what a second of driving does. The state is mutated in place, once per frame.
 */

import { EVENTS, type Effect, type RoadEvent, type Text } from './events';

export type Rng = () => number;

/** Displayed cruising speed; the truck never goes faster, only slower. */
export const CRUISE_KMH = 90;
/** Distance the progress bar counts per second at cruising speed. */
const KM_PER_SEC = 0.5;
/** World units the road scrolls per second at cruising speed. */
const UNITS_PER_SEC = 10;
/** Depth a bug appears at; the camera sits at 1. */
export const BUG_SPAWN_Z = 60;
/** Depth at which an unfixed bug goes under the dashboard, and so under the wheels. */
const BUG_HIT_Z = 1.7;
/** Seconds to answer the radio before the autopilot answers for you. */
export const ANSWER_SECONDS = 9;
const SECONDS_TO_FALL_ASLEEP = 30;
const COFFEE_COOLDOWN = 12;

export interface Bug {
  id: number;
  z: number;
  /** Lateral position in road half-widths, -1 is the left edge. */
  x: number;
  fixedAt: number | null;
}

export interface Toast {
  id: number;
  text: Text;
  at: number;
  tone: 'good' | 'bad' | 'neutral' | 'auto';
}

export interface Active {
  event: RoadEvent;
  timeLeft: number;
}

export type Ending = 'win' | 'prod' | 'burnout';

export interface Stats {
  bugsFixed: number;
  bugsHit: number;
  answered: number;
  autopiloted: number;
  naps: number;
  meetingSeconds: number;
}

export interface GameState {
  time: number;
  km: number;
  totalKm: number;
  speed: number;
  travel: number;
  prod: number;
  sanity: number;
  debt: number;
  drowsy: number;
  stopLeft: number;
  coffees: number;
  coffeeCooldown: number;
  shake: number;
  bugs: Bug[];
  active: Active | null;
  nextEventIn: number;
  nextBugIn: number;
  deck: number[];
  toasts: Toast[];
  stats: Stats;
  over: Ending | null;
  nextId: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function shuffled(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(rng: Rng = Math.random): GameState {
  return {
    time: 0,
    km: 0,
    totalKm: 100,
    speed: 0,
    travel: 0,
    prod: 100,
    sanity: 100,
    debt: 10,
    drowsy: 0,
    stopLeft: 0,
    coffees: 3,
    coffeeCooldown: 0,
    shake: 0,
    bugs: [],
    active: null,
    nextEventIn: 5,
    nextBugIn: 3,
    deck: shuffled(EVENTS.length, rng),
    toasts: [],
    stats: { bugsFixed: 0, bugsHit: 0, answered: 0, autopiloted: 0, naps: 0, meetingSeconds: 0 },
    over: null,
    nextId: 1,
  };
}

function toast(s: GameState, text: Text, tone: Toast['tone']) {
  s.toasts.push({ id: s.nextId++, text, at: s.time, tone });
  if (s.toasts.length > 4) s.toasts.shift();
}

export function applyEffect(s: GameState, e: Effect) {
  if (e.prod) s.prod = clamp(s.prod + e.prod);
  if (e.sanity) s.sanity = clamp(s.sanity + e.sanity);
  if (e.debt) s.debt = clamp(s.debt + e.debt);
  // Scope changes are written in round numbers and land at a bit over half of them.
  if (e.km) s.totalKm = Math.max(s.km + 5, s.totalKm + e.km * 0.6);
  if (e.stop) s.stopLeft += e.stop;
}

function isBad(e: Effect) {
  return (e.prod ?? 0) < 0 || (e.sanity ?? 0) < -10 || (e.debt ?? 0) >= 15 || (e.km ?? 0) >= 15;
}

function drawEvent(s: GameState, rng: Rng): RoadEvent {
  if (s.deck.length === 0) s.deck = shuffled(EVENTS.length, rng);
  return EVENTS[s.deck.pop()!];
}

/** Answer the active event. `auto` is the autopilot answering because the timer ran out. */
export function choose(s: GameState, index: number, rng: Rng = Math.random, auto = false) {
  const active = s.active;
  if (!active || s.over) return;
  const option = active.event.options[index];
  if (!option) return;
  const risky = option.risk && rng() < option.risk.p;
  const effect = risky ? option.risk!.effect : option.effect;
  const result = risky ? option.risk!.result : option.result;
  applyEffect(s, effect);
  if (auto) {
    s.stats.autopiloted++;
    toast(s, active.event.timeoutNote, 'auto');
  } else {
    s.stats.answered++;
    s.drowsy = Math.max(0, s.drowsy - 40);
  }
  toast(s, result, isBad(effect) ? 'bad' : risky ? 'bad' : 'good');
  s.active = null;
  s.nextEventIn = 5 + rng() * 6;
  checkOver(s);
}

export function fixBug(s: GameState, id: number) {
  const bug = s.bugs.find((b) => b.id === id);
  if (!bug || bug.fixedAt !== null || s.over) return;
  bug.fixedAt = s.time;
  s.stats.bugsFixed++;
  s.debt = clamp(s.debt - 1);
  s.drowsy = Math.max(0, s.drowsy - 15);
}

export function drinkCoffee(s: GameState): boolean {
  if (s.coffees <= 0 || s.coffeeCooldown > 0 || s.over) return false;
  s.coffees--;
  s.coffeeCooldown = COFFEE_COOLDOWN;
  s.sanity = clamp(s.sanity + 15);
  s.drowsy = 0;
  return true;
}

function checkOver(s: GameState) {
  if (s.over) return;
  if (s.prod <= 0) s.over = 'prod';
  else if (s.sanity <= 0) s.over = 'burnout';
  else if (s.km >= s.totalKm) s.over = 'win';
}

/** Lane curvature at a point on the road, roughly -1.4..1.4. Shared by the renderer. */
export function curveAt(travel: number) {
  return Math.sin(travel * 0.004) * 0.8 + Math.sin(travel * 0.0013 + 1) * 0.6;
}

export function tick(s: GameState, dt: number, rng: Rng = Math.random) {
  if (s.over) return;
  s.time += dt;

  const stopped = s.stopLeft > 0;
  if (stopped) {
    s.stopLeft = Math.max(0, s.stopLeft - dt);
    s.stats.meetingSeconds += dt;
  }
  // Technical debt is a speed limit: at 100 the truck crawls at half pace.
  const target = stopped ? 0 : CRUISE_KMH * (1 - s.debt / 200);
  s.speed += (target - s.speed) * Math.min(1, dt * (stopped ? 2.5 : 0.8));
  const pace = s.speed / CRUISE_KMH;
  s.km += pace * KM_PER_SEC * dt;
  const du = pace * UNITS_PER_SEC * dt;
  s.travel += du;

  s.sanity = clamp(s.sanity - dt * (stopped ? 0.5 : 0.08));
  s.coffeeCooldown = Math.max(0, s.coffeeCooldown - dt);
  s.shake = Math.max(0, s.shake - dt);

  s.drowsy += (dt * 100) / SECONDS_TO_FALL_ASLEEP;
  if (s.drowsy >= 100) {
    s.drowsy = 25;
    s.stats.naps++;
    applyEffect(s, { prod: -15, debt: 15 });
    toast(
      s,
      {
        en: 'You dozed off. Meanwhile Claude rewrote the backend in Haskell.',
        pl: 'Przysnąłeś. W tym czasie Claude przepisał backend na Haskella.',
      },
      'bad',
    );
  }

  for (const bug of s.bugs) bug.z -= du;
  s.bugs = s.bugs.filter((bug) => {
    if (bug.fixedAt !== null) return s.time - bug.fixedAt < 0.8 && bug.z > 0.5;
    if (bug.z > BUG_HIT_Z) return true;
    s.stats.bugsHit++;
    s.shake = 0.5;
    applyEffect(s, { prod: -10, debt: 3 });
    toast(s, { en: 'Bug hit production!', pl: 'Bug trafił na produkcję!' }, 'bad');
    return false;
  });

  if (!stopped) {
    s.nextBugIn -= dt;
    if (s.nextBugIn <= 0) {
      s.bugs.push({ id: s.nextId++, z: BUG_SPAWN_Z, x: rng() * 1.3 - 0.65, fixedAt: null });
      // More debt, more bugs: from one every ~5s down to one every ~1.5s.
      s.nextBugIn = Math.max(1.5, 5.5 - s.debt * 0.04) * (0.6 + rng() * 0.8);
    }
  }

  if (s.active) {
    s.active.timeLeft -= dt;
    if (s.active.timeLeft <= 0) choose(s, s.active.event.timeout, rng, true);
  } else if (!stopped) {
    s.nextEventIn -= dt;
    if (s.nextEventIn <= 0) s.active = { event: drawEvent(s, rng), timeLeft: ANSWER_SECONDS };
  }

  s.toasts = s.toasts.filter((t) => s.time - t.at < 6);
  checkOver(s);
}

export function score(s: GameState) {
  return Math.max(
    0,
    Math.round(
      s.prod * 3 +
        s.sanity * 2 -
        s.debt * 2 +
        s.stats.bugsFixed * 5 -
        s.stats.autopiloted * 10 +
        (s.over === 'win' ? 300 : (200 * s.km) / s.totalKm),
    ),
  );
}

/** The annual review grade, from the score. */
export function grade(points: number): 0 | 1 | 2 | 3 | 4 {
  if (points >= 900) return 4;
  if (points >= 700) return 3;
  if (points >= 500) return 2;
  if (points >= 250) return 1;
  return 0;
}
