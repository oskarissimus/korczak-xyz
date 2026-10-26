/*
 * The ground the hunter is led over: the dirt road from the village to each place, and the trail
 * the witcher's senses light (owner, 26 Oct 2026: "the road should not render as it does now,
 * straight to the quest, but as a path the senses light up").
 *
 * The road used to be one straight plank of dirt from the well to the place, so every place sat at
 * the end of a ruler line. Now it winds, seeded by the place's name so it is the same road every
 * time, straight at both ends (out of the square, into the place) and bending in between. The
 * trail follows that road when it leads where the marker is, and otherwise goes there across the
 * fields with a gentler wander; the senses draw it as footprints, never as a line.
 *
 * Plain numbers on the ground plane, no Three.js, so it can be tested.
 */

export interface Ground {
  x: number;
  z: number;
}

/** A footprint on the trail: where, which way it points, how far along it is, and which foot. */
export interface Footprint extends Ground {
  /** Radians about the vertical, 0 pointing along +Z. */
  angle: number;
  along: number;
  left: boolean;
}

/** Deterministic noise from a seed: the same road for the same place, every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A wandering line from `a` to `b`, a point every `step` metres: sideways by two sine waves under a
 * hump that is zero at both ends, so it leaves and arrives head on. `amp` is the widest swing.
 */
export function wander(a: Ground, b: Ground, seed: number, amp: number, step = 2): Ground[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.01) return [{ ...a }, { ...b }];
  const rand = seeded(seed);
  const k1 = 1 + rand();
  const k2 = 2.5 + rand() * 1.5;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const nx = -dz / length;
  const nz = dx / length;
  const n = Math.max(2, Math.ceil(length / step));
  const out: Ground[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const hump = Math.sin(Math.PI * t);
    const w = amp * hump * (0.7 * Math.sin(2 * Math.PI * k1 * t + p1) + 0.3 * Math.sin(2 * Math.PI * k2 * t + p2));
    out.push({ x: a.x + dx * t + nx * w, z: a.z + dz * t + nz * w });
  }
  return out;
}

/** The road leaves the square this far from its middle: the well or the landmark stands inside. */
export const ROAD_START = 6;

/**
 * The road from the village square to a place at (x, z), from the edge of the square's middle to
 * `stop` metres short of the place's (its own ground takes over there). Swings up to 8% of its
 * length, never past 7 m.
 */
export function roadPoints(x: number, z: number, seed: number, stop: number): Ground[] {
  const d = Math.hypot(x, z);
  const reach = Math.max(ROAD_START + 1, d - stop);
  const start = { x: (x / d) * ROAD_START, z: (z / d) * ROAD_START };
  const end = { x: (x / d) * reach, z: (z / d) * reach };
  return wander(start, end, seed, Math.min(7, (reach - ROAD_START) * 0.08));
}

/** How far (x, z) is from a polyline, and the index of the point that starts its nearest segment. */
export function nearestOnLine(x: number, z: number, line: Ground[]): { d: number; i: number } {
  let best = { d: Infinity, i: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best.d) best = { d, i };
  }
  if (line.length === 1) best = { d: Math.hypot(x - line[0].x, z - line[0].z), i: 0 };
  return best;
}

/** How far from a road the hunter may be for the trail to take him back to it rather than cross-country. */
export const ROAD_REACH = 30;
/** How much a metre across the fields counts against a metre of road, choosing where to join it. */
const OFF_ROAD = 2.5;
/** The trail is drawn this far and no further: past the fog nothing would show anyway. */
export const TRAIL_MAX = 160;

/**
 * The way from `from` to `to`. Along `road` when there is one, the hunter is near it and it ends
 * near `to` — onto the road at its nearest point and along it to the end; otherwise across the
 * ground with a gentle wander. Cut at `TRAIL_MAX` metres.
 */
export function trailPoints(from: Ground, to: Ground, road: Ground[] | null, seed: number): Ground[] {
  let points: Ground[] | null = null;
  if (road && road.length > 1) {
    const end = road[road.length - 1];
    const near = nearestOnLine(from.x, from.z, road);
    const fromEnd = Math.hypot(end.x - to.x, end.z - to.z);
    const direct = Math.hypot(from.x - to.x, from.z - to.z);
    // Already nearer the goal than the road's end is: no point walking back to it.
    if (near.d < ROAD_REACH && fromEnd < 40 && direct > fromEnd) {
      // Onto the road where the whole way is cheapest, not at its nearest point, which from beside
      // the road can be behind the hunter. Across the fields costs more than along the road, or
      // the cheapest way would always be straight to the road's end.
      const left = new Array<number>(road.length).fill(0);
      for (let i = road.length - 2; i >= 0; i--) left[i] = left[i + 1] + Math.hypot(road[i + 1].x - road[i].x, road[i + 1].z - road[i].z);
      let join = near.i + 1;
      let best = Infinity;
      for (let i = 0; i < road.length; i++) {
        const cost = OFF_ROAD * Math.hypot(road[i].x - from.x, road[i].z - from.z) + left[i];
        if (cost < best) {
          best = cost;
          join = i;
        }
      }
      points = [...across(from, road[join], seed), ...road.slice(join + 1), { ...to }];
    }
  }
  return cut(points ?? across(from, to, seed), TRAIL_MAX);
}

/** The well, or the landmark in its place, in the middle of the square: the trail goes round it. */
export const SQUARE_MIDDLE = 4.5;

/**
 * Across open ground from `a` to `b`, wandering a little, and round the square's middle rather
 * than through it: a way that would pass within `SQUARE_MIDDLE` of it bends out past its side.
 */
function across(a: Ground, b: Ground, seed: number): Ground[] {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const len2 = ex * ex + ez * ez;
  const t = len2 > 0 ? -(a.x * ex + a.z * ez) / len2 : 0;
  const cx = a.x + ex * t;
  const cz = a.z + ez * t;
  const miss = Math.hypot(cx, cz);
  const legs: Ground[] = [a];
  if (t > 0 && t < 1 && miss < SQUARE_MIDDLE + 1) {
    // Out past whichever side the straight way passes; dead centre, to its left.
    const len = Math.sqrt(len2);
    const [sx, sz] = miss > 0.01 ? [cx / miss, cz / miss] : [-ez / len, ex / len];
    legs.push({ x: sx * (SQUARE_MIDDLE + 2), z: sz * (SQUARE_MIDDLE + 2) });
  }
  legs.push(b);
  const out: Ground[] = [];
  for (let i = 1; i < legs.length; i++) {
    const length = Math.hypot(legs[i].x - legs[i - 1].x, legs[i].z - legs[i - 1].z);
    const leg = wander(legs[i - 1], legs[i], seed + i, Math.min(3, length * 0.06));
    out.push(...(i === 1 ? leg : leg.slice(1)));
  }
  return out;
}

function cut(points: Ground[], max: number): Ground[] {
  const out: Ground[] = [points[0]];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (walked + seg >= max) {
      const t = (max - walked) / Math.max(seg, 1e-6);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      return out;
    }
    walked += seg;
    out.push(b);
  }
  return out;
}

/**
 * Footprints along a line, one every `stride` metres, left and right of it in turn: what the
 * senses show rather than a ribbon, so it reads as somebody's track and not as a HUD.
 */
export function footprints(points: Ground[], stride = 0.9, gait = 0.14): Footprint[] {
  const out: Footprint[] = [];
  let along = 0;
  let next = stride;
  let left = true;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    const ux = (b.x - a.x) / seg;
    const uz = (b.z - a.z) / seg;
    while (next <= along + seg) {
      const t = next - along;
      const side = left ? 1 : -1;
      out.push({
        x: a.x + ux * t - uz * gait * side,
        z: a.z + uz * t + ux * gait * side,
        angle: Math.atan2(ux, uz),
        along: next,
        left,
      });
      left = !left;
      next += stride;
    }
    along += seg;
  }
  return out;
}
