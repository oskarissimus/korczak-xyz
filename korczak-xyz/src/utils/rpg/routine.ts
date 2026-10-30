/*
 * What the quest's people do while nobody talks to them (owner, 30 Oct 2026: "NPCs should walk
 * around the place and do something, not just stand still and look around").
 *
 * Each character gets a trade read off how the beat described them (`appearance`, then `voice`, both
 * English): a blacksmith swings at a house or the goods, a woodcutter at a tree, a herbalist picks at
 * the trees and the cart, a guard walks a round, a trader calls out by the stall, a priest stands
 * before the landmark, anyone else strolls about the square. Work is the clips every person already
 * has (`Clip`): the sword swing without a sword is a hammer's or an axe's stroke, the jab a hand
 * reaching to pick, the talking loop a trader's patter. Nobody holds a tool.
 *
 * The engine only decides: where they stand, which way they face, what they play. The scene moves
 * the body and asks it nothing else, so this is plain numbers on the ground plane and can be tested.
 * Nobody wanders further than `REACH` from where the quest put them, so the one they are sent to meet
 * is still where the marker says.
 */

import type { Clip } from '../../components/Rpg/characters';

export interface Ground {
  x: number;
  z: number;
}

/** Something to work at, in world coordinates; `r` is how far out it blocks walking. */
export interface Spot extends Ground {
  r: number;
  kind: SpotKind;
}
export type SpotKind = 'house' | 'hall' | 'goods' | 'stall' | 'cart' | 'lamp' | 'tree' | 'landmark' | 'thing';

export type Trade = 'smith' | 'woodcutter' | 'gatherer' | 'guard' | 'trader' | 'holy' | 'idler';

/** What the scene sees of the world when a character decides: the spots near home, and whether a way is open. */
export interface Surroundings {
  spots: (home: Ground, reach: number) => Spot[];
  clear: (from: Ground, to: Ground) => boolean;
}

/** What the body does this frame: the loop it plays, and a stroke to play once over it. */
export interface Act {
  clip: Clip;
  speed?: number;
  strike?: { clip: Clip; seconds: number };
}

/** How far from home anyone wanders, metres. */
export const REACH = 9;
/** How close the hero must be for a walker to stop and face them. */
export const HALT = 4.2;

/** Words for each trade, the first match winning, so a "guard captain" is a guard and not a cook. */
const TRADES: [Trade, RegExp][] = [
  ['guard', /\b(guards?|guardsman|soldier|knight|watch(man|men)?|sentry|sentinel|captain|warrior|mercenary|sergeant|militia|patrol|warden|squire|constable)\b/i],
  ['smith', /\b(black|white|gold|silver|lock|weapon|armou?r)?smith\b|\b(forge|anvil|carpenter|mason|cooper|wheelwright|builder|craftsman|craftswoman|tanner|cobbler|shoemaker|potter|joiner|artisan|stonecutter|miner)\b/i],
  ['woodcutter', /\b(wood ?cutter|lumberjack|forester|woodsman|woodswoman|logger|axe)\b/i],
  ['holy', /\b(priest(ess)?|monk|nun|abbot|abbess|friar|cleric|witch|warlock|sage|mage|wizard|sorcer(er|ess)|druid|shaman|hermit|scholar|seer|oracle|prophet|mystic|elder|acolyte|pilgrim|alchemist|necromancer)\b/i],
  ['trader', /\b(merchant|trader|peddler|pedlar|innkeeper|tavern|barkeep|bartender|barmaid|cook|baker|butcher|shopkeeper|vendor|fishmonger|brewer|grocer|stallholder|moneylender|jeweller|jeweler)\b/i],
  ['gatherer', /\b(farmer|farmhand|peasant|herbalist|healer|gardener|shepherd(ess)?|miller|fisher(man|woman)?|trapper|gatherer|forager|milkmaid|beekeeper|vintner|plowman|ploughman|apothecary|midwife)\b/i],
];

/**
 * The trade in `about`, line by line: the appearance comes first and wins over the voice. No
 * "hunter" among the words: that is what everyone calls the hero, and a voice may mention them.
 */
export function tradeOf(about: string): Trade {
  for (const line of about.split('\n')) for (const [trade, words] of TRADES) if (words.test(line)) return trade;
  return 'idler';
}

interface Habit {
  /** The spots they work at, by kind, the first kinds preferred. */
  at: SpotKind[];
  /** The loop while working, and the stroke over it with the seconds between strokes. */
  work: Act;
  every?: [number, number];
  /** The chance that a free moment goes to work rather than a stroll. */
  busy: number;
  pace: number;
  /** The loop while standing about. */
  rest: Clip;
}

const HABITS: Record<Trade, Habit> = {
  smith: { at: ['house', 'hall', 'goods', 'cart', 'thing'], work: { clip: 'Idle_Loop', strike: { clip: 'Sword_Attack', seconds: 1.1 } }, every: [1.5, 2.3], busy: 0.75, pace: 1.2, rest: 'Idle_Loop' },
  woodcutter: { at: ['tree', 'goods', 'cart'], work: { clip: 'Idle_Loop', strike: { clip: 'Sword_Attack', seconds: 1.2 } }, every: [1.7, 2.6], busy: 0.75, pace: 1.2, rest: 'Idle_Loop' },
  gatherer: { at: ['tree', 'cart', 'goods', 'thing', 'landmark'], work: { clip: 'Idle_Loop', strike: { clip: 'Punch_Jab', seconds: 1.3 } }, every: [2, 3.4], busy: 0.65, pace: 1.1, rest: 'Idle_Loop' },
  guard: { at: [], work: { clip: 'Sword_Idle', strike: { clip: 'Sword_Attack', seconds: 1.2 } }, every: [5, 9], busy: 0, pace: 1.3, rest: 'Sword_Idle' },
  trader: { at: ['stall', 'goods', 'cart', 'house', 'hall', 'landmark'], work: { clip: 'Idle_Talking_Loop' }, busy: 0.7, pace: 1.1, rest: 'Idle_Loop' },
  holy: { at: ['landmark', 'lamp', 'thing', 'tree'], work: { clip: 'Idle_Loop' }, busy: 0.6, pace: 0.85, rest: 'Idle_Loop' },
  idler: { at: ['landmark', 'goods', 'stall', 'house', 'lamp'], work: { clip: 'Idle_Talking_Loop' }, busy: 0.3, pace: 1.05, rest: 'Idle_Loop' },
};

/** Walk_Loop's stride, metres a second at speed 1: what keeps the feet from sliding. */
const STRIDE = 1.25;

type Step =
  | { kind: 'rest'; left: number; face: number | null }
  | { kind: 'walk'; to: Ground; after: Step }
  | { kind: 'work'; left: number; face: number; next: number };

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const angleTo = (from: Ground, to: Ground) => Math.atan2(to.x - from.x, to.z - from.z);

export class Routine {
  readonly trade: Trade;
  x: number;
  z: number;
  /** Radians about the vertical, 0 facing +Z, as `Object3D.rotation.y`. */
  facing = 0;
  private home: Ground;
  private habit: Habit;
  private rand: () => number;
  private step: Step;
  /** The guard's round: the next of four corners. */
  private corner = 0;

  constructor(name: string, about: string, home: Ground) {
    this.trade = tradeOf(about);
    this.habit = HABITS[this.trade];
    this.rand = seeded(name);
    this.home = { ...home };
    this.x = home.x;
    this.z = home.z;
    this.step = this.rest();
  }

  /** Put somewhere new by the quest: they stand there, and that is home now. */
  setHome(home: Ground) {
    this.home = { ...home };
    this.x = home.x;
    this.z = home.z;
    this.step = this.rest();
  }

  /** Stand a while before going back to it: after a talk, nobody walks off mid-farewell. */
  linger(seconds: number) {
    this.step = { kind: 'rest', left: seconds, face: null };
  }

  /** Walking, or about to: the scene stops a walker the hero comes up to. */
  get walking(): boolean {
    return this.step.kind === 'walk';
  }

  /** Working, which happens on the spot: the hero standing by does not stop it. */
  get working(): boolean {
    return this.step.kind === 'work';
  }

  tick(dt: number, around: Surroundings): Act {
    const step = this.step;
    if (step.kind === 'walk') {
      const dx = step.to.x - this.x;
      const dz = step.to.z - this.z;
      const d = Math.hypot(dx, dz);
      const move = this.habit.pace * dt;
      if (d <= move) {
        this.x = step.to.x;
        this.z = step.to.z;
        this.step = step.after;
        return this.tick(0, around);
      }
      this.x += (dx / d) * move;
      this.z += (dz / d) * move;
      this.facing = Math.atan2(dx, dz);
      return { clip: 'Walk_Loop', speed: this.habit.pace / STRIDE };
    }
    if (step.kind === 'rest') {
      if (step.face !== null) this.facing = step.face;
      step.left -= dt;
      if (step.left <= 0) this.step = this.decide(around);
      return { clip: this.habit.rest };
    }
    this.facing = step.face;
    step.left -= dt;
    if (step.left <= 0) {
      this.step = this.rest();
      return { clip: this.habit.rest };
    }
    const work = this.habit.work;
    if (!work.strike || !this.habit.every) return { clip: work.clip };
    step.next -= dt;
    if (step.next > 0) return { clip: work.clip };
    step.next = this.between(this.habit.every);
    return work;
  }

  private between([lo, hi]: [number, number]) {
    return lo + this.rand() * (hi - lo);
  }

  private rest(face: number | null = null): Step {
    return { kind: 'rest', left: this.between(this.trade === 'guard' ? [2, 4] : [2, 5]), face };
  }

  /** What a free moment goes to: work at a spot that suits them if there is one in reach, or a stroll. */
  private decide(around: Surroundings): Step {
    const here = { x: this.x, z: this.z };
    if (this.trade === 'guard') return this.round(around, here);
    if (this.rand() < this.habit.busy) {
      const job = this.job(around, here);
      if (job) return job;
    }
    return this.stroll(around, here);
  }

  private job(around: Surroundings, here: Ground): Step | null {
    const spots = around.spots(this.home, REACH);
    for (const kind of this.habit.at) {
      const ofKind = spots.filter((s) => s.kind === kind);
      // A few tries at the nearer ones, so they work at what is by them rather than across the square.
      ofKind.sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z));
      for (const spot of ofKind.slice(0, 3).sort(() => this.rand() - 0.5)) {
        // Beside it on the side they come from, a little round, at arm's length.
        const side = angleTo(spot, here) + (this.rand() - 0.5) * 1.2;
        const stand = { x: spot.x + Math.sin(side) * (spot.r + 0.7), z: spot.z + Math.cos(side) * (spot.r + 0.7) };
        if (Math.hypot(stand.x - this.home.x, stand.z - this.home.z) > REACH + 2) continue;
        if (!around.clear(here, stand)) continue;
        const work: Step = { kind: 'work', left: this.between([8, 16]), face: angleTo(stand, spot), next: this.between([0.4, 1.2]) };
        return { kind: 'walk', to: stand, after: work };
      }
    }
    return null;
  }

  private stroll(around: Surroundings, here: Ground): Step {
    for (let i = 0; i < 6; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 2 + this.rand() * (REACH - 2);
      const to = { x: this.home.x + Math.sin(a) * r, z: this.home.z + Math.cos(a) * r };
      if (Math.hypot(to.x - here.x, to.z - here.z) < 1.5) continue;
      if (around.clear(here, to)) return { kind: 'walk', to, after: this.rest() };
    }
    // Hemmed in: home is where they were put, and the way there was open then.
    if (Math.hypot(this.home.x - here.x, this.home.z - here.z) > 0.5 && around.clear(here, this.home)) {
      return { kind: 'walk', to: { ...this.home }, after: this.rest() };
    }
    return this.rest();
  }

  /** Four corners round home, walked in turn; at each a look outward, and now and then a drill. */
  private round(around: Surroundings, here: Ground): Step {
    for (let tries = 0; tries < 4; tries++) {
      const k = this.corner++ % 4;
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const r = REACH * 0.7;
      const to = { x: this.home.x + Math.sin(a) * r, z: this.home.z + Math.cos(a) * r };
      if (!around.clear(here, to)) continue;
      const watch: Step =
        this.rand() < 0.35
          ? { kind: 'work', left: this.between([4, 7]), face: a, next: this.between([0.5, 1.5]) }
          : this.rest(a);
      return { kind: 'walk', to, after: watch };
    }
    return this.rest();
  }
}
