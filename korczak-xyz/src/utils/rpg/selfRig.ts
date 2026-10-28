/*
 * A skeleton and skin weights for a person fal.ai made, worked out in the browser for nothing
 * (owner, 28 Oct 2026: "is there a way to do the rig cheaper?" — Meshy's auto-rig on fal.ai was
 * $0.20 a character, ten times the model it rigs).
 *
 * Every person is drawn the same way (`personPrompt`: alone, front-on, in an A-pose, head to feet),
 * so every TRELLIS mesh stands in nearly the same pose and frame. That is what makes this work: a
 * **donor**, a body Meshy rigged once (`src/assets/rpg/people/`), is warped onto the new mesh, its
 * skeleton follows the donor's own vertices, and each new vertex takes the skin weights of the
 * nearest warped donor vertex. The skeleton keeps the donor's bone names and rest rotations, so one
 * clip library made on Meshy's skeleton moves every person (`components/Rpg/people.ts`).
 *
 * The warp: both bodies in one space (feet at 0, centred, the target at its height, the donor
 * stretched per axis to the target's box), then the donor's points are pulled both ways — each to
 * its nearest target point and each target point's nearest donor point towards it — through a few
 * hundred control nodes whose steps are averaged with their neighbours'. Stiff at first, so the body
 * moves as a whole, looser each round, so an arm finds the arm.
 *
 * Measured 28 Oct 2026 against Meshy's own rig of the same two meshes (a guard in trousers, a woman
 * in a long cloak), the same clips on both: the guard indistinguishable, the cloak holding to the
 * body better than Meshy's. Pure, so it runs in a worker and in the tests.
 */

/** One bone of a donor's skeleton, in metres; parents come before their children. */
export interface DonorBone {
  name: string;
  parent: number;
  /** Rest position, local to the parent. */
  position: [number, number, number];
  /** Rest rotation, local to the parent: kept on every rig, so the clips fit it. */
  quaternion: [number, number, number, number];
  /** Rest position in the body's own space (feet at 0). */
  world: [number, number, number];
}

export interface Donor {
  bones: DonorBone[];
  /** The donor's surface points in its bind pose, xyz. */
  positions: Float32Array;
  /** Four bones a point, by index into `bones`, and their weights, summing to 1. */
  skinIndex: Uint8Array | Uint16Array;
  skinWeight: Float32Array;
}

export interface SelfRig {
  /** The target's vertices moved into the rig's space: feet at 0, centred on x and z, `height` tall. */
  positions: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Each bone's rest position in that space, xyz, in the donor's order. */
  joints: Float32Array;
}

/**
 * Reads a donor as `scripts/rpg-people.mjs` writes it: a little-endian u32 header length, a JSON
 * header (`{count, bones}`), the points as float32, then four u8 bone indices and four u8 weights
 * (out of 255) a point.
 */
export function parseDonor(buf: ArrayBuffer): Donor {
  const len = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as { count: number; bones: DonorBone[] };
  const n = head.count;
  let o = 4 + len;
  const positions = new Float32Array(buf.slice(o, o + n * 12));
  o += n * 12;
  const skinIndex = new Uint8Array(buf.slice(o, o + n * 4));
  o += n * 4;
  const raw = new Uint8Array(buf, o, n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < raw.length; i++) skinWeight[i] = raw[i] / 255;
  return { bones: head.bones, positions, skinIndex, skinWeight };
}

/** Nearest-point and radius queries on a fixed set of points, through a uniform grid. */
class Grid {
  private cells = new Map<number, number[]>();
  constructor(
    private pts: ArrayLike<number>,
    private cell: number,
  ) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(this.c(pts[i * 3]), this.c(pts[i * 3 + 1]), this.c(pts[i * 3 + 2]));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    }
  }

  private c(v: number) {
    return Math.floor(v / this.cell);
  }

  private key(x: number, y: number, z: number) {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  }

  nearest(x: number, y: number, z: number): number {
    const cx = this.c(x), cy = this.c(y), cz = this.c(z), p = this.pts;
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 40; r++) {
      for (let i = cx - r; i <= cx + r; i++)
        for (let j = cy - r; j <= cy + r; j++)
          for (let k = cz - r; k <= cz + r; k++) {
            if (Math.max(Math.abs(i - cx), Math.abs(j - cy), Math.abs(k - cz)) !== r) continue;
            const list = this.cells.get(this.key(i, j, k));
            if (!list) continue;
            for (const q of list) {
              const dx = p[q * 3] - x, dy = p[q * 3 + 1] - y, dz = p[q * 3 + 2] - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestD) {
                bestD = d;
                best = q;
              }
            }
          }
      // Anything nearer would be in a shell already searched.
      if (best >= 0 && Math.sqrt(bestD) <= r * this.cell) break;
    }
    return best;
  }

  within(x: number, y: number, z: number, radius: number): number[] {
    const n = Math.ceil(radius / this.cell), cx = this.c(x), cy = this.c(y), cz = this.c(z), p = this.pts, out: number[] = [];
    for (let i = cx - n; i <= cx + n; i++)
      for (let j = cy - n; j <= cy + n; j++)
        for (let k = cz - n; k <= cz + n; k++) {
          const list = this.cells.get(this.key(i, j, k));
          if (!list) continue;
          for (const q of list) {
            const dx = p[q * 3] - x, dy = p[q * 3 + 1] - y, dz = p[q * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz < radius * radius) out.push(q);
          }
        }
    return out;
  }
}

function box(pts: ArrayLike<number>) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], pts[i + a]);
      max[a] = Math.max(max[a], pts[i + a]);
    }
  return { min, max, size: [0, 1, 2].map((a) => max[a] - min[a]), mid: [0, 1, 2].map((a) => (max[a] + min[a]) / 2) };
}

/** Control nodes every 4 cm; each one's step is averaged with those within 13 cm. */
const NODE_CELL = 0.04;
const NODE_REACH = 0.13;
const ROUNDS = 40;

/** Rigs `target` (a mesh's vertices, xyz, in any frame with +y up and the face toward +z) at `height` metres. */
export function selfRig(donor: Donor, target: ArrayLike<number>, height: number): SelfRig {
  const nT = target.length / 3, nD = donor.positions.length / 3, nB = donor.bones.length;

  // The target at its height, feet at 0, centred; the donor stretched to the same box.
  const rb = box(target);
  const s = height / (rb.size[1] || 1);
  const tPts = new Float32Array(nT * 3);
  for (let i = 0; i < nT; i++) {
    tPts[i * 3] = (target[i * 3] - rb.mid[0]) * s;
    tPts[i * 3 + 1] = (target[i * 3 + 1] - rb.min[1]) * s;
    tPts[i * 3 + 2] = (target[i * 3 + 2] - rb.mid[2]) * s;
  }
  const tb = box(tPts), db = box(donor.positions);
  const k = [0, 1, 2].map((a) => (tb.size[a] || 1) / (db.size[a] || 1));
  const pre = (x: number, y: number, z: number): [number, number, number] => [
    (x - db.mid[0]) * k[0] + tb.mid[0],
    (y - db.min[1]) * k[1] + tb.min[1],
    (z - db.mid[2]) * k[2] + tb.mid[2],
  ];
  const start = new Float32Array(nD * 3);
  for (let i = 0; i < nD; i++) start.set(pre(donor.positions[i * 3], donor.positions[i * 3 + 1], donor.positions[i * 3 + 2]), i * 3);

  // The control nodes: the first donor point in each 4 cm voxel; every point follows its nearest.
  const voxels = new Set<string>(), nodes: number[] = [];
  for (let i = 0; i < nD; i++) {
    const v = `${Math.floor(start[i * 3] / NODE_CELL)},${Math.floor(start[i * 3 + 1] / NODE_CELL)},${Math.floor(start[i * 3 + 2] / NODE_CELL)}`;
    if (voxels.has(v)) continue;
    voxels.add(v);
    nodes.push(i);
  }
  const nN = nodes.length;
  const nodePts = new Float32Array(nN * 3);
  nodes.forEach((v, j) => nodePts.set(start.subarray(v * 3, v * 3 + 3), j * 3));
  const nodeGrid = new Grid(nodePts, NODE_CELL * 2);
  const owner = new Int32Array(nD);
  for (let i = 0; i < nD; i++) owner[i] = nodeGrid.nearest(start[i * 3], start[i * 3 + 1], start[i * 3 + 2]);
  const reach = nodes.map((_, j) => nodeGrid.within(nodePts[j * 3], nodePts[j * 3 + 1], nodePts[j * 3 + 2], NODE_REACH));
  const offset = new Float32Array(nN * 3);
  const tGrid = new Grid(tPts, 0.03);

  const cur = new Float32Array(nD * 3);
  const place = () => {
    for (let i = 0; i < nD; i++) for (let a = 0; a < 3; a++) cur[i * 3 + a] = start[i * 3 + a] + offset[owner[i] * 3 + a];
  };
  for (let round = 0; round < ROUNDS; round++) {
    place();
    const force = new Float32Array(nN * 3), count = new Float32Array(nN);
    for (let i = 0; i < nD; i++) {
      const t = tGrid.nearest(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]), o = owner[i];
      for (let a = 0; a < 3; a++) force[o * 3 + a] += tPts[t * 3 + a] - cur[i * 3 + a];
      count[o]++;
    }
    const dGrid = new Grid(cur, 0.03);
    for (let t = 0; t < nT; t++) {
      const i = dGrid.nearest(tPts[t * 3], tPts[t * 3 + 1], tPts[t * 3 + 2]), o = owner[i];
      for (let a = 0; a < 3; a++) force[o * 3 + a] += tPts[t * 3 + a] - cur[i * 3 + a];
      count[o]++;
    }
    for (let j = 0; j < nN; j++) if (count[j]) for (let a = 0; a < 3; a++) force[j * 3 + a] /= count[j];
    const stiff = 1 - round / ROUNDS;
    for (let j = 0; j < nN; j++) {
      const near = reach[j], share = stiff / near.length;
      for (let a = 0; a < 3; a++) {
        let step = force[j * 3 + a] * (1 - stiff);
        for (const q of near) step += force[q * 3 + a] * share;
        offset[j * 3 + a] += 0.5 * step;
      }
    }
  }
  place();

  // Each target vertex copies the four weights of the nearest warped donor point...
  const fGrid = new Grid(cur, 0.03);
  let w = new Float32Array(nT * nB);
  for (let t = 0; t < nT; t++) {
    const i = fGrid.nearest(tPts[t * 3], tPts[t * 3 + 1], tPts[t * 3 + 2]);
    for (let a = 0; a < 4; a++) w[t * nB + donor.skinIndex[i * 4 + a]] += donor.skinWeight[i * 4 + a];
  }
  // ...smoothed twice over its own neighbours, so the seam between two copied regions blends.
  const near = new Grid(tPts, 0.02);
  const around = Array.from({ length: nT }, (_, t) => near.within(tPts[t * 3], tPts[t * 3 + 1], tPts[t * 3 + 2], 0.025));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(w.length);
    for (let t = 0; t < nT; t++) {
      const list = around[t];
      for (const q of list) for (let b = 0; b < nB; b++) next[t * nB + b] += w[q * nB + b] / list.length;
    }
    w = next;
  }
  const skinIndex = new Uint16Array(nT * 4), skinWeight = new Float32Array(nT * 4);
  const order = Array.from({ length: nB }, (_, b) => b);
  for (let t = 0; t < nT; t++) {
    const top = order.slice().sort((a, b) => w[t * nB + b] - w[t * nB + a]).slice(0, 4);
    const sum = top.reduce((acc, b) => acc + w[t * nB + b], 0) || 1;
    top.forEach((b, a) => {
      skinIndex[t * 4 + a] = b;
      skinWeight[t * 4 + a] = w[t * nB + b] / sum;
    });
  }

  // Each joint moves as the donor points bound to its bone, or to its parent, near it moved.
  const radius = 0.12 * (height / 1.7);
  const joints = new Float32Array(nB * 3);
  donor.bones.forEach((bone, b) => {
    const p = pre(...bone.world);
    const sum = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < nD; i++) {
      const dx = start[i * 3] - p[0], dy = start[i * 3 + 1] - p[1], dz = start[i * 3 + 2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > radius * radius) continue;
      let bound = 0;
      for (let a = 0; a < 4; a++) {
        const j = donor.skinIndex[i * 4 + a];
        if (j === b || j === bone.parent) bound += donor.skinWeight[i * 4 + a];
      }
      if (bound < 0.3) continue;
      const weight = bound * Math.exp(-d2 / (radius * radius * 0.25));
      for (let a = 0; a < 3; a++) sum[a] += (cur[i * 3 + a] - start[i * 3 + a]) * weight;
      total += weight;
    }
    for (let a = 0; a < 3; a++) joints[b * 3 + a] = p[a] + (total > 0 ? sum[a] / total : 0);
  });

  return { positions: tPts, skinIndex, skinWeight, joints };
}
