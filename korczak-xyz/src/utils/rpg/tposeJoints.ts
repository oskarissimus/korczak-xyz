/*
 * The joints of a person standing in a T-pose, read off the mesh itself (owner, 1 Nov 2026: "assume
 * TRELLIS always gives a T-pose exactly as we want: start from a standard human and fit it as well
 * as possible, scaling the head, limbs and torso in three dimensions; only the big joints — hips,
 * knees, ankles, shoulders, elbows, wrists and the head — need to be in the right places").
 *
 * A standard body's proportions (the male donor's, which match the usual anthropometric tables:
 * hip joint at ~52 % of the height, knee ~30 %, ankle ~8 %) are the template; each part of it is then
 * stretched onto what the mesh shows where it shows it clearly:
 *
 *   - **Arms**, being horizontal, are measured along x: the hand's tip is the mesh's x extreme; the
 *     shoulder is where the vertical thickness, walking inwards, jumps from an arm's to a torso's
 *     (the armpit); elbow and wrist sit at the template's shares of shoulder-to-fingertip. Each joint is the centre of the arm's cross-section.
 *   - **Legs** are measured along y where they are apart: the two lumps of each horizontal slice,
 *     from the ankles up to where they merge (the crotch, or a skirt's hem). Hidden under a skirt,
 *     the template's heights and a hip width from the stance stand in.
 *   - **Torso and head** follow the template's heights between the hips and the shoulder line, at the
 *     centre of each slice, a little behind it where a spine is; the head's top is the mesh's top.
 *
 * The result is the donor's 24 joints in its own order, so the donor's bone names, rest rotations and
 * clips apply unchanged. Pure, so it runs in the rig's worker and in the tests.
 */

/** A joint position in the rig's space: feet at y 0, centred on x and z, +z the front. */
export type Vec3 = [number, number, number];

/** The template: where each of the donor's joints is, as shares of the height (x and z too). */
const TEMPLATE: Record<string, Vec3> = {
  Hips: [0, 0.562, -0.027],
  Spine02: [0, 0.627, -0.028],
  Spine01: [0, 0.692, -0.03],
  Spine: [0, 0.76, -0.032],
  neck: [0, 0.797, -0.033],
  Head: [0, 0.844, -0.034],
  head_end: [0, 0.99, -0.017],
  headfront: [0, 0.844, 0.08],
  LeftShoulder: [0.018, 0.774, -0.032],
  LeftArm: [0.09, 0.774, -0.04],
  LeftForeArm: [0.122, 0.652, -0.06],
  LeftHand: [0.147, 0.55, -0.006],
  LeftUpLeg: [0.071, 0.51, -0.027],
  LeftLeg: [0.107, 0.3, 0.016],
  LeftFoot: [0.151, 0.084, -0.04],
  LeftToeBase: [0.177, 0.021, 0.026],
};

/** Shoulder to fingertip, the shares where the elbow and the wrist fall (upper arm, forearm, hand ≈ 40 : 35 : 25). */
const ELBOW_AT = 0.4;
const WRIST_AT = 0.75;

export interface TPoseJoints {
  /** By the donor's bone names. */
  joints: Record<string, Vec3>;
  /** What was measured and what the template stood in for, for the console. */
  notes: string[];
}

/**
 * The joints of `positions` (xyz in the rig's space, `height` tall, arms out along x). Throws if the
 * mesh is not in a T-pose — no arms reaching well past the torso — since nothing here then holds.
 */
export function tPoseJoints(positions: ArrayLike<number>, height: number): TPoseJoints {
  const n = positions.length / 3;
  const H = height;
  const notes: string[] = [];
  const X = (i: number) => positions[i * 3], Y = (i: number) => positions[i * 3 + 1], Z = (i: number) => positions[i * 3 + 2];
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, X(i));
    maxX = Math.max(maxX, X(i));
  }
  if (maxX - minX < H * 0.7) throw new Error('not a T-pose: the arms do not reach out');

  /** The vertices inside a box. */
  const inBox = (x0: number, x1: number, y0: number, y1: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = X(i), y = Y(i);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push(i);
    }
    return out;
  };
  /** The middle of a set of vertices: the centre of their box, which a dense patch cannot drag. */
  const middle = (list: number[]): Vec3 | null => {
    if (!list.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of list)
      for (let a = 0; a < 3; a++) {
        const v = positions[i * 3 + a];
        lo[a] = Math.min(lo[a], v);
        hi[a] = Math.max(hi[a], v);
      }
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  };
  const T = (name: string): Vec3 => TEMPLATE[name].map((v) => v * H) as Vec3;

  // ARMS. The shoulder line is the arms' height, measured out past the torso on both sides.
  const outer = inBox(-Infinity, minX + (maxX - minX) * 0.15, -Infinity, Infinity).concat(inBox(maxX - (maxX - minX) * 0.15, Infinity, -Infinity, Infinity));
  const armY = middle(outer)?.[1] ?? T('LeftArm')[1];
  const step = H * 0.01;
  const arm = (side: 1 | -1) => {
    const tip = side > 0 ? maxX : minX;
    // Vertical thickness of each 1 cm column of the arm band, from the tip inwards.
    const band = (x: number) => inBox(Math.min(x, x + side * step), Math.max(x, x + side * step), armY - H * 0.2, armY + H * 0.2);
    const thick = (x: number) => {
      const list = band(x);
      if (!list.length) return 0;
      let lo = Infinity, hi = -Infinity;
      for (const i of list) {
        lo = Math.min(lo, Y(i));
        hi = Math.max(hi, Y(i));
      }
      return hi - lo;
    };
    const columns: { x: number; t: number }[] = [];
    for (let x = tip - side * step; side * x > H * 0.04; x -= side * step) columns.push({ x, t: thick(x) });
    // The arm's own thickness: the median over its outer half, past the hand.
    const forearm = columns.slice(Math.floor(columns.length * 0.15), Math.floor(columns.length * 0.5)).map((c) => c.t).sort((a, b) => a - b);
    const armThick = forearm[Math.floor(forearm.length / 2)] || H * 0.06;
    // The armpit: the first column inwards past the elbow that is well over twice the arm's thickness.
    let shoulderX = T('LeftArm')[0] * side;
    let found = false;
    for (const c of columns.slice(Math.floor(columns.length * 0.35))) {
      if (c.t > armThick * 2.4) {
        shoulderX = c.x - side * armThick * 0.35;
        found = true;
        break;
      }
    }
    notes.push(`${side > 0 ? 'left' : 'right'} shoulder ${found ? 'at the armpit' : 'from the template'}, arm ${(armThick * 100).toFixed(0)} cm thick`);
    const along = (share: number) => shoulderX + (tip - shoulderX) * share;
    // The wrist at its share. Not the thinnest column near it: a palm held flat is thinner than a
    // wrist, so that search walked out into the hand.
    const wristX = along(WRIST_AT);
    const at = (x: number): Vec3 => {
      const m = middle(band(x - side * step * 0.5));
      return m ? [x, m[1], m[2]] : [x, armY, 0];
    };
    const elbow = at(along(ELBOW_AT));
    // At the armpit a column takes in the chest below the arm, so the shoulder is on the arm's own
    // line instead: the slice of that column within one arm's thickness of the elbow's height.
    const near = band(shoulderX - side * step * 0.5).filter((i) => Math.abs(Y(i) - elbow[1]) < armThick);
    const m = middle(near);
    const shoulder: Vec3 = m ? [shoulderX, m[1], m[2]] : [shoulderX, elbow[1], elbow[2]];
    return { Arm: shoulder, ForeArm: elbow, Hand: at(wristX) };
  };
  const left = arm(1), right = arm(-1);

  // LEGS. Each slice below the arms split into lumps along x; two lumps are the two legs.
  const lumps = (y: number): { x0: number; x1: number; ids: number[] }[] => {
    const list = inBox(-H * 0.3, H * 0.3, y - step, y + step).sort((a, b) => X(a) - X(b));
    const out: { x0: number; x1: number; ids: number[] }[] = [];
    for (const i of list) {
      const last = out[out.length - 1];
      if (last && X(i) - last.x1 < H * 0.012) {
        last.x1 = X(i);
        last.ids.push(i);
      } else out.push({ x0: X(i), x1: X(i), ids: [i] });
    }
    return out.filter((l) => l.ids.length > 2);
  };
  const legsAt = (y: number) => {
    const l = lumps(y);
    if (l.length < 2) return null;
    const lft = l.filter((k) => (k.x0 + k.x1) / 2 > 0), rgt = l.filter((k) => (k.x0 + k.x1) / 2 < 0);
    if (!lft.length || !rgt.length) return null;
    return { left: middle(lft.flatMap((k) => k.ids))!, right: middle(rgt.flatMap((k) => k.ids))! };
  };
  // How high the legs stay apart: the crotch, or the hem of whatever hides them.
  let apartTo = 0;
  for (let y = H * 0.06; y < H * 0.56; y += step) {
    if (legsAt(y)) apartTo = y;
    else if (y > H * 0.12) break;
  }
  const crotchSeen = apartTo > H * 0.4;
  notes.push(crotchSeen ? `legs apart up to ${(apartTo / H * 100).toFixed(0)} % of the height` : `legs hidden above ${(apartTo / H * 100).toFixed(0)} % (a skirt): hips and knees from the template`);
  // The hip joint sits a little below the crotch; under a skirt, at the template's height.
  const hipY = crotchSeen ? Math.min(apartTo + H * 0.035, T('LeftUpLeg')[1] + H * 0.03) : T('LeftUpLeg')[1];
  const kneeY = T('LeftLeg')[1] * (hipY / T('LeftUpLeg')[1]);
  const ankleY = T('LeftFoot')[1];
  const ankles = legsAt(ankleY) ?? legsAt(ankleY + H * 0.03);
  const knees = kneeY <= apartTo ? legsAt(kneeY) : null;
  // The torso's middle and depth at the hips, for anything under a skirt.
  const torsoAt = (y: number, halfWidth = H * 0.12): Vec3 => middle(inBox(-halfWidth, halfWidth, y - step * 2, y + step * 2)) ?? [0, y, 0];
  const pelvis = torsoAt(hipY);
  const leg = (side: 1 | -1) => {
    const s = side > 0 ? 'left' : 'right';
    const ankle: Vec3 = ankles ? [ankles[s][0], ankleY, ankles[s][2]] : [T('LeftFoot')[0] * side, ankleY, T('LeftFoot')[2]];
    // The hip's width: the template's, or the stance's if the feet are closer in than that.
    const hipX = side * Math.min(T('LeftUpLeg')[0], Math.abs(ankle[0]) * 0.9 + H * 0.01);
    const hip: Vec3 = [hipX, hipY, pelvis[2]];
    const knee: Vec3 = knees
      ? [knees[s][0], kneeY, knees[s][2]]
      : [hip[0] + (ankle[0] - hip[0]) * ((hipY - kneeY) / (hipY - ankleY)), kneeY, (hip[2] + ankle[2]) / 2 + H * 0.02];
    // The toes: the foot's front, low, on that side.
    const foot = inBox(side > 0 ? 0 : -H, side > 0 ? H : 0, 0, H * 0.04);
    let front = ankle[2] + H * 0.08;
    for (const i of foot) if (Math.abs(X(i) - ankle[0]) < H * 0.06) front = Math.max(front, Z(i));
    const toe: Vec3 = [ankle[0] + side * H * 0.01, H * 0.021, ankle[2] + (front - ankle[2]) * 0.6];
    return { UpLeg: hip, Leg: knee, Foot: ankle, ToeBase: toe };
  };
  const lLeg = leg(1), rLeg = leg(-1);

  // TORSO AND HEAD: the template's heights stretched between the hips and the shoulder line.
  const tHip = T('LeftUpLeg')[1], tArm = T('LeftArm')[1];
  const shoulderY = (left.Arm[1] + right.Arm[1]) / 2;
  const lift = (y: number) => hipY + ((y - tHip) / (tArm - tHip)) * (shoulderY - hipY);
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, Y(i));
  const spineAt = (name: string): Vec3 => {
    const y = name === 'Hips' ? hipY + (T('Hips')[1] - tHip) * ((shoulderY - hipY) / (tArm - tHip)) : lift(T(name)[1]);
    const c = torsoAt(Math.min(y, shoulderY - step), H * 0.1);
    // A spine runs behind the middle of the body: a fifth of the way to the back.
    const slice = inBox(-H * 0.1, H * 0.1, y - step * 2, y + step * 2);
    let back = c[2];
    for (const i of slice) back = Math.min(back, Z(i));
    return [c[0], y, c[2] + (back - c[2]) * 0.25];
  };
  const joints: Record<string, Vec3> = {};
  for (const name of ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck']) joints[name] = spineAt(name);
  // The head's pivot at the template's share between the neck and the top of the head.
  const neck = joints.neck;
  const headShare = (T('Head')[1] - T('neck')[1]) / (T('head_end')[1] - T('neck')[1]);
  const headY = neck[1] + (top - neck[1]) * headShare;
  const head = torsoAt(headY, H * 0.08);
  joints.Head = [head[0], headY, head[2]];
  joints.head_end = [head[0], top, head[2]];
  joints.headfront = [head[0], headY, head[2] + H * 0.11];
  joints.LeftShoulder = [neck[0] + H * 0.018, shoulderY, neck[2]];
  joints.RightShoulder = [neck[0] - H * 0.018, shoulderY, neck[2]];
  for (const [side, a, l] of [['Left', left, lLeg], ['Right', right, rLeg]] as const) {
    joints[`${side}Arm`] = a.Arm;
    joints[`${side}ForeArm`] = a.ForeArm;
    joints[`${side}Hand`] = a.Hand;
    joints[`${side}UpLeg`] = l.UpLeg;
    joints[`${side}Leg`] = l.Leg;
    joints[`${side}Foot`] = l.Foot;
    joints[`${side}ToeBase`] = l.ToeBase;
  }
  return { joints, notes };
}
