/*
 * Whether a model TRELLIS made is a model at all (owner, 30 Oct 2026, a screenshot of black walls
 * standing in a forest with a tree drawn faintly on them: "these models came out weird").
 *
 * From some pictures TRELLIS builds no object but two flat sheets crossed through the middle of its
 * unit box, the picture painted on them: a card, from the front, and a black slab from anywhere
 * else. The one it was shown was a world's old oak (`tree3`), drawn so large it ran off both sides
 * of the picture. Pure, and the same in both runtimes: the browser checks what it made
 * (`landmark3d.ts`) and the server what its job made (`functions/src/rpg/jobs.ts`).
 *
 * The test is the card's own shape: a vertical, axis-aligned plane through the middle of the box
 * that is about as large as the box's whole cross-section. On that world's oak it measured 1.27 (a
 * sheet each way round), against at most 0.18 across twenty real models of two worlds — houses,
 * a stall's back wall, a gallows, crates, carts, trees, people. Horizontal planes are left out,
 * since a table top or a stack of crates is one, and so are the box's outer faces, where a
 * building's walls are.
 */

/** Above this share of its cross-section in one central sheet, a model is a card. */
export const CARD_SHARE = 0.5;

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface Gltf {
  accessors?: Accessor[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
}

/** Every triangle's corners, nine numbers each; null where the file is not a plain GLB this can read. */
export function glbTriangles(bytes: ArrayBuffer): Float32Array | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) return null;
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength))) as Gltf;
  const binStart = 20 + jsonLength + 8;
  if (binStart > bytes.byteLength) return null;
  const out: number[] = [];
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4) continue;
      const pos = json.accessors?.[prim.attributes.POSITION];
      const pv = pos?.bufferView !== undefined ? json.bufferViews?.[pos.bufferView] : undefined;
      // Plain float positions, tightly packed, as TRELLIS writes them; anything else is not read.
      if (!pos || !pv || pos.componentType !== 5126 || pos.type !== 'VEC3' || (pv.byteStride && pv.byteStride !== 12)) return null;
      const positions = new Float32Array(bytes.slice(binStart + (pv.byteOffset ?? 0) + (pos.byteOffset ?? 0), binStart + (pv.byteOffset ?? 0) + (pos.byteOffset ?? 0) + pos.count * 12));
      let index: ArrayLike<number>;
      if (prim.indices === undefined) {
        index = Array.from({ length: pos.count }, (_, i) => i);
      } else {
        const ia = json.accessors?.[prim.indices];
        const iv = ia?.bufferView !== undefined ? json.bufferViews?.[ia.bufferView] : undefined;
        if (!ia || !iv) return null;
        const start = binStart + (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
        if (ia.componentType === 5125) index = new Uint32Array(bytes.slice(start, start + ia.count * 4));
        else if (ia.componentType === 5123) index = new Uint16Array(bytes.slice(start, start + ia.count * 2));
        else if (ia.componentType === 5121) index = new Uint8Array(bytes.slice(start, start + ia.count));
        else return null;
      }
      for (let i = 0; i < index.length - (index.length % 3); i++) {
        const v = index[i];
        if (v >= pos.count) return null;
        out.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      }
    }
  }
  return out.length ? Float32Array.from(out) : null;
}

/**
 * The largest share of the box's cross-section that one vertical sheet through its middle (the
 * central 40% of its width or depth) covers. Y is up, as TRELLIS writes it.
 */
export function cardShare(tris: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const k = i % 3;
    if (tris[i] < lo[k]) lo[k] = tris[i];
    if (tris[i] > hi[k]) hi[k] = tris[i];
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  let best = 0;
  for (const k of [0, 2]) {
    const other = k === 0 ? 2 : 0;
    const cross = ext[1] * ext[other];
    if (!(ext[k] > 0) || !(cross > 0)) continue;
    const bins = new Map<number, number>();
    for (let t = 0; t + 8 < tris.length; t += 9) {
      const ax = tris[t + 3] - tris[t], ay = tris[t + 4] - tris[t + 1], az = tris[t + 5] - tris[t + 2];
      const bx = tris[t + 6] - tris[t], by = tris[t + 7] - tris[t + 1], bz = tris[t + 8] - tris[t + 2];
      const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (!(len > 0) || Math.abs(n[k]) / len < 0.99) continue;
      const at = ((tris[t + k] + tris[t + 3 + k] + tris[t + 6 + k]) / 3 - lo[k]) / ext[k];
      const bin = Math.round(at * 50);
      if (bin < 15 || bin > 35) continue;
      bins.set(bin, (bins.get(bin) ?? 0) + len / 2);
    }
    for (const area of bins.values()) best = Math.max(best, area / cross);
  }
  return best;
}

/** Whether a GLB is TRELLIS's crossed card rather than a model; false whenever it cannot tell. */
export function isCard(bytes: ArrayBuffer): boolean {
  try {
    const tris = glbTriangles(bytes);
    return tris !== null && cardShare(tris) >= CARD_SHARE;
  } catch {
    return false;
  }
}

/** The error a card is thrown as, so a try is spent on it like on any other failure (`withRetries`). */
export const CARD_ERROR = 'came back as a flat card, not a model';

/*
 * The floor TRELLIS lays under a small thing (owner, 2 Nov 2026, a screenshot of a melted seal on a
 * black square twice its size: "sometimes these items on the floor have a black square"). FLUX
 * draws "a small object lying on the ground" with a soft shadow under it however hard the prompt
 * says "no ground, no shadow", and TRELLIS makes the shadow a sheet: flat, double-sided, filling
 * the whole width and depth of its unit box, textured black. Under the seal it lay at the very
 * bottom (1.27 of the footprint, both faces, in the lowest 4% of the height); through a rusted
 * canister lying on its side it ran at a third of the height (1.39), cutting it like a waterline.
 * Since the box is what a model is sized by, the square also shrank the thing itself to half.
 *
 * The test is the floor's own shape: flat triangles in one thin layer (`FLOOR_LAYER` of the height)
 * that together cover at least `FLOOR_SHARE` of the footprint and reach across nearly all of it
 * both ways, while everything else in the model stays well inside it (`FLOOR_REST`) — the sheet is
 * larger than the thing, which is what a chest's lid or a coin's face never is. Only the small
 * things are checked (clues and things to gather).
 */

/** How thick, as a share of the height, the layer a floor sheet lies in is. */
export const FLOOR_LAYER = 0.06;
/** Above this share of the footprint covered by flat faces in one layer (a two-sided sheet counts twice), it may be a floor. */
export const FLOOR_SHARE = 0.5;
/** How far across the box, each way, the sheet has to reach. */
const FLOOR_REACH = 0.9;
/** How far across the box, along its narrower way, the rest may reach for the sheet to be a floor. */
const FLOOR_REST = 0.85;

/**
 * The triangles (by their number, nine numbers each in `tris`) of a floor sheet in the model: both
 * its faces and its rim, everything lying wholly within its layer. Empty where there is none.
 */
export function floorTriangles(tris: Float32Array): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const k = i % 3;
    if (tris[i] < lo[k]) lo[k] = tris[i];
    if (tris[i] > hi[k]) hi[k] = tris[i];
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const footprint = ext[0] * ext[2];
  if (!(footprint > 0) || !(ext[1] > 0)) return [];
  const count = Math.floor(tris.length / 9);
  const top = (t: number) => Math.max(tris[t * 9 + 1], tris[t * 9 + 4], tris[t * 9 + 7]);
  const bottom = (t: number) => Math.min(tris[t * 9 + 1], tris[t * 9 + 4], tris[t * 9 + 7]);
  // Flat triangles by the layer they lie in, with their area. Either way up: a sheet written once,
  // facing down, is still drawn on a two-sided material.
  const layers = Math.ceil(1 / FLOOR_LAYER);
  const area = new Float64Array(layers + 1);
  const flatIn: number[][] = Array.from({ length: layers + 1 }, () => []);
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const ax = tris[o + 3] - tris[o], ay = tris[o + 4] - tris[o + 1], az = tris[o + 5] - tris[o + 2];
    const bx = tris[o + 6] - tris[o], by = tris[o + 7] - tris[o + 1], bz = tris[o + 8] - tris[o + 2];
    const ny = az * bx - ax * bz;
    const len = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx);
    if (!(len > 0) || Math.abs(ny) / len < 0.99) continue;
    const layer = Math.round(((tris[o + 1] + tris[o + 4] + tris[o + 7]) / 3 - lo[1]) / ext[1] / FLOOR_LAYER);
    area[layer] += len / 2;
    flatIn[layer].push(t);
  }
  for (let layer = 0; layer <= layers; layer++) {
    // A sheet's two faces can straddle the boundary between two layers, so each is read with the next.
    const flat = [...flatIn[layer], ...(flatIn[layer + 1] ?? [])];
    if ((area[layer] + (area[layer + 1] ?? 0)) / footprint < FLOOR_SHARE) continue;
    const reach = [Infinity, -Infinity, Infinity, -Infinity];
    let from = Infinity;
    let to = -Infinity;
    for (const t of flat) {
      from = Math.min(from, bottom(t));
      to = Math.max(to, top(t));
      for (const c of [0, 3, 6]) {
        reach[0] = Math.min(reach[0], tris[t * 9 + c]);
        reach[1] = Math.max(reach[1], tris[t * 9 + c]);
        reach[2] = Math.min(reach[2], tris[t * 9 + c + 2]);
        reach[3] = Math.max(reach[3], tris[t * 9 + c + 2]);
      }
    }
    if ((reach[1] - reach[0]) / ext[0] < FLOOR_REACH || (reach[3] - reach[2]) / ext[2] < FLOOR_REACH) continue;
    // The sheet's rim is not quite flat (under the seal, 87 slivers at its edge), so with it goes
    // everything lying wholly within its layer.
    const margin = ext[1] * 0.015;
    const sheet: number[] = [];
    const rest = [Infinity, -Infinity, Infinity, -Infinity];
    for (let t = 0; t < count; t++) {
      if (bottom(t) >= from - margin && top(t) <= to + margin) {
        sheet.push(t);
        continue;
      }
      for (const c of [0, 3, 6]) {
        rest[0] = Math.min(rest[0], tris[t * 9 + c]);
        rest[1] = Math.max(rest[1], tris[t * 9 + c]);
        rest[2] = Math.min(rest[2], tris[t * 9 + c + 2]);
        rest[3] = Math.max(rest[3], tris[t * 9 + c + 2]);
      }
    }
    const narrower = Math.min((rest[1] - rest[0]) / ext[0], (rest[3] - rest[2]) / ext[2]);
    if (narrower <= FLOOR_REST) return sheet;
  }
  return [];
}
