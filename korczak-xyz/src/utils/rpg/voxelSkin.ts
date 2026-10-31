/*
 * Skin weights from the skeleton and the mesh alone, by distance measured *inside* the body
 * (owner, 31 Oct 2026: "maybe there are SOTA non-AI methods for the rig we can use? the rig seems the
 * easiest thing and costs the most"). It is geodesic voxel binding (Dionne & de Lasa, "Geodesic
 * Voxel Binding for Production Character Meshes", SCA 2013 — Maya's default bind since), cut down to
 * what a T-posed TRELLIS person needs:
 *
 *   1. The mesh is voxelised (its triangles, sampled finer than a voxel) and the inside filled: every
 *      voxel the outside cannot reach by flood is body. A mesh with holes, which TRELLIS makes, floods
 *      inside; then the shell is thickened one voxel and filled again.
 *   2. Each bone is a segment from its joint to its child's; from the voxels it passes through, a
 *      Dijkstra over the body's voxels gives every voxel its distance to that bone **without leaving
 *      the body**.
 *   3. A vertex takes the bones nearest it by that distance, falling off over a few centimetres, the
 *      best four normalised, then smoothed once over its neighbours.
 *
 * Step 2 is the point. The rig it replaces copied the weights of the nearest point of a donor body,
 * measured straight through the air, so a vertex of a sleeve near the waist could take the hip's
 * weight and a cuff the other bone's: the shards that tore off the forearms in the walk. Through the
 * body, a hand is a whole arm away from the hip, and the legs are as far apart as the crotch makes
 * them. A T-pose is what makes this easy: the arms are clear of the body all the way to the armpit.
 *
 * Pure, so it runs in the rig's worker and in the tests; ~0.3 s on a 5k-vertex person.
 */

/** A bone to weigh: a segment in the rig's space, by index into the skeleton. */
export interface SkinBone {
  bone: number;
  from: [number, number, number];
  to: [number, number, number];
}

export interface VoxelSkinOptions {
  /** Voxel edge, metres. */
  voxel?: number;
  /** How far past the nearest bone another still shares a vertex, metres. */
  falloff?: number;
}

/** Four bones a vertex and their weights, summing to 1. */
export interface Skin {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

const NEIGHBOURS: [number, number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) NEIGHBOURS.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);

/** A binary min-heap of voxel indices by a distance array. */
class Heap {
  private items: number[] = [];
  constructor(private d: Float32Array) {}
  get size() {
    return this.items.length;
  }
  push(v: number) {
    const a = this.items, d = this.d;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[a[p]] <= d[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items, d = this.d, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && d[a[l]] < d[a[m]]) m = l;
        if (r < a.length && d[a[r]] < d[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Weights for `positions` (xyz, metres) against `bones`. `index` is the triangle list, if there is
 * one; without it only the vertices are voxelised, and the shell is thickened to close the gaps.
 */
export function voxelSkin(positions: ArrayLike<number>, index: ArrayLike<number> | null, bones: SkinBone[], o: VoxelSkinOptions = {}): Skin {
  const n = positions.length / 3;
  const size = o.voxel ?? 0.018;
  const falloff = o.falloff ?? 0.05;

  // The grid: the mesh's box and a voxel of air all round, so the flood can go round everything.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i * 3 + a]);
      max[a] = Math.max(max[a], positions[i * 3 + a]);
    }
  const origin = min.map((v) => v - size * 2);
  const dim = [0, 1, 2].map((a) => Math.ceil((max[a] - min[a]) / size) + 5);
  const [nx, ny, nz] = dim;
  const total = nx * ny * nz;
  const cell = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  const at = (p: ArrayLike<number>, k = 0): [number, number, number] => [
    Math.floor((p[k] - origin[0]) / size),
    Math.floor((p[k + 1] - origin[1]) / size),
    Math.floor((p[k + 2] - origin[2]) / size),
  ];
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;

  // 1. The shell: each triangle sampled at under half a voxel.
  const shell = new Uint8Array(total);
  const mark = (x: number, y: number, z: number) => {
    const c = at([x, y, z]);
    if (inside(...c)) shell[cell(...c)] = 1;
  };
  for (let i = 0; i < n; i++) mark(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  if (index)
    for (let t = 0; t + 2 < index.length; t += 3) {
      const A = index[t] * 3, B = index[t + 1] * 3, C = index[t + 2] * 3;
      const edge = Math.max(
        Math.hypot(positions[A] - positions[B], positions[A + 1] - positions[B + 1], positions[A + 2] - positions[B + 2]),
        Math.hypot(positions[A] - positions[C], positions[A + 1] - positions[C + 1], positions[A + 2] - positions[C + 2]),
        Math.hypot(positions[B] - positions[C], positions[B + 1] - positions[C + 1], positions[B + 2] - positions[C + 2]),
      );
      const steps = Math.ceil(edge / (size * 0.45));
      if (steps <= 1) continue;
      for (let i = 0; i <= steps; i++)
        for (let j = 0; i + j <= steps; j++) {
          const u = i / steps, v = j / steps, w = 1 - u - v;
          mark(
            positions[A] * w + positions[B] * u + positions[C] * v,
            positions[A + 1] * w + positions[B + 1] * u + positions[C + 1] * v,
            positions[A + 2] * w + positions[B + 2] * u + positions[C + 2] * v,
          );
        }
    }

  const fill = (wall: Uint8Array) => {
    // Flood the outside from the grid's corner; everything it cannot reach is body.
    const out = new Uint8Array(total);
    const stack = [0];
    out[0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const z = c % nz, y = ((c - z) / nz) % ny, x = (c - z - y * nz) / (ny * nz);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (!inside(X, Y, Z)) continue;
        const k = cell(X, Y, Z);
        if (out[k] || wall[k]) continue;
        out[k] = 1;
        stack.push(k);
      }
    }
    const body = new Uint8Array(total);
    let count = 0;
    for (let k = 0; k < total; k++) if (!out[k]) (body[k] = 1), count++;
    return { body, count };
  };
  let shellCount = 0;
  for (let k = 0; k < total; k++) shellCount += shell[k];
  let { body, count } = fill(shell);
  if (!index || count < shellCount * 1.3) {
    // Leaked through a hole (or no triangles to close the gaps): thicken the shell and fill again.
    const thick = new Uint8Array(total);
    for (let x = 0; x < nx; x++)
      for (let y = 0; y < ny; y++)
        for (let z = 0; z < nz; z++) {
          if (!shell[cell(x, y, z)]) continue;
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) if (inside(x + dx, y + dy, z + dz)) thick[cell(x + dx, y + dy, z + dz)] = 1;
        }
    const again = fill(thick);
    if (again.count > count) ({ body, count } = again);
  }

  // Every vertex's voxel, and the body voxel nearest it if its own came out as air.
  const nearestBody = (p: [number, number, number], reach: number): number => {
    const [cx, cy, cz] = at(p);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= reach && best < 0; r++)
      for (let x = cx - r; x <= cx + r; x++)
        for (let y = cy - r; y <= cy + r; y++)
          for (let z = cz - r; z <= cz + r; z++) {
            if (!inside(x, y, z) || !body[cell(x, y, z)]) continue;
            const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
            if (d < bestD) (bestD = d), (best = cell(x, y, z));
          }
    return best;
  };
  const home = new Int32Array(n);
  for (let i = 0; i < n; i++) home[i] = nearestBody([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], 4);

  // 2. Each bone's distance through the body.
  const nb = bones.length;
  const dist = bones.map((b) => {
    const d = new Float32Array(total).fill(Infinity);
    const heap = new Heap(d);
    const len = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
    const steps = Math.max(1, Math.ceil(len / (size * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p: [number, number, number] = [0, 1, 2].map((a) => b.from[a] + (b.to[a] - b.from[a]) * t) as [number, number, number];
      const c = nearestBody(p, 3);
      if (c < 0 || d[c] === 0) continue;
      d[c] = 0;
      heap.push(c);
    }
    if (!heap.size) {
      // A bone wholly outside the body (a joint put in the air): seed the voxel nearest its middle.
      const c = nearestBody([0, 1, 2].map((a) => (b.from[a] + b.to[a]) / 2) as [number, number, number], Math.max(nx, ny, nz));
      if (c >= 0) (d[c] = 0), heap.push(c);
    }
    const done = new Uint8Array(total);
    while (heap.size) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      const z = c % nz, y = ((c - z) / nz) % ny, x = (c - z - y * nz) / (ny * nz);
      for (const [dx, dy, dz, step] of NEIGHBOURS) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (!inside(X, Y, Z)) continue;
        const k = cell(X, Y, Z);
        if (!body[k] || done[k]) continue;
        const nd = d[c] + step * size;
        if (nd < d[k]) {
          d[k] = nd;
          heap.push(k);
        }
      }
    }
    return d;
  });

  // 3. Weights: the nearest bone, and the others falling off past it.
  let w = new Float32Array(n * nb);
  for (let i = 0; i < n; i++) {
    const c = home[i];
    if (c < 0) continue;
    let near = Infinity;
    for (let b = 0; b < nb; b++) near = Math.min(near, dist[b][c]);
    if (!Number.isFinite(near)) continue;
    // The falloff widens with the distance to the nearest bone: on a limb's skin a joint blends over
    // a few centimetres, while cloth hanging clear of the body — an apron between the legs — blends
    // over its width, so it stretches with the stride instead of splitting down the middle.
    // (Past the first 8 cm, so a face, as far from its bone as a head is wide, still blends tight.)
    const reach = falloff + Math.max(0, near - falloff * 1.6) * 0.8;
    for (let b = 0; b < nb; b++) {
      const e = (dist[b][c] - near) / reach;
      if (e < 2.5) w[i * nb + b] = Math.exp(-e * e);
    }
  }

  // A vertex split along a texture seam is several vertices in one place: they are smoothed and
  // weighed as one, or the seam opens when their best four bones come out different.
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;
    const first = seen.get(k);
    if (first === undefined) seen.set(k, i);
    weld[i] = first ?? i;
  }

  // Smoothed twice over each vertex's neighbours by the triangles, so no edge is a step.
  for (let pass = 0; index && pass < 2; pass++) {
    const next = new Float32Array(w.length);
    const count = new Float32Array(n);
    const add = (i: number, j: number) => {
      for (let b = 0; b < nb; b++) next[i * nb + b] += w[j * nb + b];
      count[i]++;
    };
    for (let i = 0; i < n; i++) add(i, i), add(i, i);
    // Only along short edges: a long one spans more than a joint's blend, and would carry it there.
    const short = (i: number, j: number) =>
      Math.hypot(positions[i * 3] - positions[j * 3], positions[i * 3 + 1] - positions[j * 3 + 1], positions[i * 3 + 2] - positions[j * 3 + 2]) < size * 3;
    const both = (i: number, j: number) => {
      if (i !== j && short(i, j)) add(i, j), add(j, i);
    };
    for (let t = 0; t + 2 < index.length; t += 3) {
      const a = weld[index[t]], b = weld[index[t + 1]], c = weld[index[t + 2]];
      both(a, b), both(b, c), both(c, a);
    }
    for (let i = 0; i < n; i++) for (let b = 0; b < nb; b++) next[i * nb + b] /= count[i] || 1;
    w = next;
  }

  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const order = bones.map((_, b) => b);
  for (let i = 0; i < n; i++) {
    const o = weld[i] * nb;
    const top = order.slice().sort((a, b) => w[o + b] - w[o + a]).slice(0, 4);
    const sum = top.reduce((s, b) => s + w[o + b], 0);
    top.forEach((b, a) => {
      skinIndex[i * 4 + a] = bones[b].bone;
      skinWeight[i * 4 + a] = sum > 0 ? w[o + b] / sum : a === 0 ? 1 : 0;
    });
  }
  return { skinIndex, skinWeight };
}

/**
 * The segments to weigh on Meshy's 24-bone skeleton (the donors'), from the joints `selfRig` found.
 * The helper bones (`head_end`, `headfront`) take nothing; a bone with no child to point at — the
 * hands, the toes — reaches on along its parent's line, the hips span the pelvis between the thighs.
 */
export function skinBones(names: string[], parent: number[], joints: ArrayLike<number>, height: number): SkinBone[] {
  const idx = new Map(names.map((n, i) => [n, i]));
  const j = (name: string): [number, number, number] | null => {
    const i = idx.get(name);
    return i === undefined ? null : [joints[i * 3], joints[i * 3 + 1], joints[i * 3 + 2]];
  };
  const out: SkinBone[] = [];
  const add = (name: string, from: [number, number, number] | null, to: [number, number, number] | null) => {
    const i = idx.get(name);
    if (i !== undefined && from && to) out.push({ bone: i, from, to });
  };
  const on = (a: [number, number, number] | null, b: [number, number, number] | null, k: number): [number, number, number] | null =>
    a && b ? [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k, b[2] + (b[2] - a[2]) * k] : null;
  const mid = (a: [number, number, number] | null, b: [number, number, number] | null): [number, number, number] | null =>
    a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;

  add('Hips', mid(j('LeftUpLeg'), j('RightUpLeg')), j('Spine02'));
  add('Spine02', j('Spine02'), j('Spine01'));
  add('Spine01', j('Spine01'), j('Spine'));
  add('Spine', j('Spine'), j('neck'));
  add('neck', j('neck'), j('Head'));
  const head = j('Head');
  add('Head', head, head ? [head[0], head[1] + height * 0.11, head[2]] : null);
  for (const side of ['Left', 'Right']) {
    add(`${side}Shoulder`, j(`${side}Shoulder`), j(`${side}Arm`));
    add(`${side}Arm`, j(`${side}Arm`), j(`${side}ForeArm`));
    add(`${side}ForeArm`, j(`${side}ForeArm`), j(`${side}Hand`));
    // The hand: on along the forearm, about a hand's length.
    const fore = j(`${side}ForeArm`), hand = j(`${side}Hand`);
    const foreLen = fore && hand ? Math.hypot(hand[0] - fore[0], hand[1] - fore[1], hand[2] - fore[2]) : 0;
    add(`${side}Hand`, hand, on(fore, hand, foreLen ? (height * 0.09) / foreLen : 0));
    add(`${side}UpLeg`, j(`${side}UpLeg`), j(`${side}Leg`));
    add(`${side}Leg`, j(`${side}Leg`), j(`${side}Foot`));
    add(`${side}Foot`, j(`${side}Foot`), j(`${side}ToeBase`));
    add(`${side}ToeBase`, j(`${side}ToeBase`), on(j(`${side}Foot`), j(`${side}ToeBase`), 0.5));
  }
  void parent;
  return out;
}
