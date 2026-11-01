/*
 * Joints found in a front view of the character, lifted into the mesh (owner, 1 Nov 2026: "ask a model
 * to mark where the big joints are, then read them back"). Measured against hand-placed joints on a
 * blacksmith and a maid in a long dress, a free pose detector (MediaPipe, `poseFromRender.ts`) put
 * them within 1.5–1.7 % of the height, under the dress too; an image model drawing dots did no better
 * at 7–13¢, and Gemini asked for coordinates put the hips at the apron's hem (up to 19 % off).
 *
 * The picture is the mesh's own front render, so its x and y are the mesh's up to a box-to-box map,
 * each axis on its own. Depth is not in the picture: it is the middle of the mesh's cross-section
 * there, from rays cast along z through the triangles — vertices alone failed on a flat apron, which
 * has few of them. Three T-pose corrections:
 *   - the head's top is the mesh's top, at the neck's depth (measured, a bun dragged it back);
 *   - every detector puts the ankle 2.5–4 % of the height too high (boots), so it is clamped to the
 *     sole plus 4.5 %;
 *   - legs are straight, so the knee's depth is between the hip's and the ankle's — under a dress the
 *     cross-section at knee height is the skirt.
 *
 * Mesh: +y up, facing +z; the character's left is +x (the picture's right). Pure, so it is tested.
 */

export type JointName =
  | 'headTop' | 'neck'
  | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'wristL' | 'wristR'
  | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR';

/** Pixel coordinates in the picture, origin top-left, y down. */
export type Joints2D = Partial<Record<JointName, [number, number]>>;

export interface PictureInfo {
  width: number;
  height: number;
  /** The figure's silhouette box in pixels (inclusive). Use `silhouetteBox` to get it from the picture. */
  silhouette: { x0: number; y0: number; x1: number; y1: number };
}

export interface LiftOptions {
  /** Column radius as a fraction of mesh height (0.02 of a 1.75 m figure = 3.5 cm). Grown x1.5 up to 4 times if empty. */
  radius?: number;
  /**
   * Keypoint detectors put the ankle 2.5-3.5 % of body height too high on these pictures (boots,
   * shoes). With this on, ankle height is the mesh's sole + `ankleHeight` x mesh height whenever the
   * detected ankle is above that. Default true.
   */
  snapAnkles?: boolean;
  /** Ankle height above the sole, fraction of figure height. Default 0.045. */
  ankleHeight?: number;
  /** Average each L/R pair's height and depth, and mirror their x about the midline. Default false. */
  symmetrize?: boolean;
  /**
   * Triangle indices (geometry.index.array). With them the depth is measured by casting rays along Z
   * through the mesh - first and last hit are the front and back surface - which is immune to a flat
   * apron having few vertices. Without them it falls back to the vertex column. Recommended.
   */
  index?: ArrayLike<number>;
  /**
   * Legs are straight in a T-pose, so the knee's depth is interpolated between hip and ankle instead
   * of being measured - under a dress the cross-section at knee height is the skirt, not the leg.
   * Default true.
   */
  straightLegs?: boolean;
}

export type Joints3D = Partial<Record<JointName, [number, number, number]>>;

export function jointsFromPicture(
  joints2d: Joints2D,
  picture: PictureInfo,
  meshPositions: ArrayLike<number>,
  opts: LiftOptions = {},
): Joints3D {
  const { radius = 0.02, snapAnkles = true, ankleHeight = 0.045, symmetrize = false, index, straightLegs = true } = opts;
  const n = Math.floor(meshPositions.length / 3);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = meshPositions[i * 3], y = meshPositions[i * 3 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const H = maxY - minY;
  const s = picture.silhouette;
  const toX = (px: number) => minX + ((px - s.x0) / (s.x1 - s.x0)) * (maxX - minX);
  const toY = (py: number) => maxY - ((py - s.y0) / (s.y1 - s.y0)) * (maxY - minY); // picture y is down

  // Ray along Z through (x, y): the middle between the first and the last surface it crosses.
  const tris = index ? index.length / 3 : n / 3;
  const vi = (t: number, k: number) => (index ? index[t * 3 + k] : t * 3 + k);
  const rayMid = (x: number, y: number): number | null => {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < tris; t++) {
      const a = vi(t, 0) * 3, b = vi(t, 1) * 3, c = vi(t, 2) * 3;
      const ax = meshPositions[a], ay = meshPositions[a + 1], bx = meshPositions[b], by = meshPositions[b + 1];
      const cx = meshPositions[c], cy = meshPositions[c + 1];
      if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx)) continue;
      if ((y < ay && y < by && y < cy) || (y > ay && y > by && y > cy)) continue;
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (d === 0) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = u * meshPositions[a + 2] + v * meshPositions[b + 2] + (1 - u - v) * meshPositions[c + 2];
      if (z < lo) lo = z; if (z > hi) hi = z;
    }
    return lo <= hi ? (lo + hi) / 2 : null;
  };
  // Fallback: the vertices inside a column parallel to Z, nearest-to-extreme after dropping the two
  // most extreme on each side (a buckle, a loose strand of hair).
  const columnMid = (x: number, y: number): number => {
    let r = radius * H;
    for (let attempt = 0; attempt < 5; attempt++, r *= 1.5) {
      const zs: number[] = [];
      const r2 = r * r;
      for (let i = 0; i < n; i++) {
        const dx = meshPositions[i * 3] - x, dy = meshPositions[i * 3 + 1] - y;
        if (dx * dx + dy * dy <= r2) zs.push(meshPositions[i * 3 + 2]);
      }
      if (zs.length >= 6) {
        zs.sort((a, b) => a - b);
        return (zs[2] + zs[zs.length - 3]) / 2;
      }
    }
    return 0;
  };
  // Five rays (centre and four at half the radius), median of their middles; column if all miss
  // (a joint that falls outside the mesh, e.g. between the legs).
  const depthAt = (x: number, y: number): number => {
    if (!index && n % 3 !== 0) return columnMid(x, y);
    const h = (radius * H) / 2;
    const mids = [[0, 0], [h, 0], [-h, 0], [0, h], [0, -h]]
      .map(([dx, dy]) => rayMid(x + dx, y + dy))
      .filter((z): z is number => z !== null)
      .sort((a, b) => a - b);
    return mids.length ? mids[Math.floor(mids.length / 2)] : columnMid(x, y);
  };

  const out: Joints3D = {};
  for (const [name, p] of Object.entries(joints2d) as [JointName, [number, number]][]) {
    if (!p) continue;
    let x = toX(p[0]);
    let y = toY(p[1]);
    if (snapAnkles && name.startsWith('ankle')) y = Math.min(y, minY + ankleHeight * H);
    if (name === 'headTop') {
      // The top of the mesh is the top of the head in a T-pose. Its depth is filled in below from
      // the neck: measured, a bun or a ponytail drags it backwards and a hat brim forwards.
      out[name] = [x, maxY, NaN];
      continue;
    }
    out[name] = [x, y, depthAt(x, y)];
  }
  if (out.headTop) out.headTop[2] = out.neck ? out.neck[2] : depthAt(out.headTop[0], maxY - 0.06 * H);
  if (straightLegs) {
    for (const side of ['L', 'R']) {
      const hip = out[('hip' + side) as JointName], knee = out[('knee' + side) as JointName], ankle = out[('ankle' + side) as JointName];
      if (!hip || !knee || !ankle) continue;
      const t = (hip[1] - knee[1]) / (hip[1] - ankle[1]);
      knee[2] = hip[2] + t * (ankle[2] - hip[2]);
    }
  }

  if (symmetrize) {
    const mid = out.neck ? out.neck[0] : (minX + maxX) / 2;
    for (const j of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
      const L = out[(j + 'L') as JointName], R = out[(j + 'R') as JointName];
      if (!L || !R) continue;
      const dx = (Math.abs(L[0] - mid) + Math.abs(R[0] - mid)) / 2;
      const y = (L[1] + R[1]) / 2, z = (L[2] + R[2]) / 2;
      out[(j + 'L') as JointName] = [mid + dx, y, z];
      out[(j + 'R') as JointName] = [mid - dx, y, z];
    }
  }
  return out;
}

/**
 * The figure's box in the picture: every pixel that differs from the top-left corner's colour by
 * more than `threshold` (sum of |dR|+|dG|+|dB|). Works on the pipeline's plain grey background.
 * `rgba` is ImageData.data.
 */
export function silhouetteBox(rgba: ArrayLike<number>, width: number, height: number, threshold = 40) {
  const br = rgba[0], bg = rgba[1], bb = rgba[2];
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(rgba[i] - br) + Math.abs(rgba[i + 1] - bg) + Math.abs(rgba[i + 2] - bb) > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}
