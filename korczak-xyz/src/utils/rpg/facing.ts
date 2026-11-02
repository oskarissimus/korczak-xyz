/*
 * Which way a person's model faces (owner, 2 Nov 2026, the second time: "a character rigs back to
 * front again — fix it").
 *
 * Every rig here assumes the face is toward +Z: `tposeJoints` puts the toes and `headfront` there,
 * the warp's donor stands that way, SkinTokens is told so, and the scene turns a person by +Z. TRELLIS
 * keeps the picture's front as +Z — nearly always. Mila (world wmvznukks1, 2 Nov 2026) came back
 * turned 180° about Y, her face toward −Z and the dragon mask still on her left, so her skeleton
 * faced her back: knees bending the wrong way, walking backwards, her back to whoever she talked to.
 * One of twelve people on the account that day; the other eleven faced +Z.
 *
 * Nothing in the mesh alone says which side is the front reliably — the toes stick out forward,
 * but a coat to the ankles hides them (the hero's and the sergeant's measured 0.92 and 0.94, front
 * over back, against Mila's 0.23). The picture the model was made from does: it is the front. So the
 * model is seen from +Z and from −Z, in its texture's own colours, on a coarse grid (`view`), and
 * each is compared with the picture cut to its figure; the nearer one is the front. On those twelve
 * people every one came out right, the closest a trench coat that looks much the same from behind
 * (33 against 38, mean colour distance out of 255), Mila 51 against 34.
 */

/** Pixels, RGBA row by row, as `getImageData` answers them. */
export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A mesh in the rig's frame (+Y up), its UVs and its triangles. */
export interface TexturedMesh {
  positions: ArrayLike<number>;
  uvs: ArrayLike<number>;
  index: ArrayLike<number> | null;
}

/** The grid a view and the picture are compared on: coarse, so a few centimetres of misfit do not count. */
export const FACING_GRID = 48;

/** Under this, a picture's pixel is the figure rather than its white background. */
const BACKGROUND = 235;

/**
 * The model seen orthographically from +Z (`side` 1) or −Z (−1), screen right to the viewer's right,
 * as RGB per cell, NaN where nothing is: each triangle facing the viewer is a point at its centre, its
 * colour the texture's there (`flipY` false, as glTF's UVs read), and the nearest one in a cell wins.
 */
export function view(mesh: TexturedMesh, texture: Pixels, side: 1 | -1, grid = FACING_GRID): Float32Array {
  const p = mesh.positions;
  const n = p.length / 3;
  const tri = mesh.index ? mesh.index.length / 3 : n / 3;
  const at = (t: number, k: number) => (mesh.index ? mesh.index[t * 3 + k] : t * 3 + k);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, p[i * 3]);
    x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]);
    y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const out = new Float32Array(grid * grid * 3).fill(NaN);
  const depth = new Float32Array(grid * grid).fill(-Infinity);
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3] - ax, by = p[b * 3 + 1] - ay;
    const cx = p[c * 3] - ax, cy = p[c * 3 + 1] - ay;
    // The normal's z, toward the viewer on this side; TRELLIS winds its triangles outward.
    if ((bx * cy - by * cx) * side <= 0) continue;
    const mx = (ax * 3 + bx + cx) / 3;
    const my = (ay * 3 + by + cy) / 3;
    const mz = ((az + p[b * 3 + 2] + p[c * 3 + 2]) / 3) * side;
    // Seen from −Z the model's +X is on the viewer's left.
    const sx = side > 0 ? (mx - x0) / w : (x1 - mx) / w;
    const gx = Math.min(grid - 1, Math.max(0, Math.floor(sx * grid)));
    const gy = Math.min(grid - 1, Math.max(0, Math.floor(((y1 - my) / h) * grid)));
    const cell = gy * grid + gx;
    if (mz <= depth[cell]) continue;
    depth[cell] = mz;
    const u = (mesh.uvs[a * 2] + mesh.uvs[b * 2] + mesh.uvs[c * 2]) / 3;
    const v = (mesh.uvs[a * 2 + 1] + mesh.uvs[b * 2 + 1] + mesh.uvs[c * 2 + 1]) / 3;
    const tx = Math.min(texture.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * texture.width)));
    const ty = Math.min(texture.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * texture.height)));
    const k = (ty * texture.width + tx) * 4;
    out[cell * 3] = texture.data[k];
    out[cell * 3 + 1] = texture.data[k + 1];
    out[cell * 3 + 2] = texture.data[k + 2];
  }
  return out;
}

/**
 * The picture cut to its figure (everything not near white) and averaged down to the grid, NaN where
 * a cell is mostly background; null when there is no figure at all.
 */
export function figure(picture: Pixels, grid = FACING_GRID): Float32Array | null {
  const { data, width, height } = picture;
  const fg = (i: number) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < BACKGROUND && data[i * 4 + 3] > 128;
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (fg(y * width + x)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < x0 || y1 < y0) return null;
  const sum = new Float64Array(grid * grid * 4);
  const count = new Float64Array(grid * grid);
  const fw = x1 - x0 + 1;
  const fh = y1 - y0 + 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const cell = Math.min(grid - 1, Math.floor(((y - y0) / fh) * grid)) * grid + Math.min(grid - 1, Math.floor(((x - x0) / fw) * grid));
      const i = y * width + x;
      count[cell]++;
      if (!fg(i)) continue;
      sum[cell * 4] += data[i * 4];
      sum[cell * 4 + 1] += data[i * 4 + 1];
      sum[cell * 4 + 2] += data[i * 4 + 2];
      sum[cell * 4 + 3]++;
    }
  const out = new Float32Array(grid * grid * 3).fill(NaN);
  for (let c = 0; c < grid * grid; c++) {
    const f = sum[c * 4 + 3];
    if (!count[c] || f / count[c] < 0.5) continue;
    out[c * 3] = sum[c * 4] / f;
    out[c * 3 + 1] = sum[c * 4 + 1] / f;
    out[c * 3 + 2] = sum[c * 4 + 2] / f;
  }
  return out;
}

/** The mean colour distance per channel over the cells both have, Infinity when they share none. */
function distance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < a.length; c += 3) {
    if (Number.isNaN(a[c]) || Number.isNaN(b[c])) continue;
    sum += Math.abs(a[c] - b[c]) + Math.abs(a[c + 1] - b[c + 1]) + Math.abs(a[c + 2] - b[c + 2]);
    n += 3;
  }
  return n ? sum / n : Infinity;
}

export interface Facing {
  /** True when the model faces −Z: the picture matches its back view better than its front. */
  turned: boolean;
  /** The two distances, out of 255, for the console. */
  front: number;
  back: number;
}

/** Which way the model faces, judged against the picture it was made from; null when the picture shows no figure. */
export function facing(mesh: TexturedMesh, texture: Pixels, picture: Pixels): Facing | null {
  const fig = figure(picture);
  if (!fig) return null;
  const front = distance(view(mesh, texture, 1), fig);
  const back = distance(view(mesh, texture, -1), fig);
  if (!Number.isFinite(front) || !Number.isFinite(back)) return null;
  return { turned: back < front, front, back };
}

/**
 * A GLB turned 180° about Y, baked into its positions and normals (x and z negated, which is that
 * turn and not a mirror), for a rigger that reads the file rather than our geometry: Meshy, which
 * rigged Mila's backward model with a skeleton facing +Z all the same (its `LeftUpLeg` on +X, her
 * right leg). Only a file whose nodes carry no transform of their own, as TRELLIS writes them — a
 * turned position under a turned node would not be a turn of the whole.
 */
export function turnGlb(bytes: ArrayBuffer): ArrayBuffer {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as {
    nodes?: { matrix?: number[]; rotation?: number[]; translation?: number[]; scale?: number[] }[];
    meshes?: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[]; sparse?: unknown }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  for (const node of json.nodes ?? []) if (node.matrix || node.rotation || node.translation || node.scale) throw new Error('a node with its own transform');
  const binStart = 20 + jsonLength + 8;
  const out = bytes.slice(0);
  const data = new DataView(out);
  const done = new Set<number>();
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives)
      for (const name of ['POSITION', 'NORMAL']) {
        const id = primitive.attributes[name];
        if (id === undefined || done.has(id)) continue;
        done.add(id);
        const a = json.accessors[id];
        if (a.type !== 'VEC3' || a.componentType !== 5126 || a.sparse || a.bufferView === undefined) throw new Error(`${name} is not plain floats`);
        const bv = json.bufferViews[a.bufferView];
        const stride = bv.byteStride ?? 12;
        const start = binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
        for (let i = 0; i < a.count; i++) {
          const o = start + i * stride;
          data.setFloat32(o, -data.getFloat32(o, true), true);
          data.setFloat32(o + 8, -data.getFloat32(o + 8, true), true);
        }
        if (a.min && a.max) {
          const [minX, , minZ] = a.min;
          const [maxX, , maxZ] = a.max;
          a.min = [-maxX, a.min[1], -maxZ];
          a.max = [-minX, a.max[1], -minZ];
        }
      }
  // A new JSON chunk with the new bounds (padded with spaces to four bytes, as GLB asks), then the binary as it is.
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = (text.length + 3) & ~3;
  const rest = new Uint8Array(out, 20 + jsonLength);
  const glb = new Uint8Array(20 + padded + rest.length);
  const head = new DataView(glb.buffer);
  head.setUint32(0, 0x46546c67, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, glb.length, true);
  head.setUint32(12, padded, true);
  head.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + padded);
  glb.set(text, 20);
  glb.set(rest, 20 + padded);
  return glb.buffer;
}
