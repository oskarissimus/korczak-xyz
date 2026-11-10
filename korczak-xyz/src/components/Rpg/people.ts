/*
 * The people fal.ai made (owner, 27–28 Oct 2026: "generated character models with animations,
 * because now it is always the same few models and it breaks immersion"; and then "no Quaternius
 * characters: nothing until it is generated, then it is there").
 *
 * A person is a TRELLIS mesh (`personPrompt`, `ensurePersonModel` in `utils/rpg/landmark3d.ts`)
 * rigged here for nothing (`utils/rpg/selfRig.ts`, in a worker): a donor body Meshy rigged once is
 * warped onto it and lends it its skeleton and skin weights. Every rig has the donor's 24 bones and
 * rest rotations, so one clip library, made by Meshy on the male donor, moves every person; the clips
 * keep the game's names (`Clip` in `characters.ts`), so the scene drives a generated person and a
 * Quaternius one alike. The rig is worked out once per model and kept in the Cache API beside the
 * GLB's bytes.
 *
 * The files are `src/assets/rpg/people/`, made by `scripts/rpg-people.mjs`: two donors (~70 KB each)
 * and the clips (~110 KB gzipped).
 *
 * OR MESHY, BY DEFAULT (owner, 29 Oct 2026: "a toggle in the settings to choose our own rig or Meshy
 * via fal.ai; ours is weak, maybe Meshy will be better, I'd like to try; Meshy by default"). With
 * `rigger` 'meshy' and a fal key, the TRELLIS model goes to Meshy's auto-rig (`rigWithMeshy`, $0.20,
 * 1–3 min) and comes back with the very skeleton the donors were cut from, so the same clips fit it
 * with nothing but the hips' height. The rigged GLB's URL is kept in the Cache API beside the GLB, so a
 * model is paid for once per browser; a body Meshy refuses or a failed request falls back to the
 * browser's own rig, and the console says both.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import clipsUrl from '../../assets/rpg/people/people_clips.json?url';
import donorFemaleUrl from '../../assets/rpg/people/donor_female.bin?url';
import donorMaleUrl from '../../assets/rpg/people/donor_male.bin?url';
import { endRequest, startRequest } from '../../utils/rpg/devlog';
import { keepGlbOnFal, loadLandmarkBytes, rigWithMeshy } from '../../utils/rpg/landmark3d';
import { facing, turnGlb, type Pixels } from '../../utils/rpg/facing';
import { log } from '../../lib/logger';
import { accountHasMeshyRig, fetchSelfRig, keepSelfRig } from '../../utils/rpg/accountAssets';
import { retargetClips, aimedLike, type PoseSkeleton } from '../../utils/rpg/retarget';
import { parseDonor, selfRig, type Donor, type SelfRig, type SelfRigOptions } from '../../utils/rpg/selfRig';
import { skinTokensWeights, wakeSkinTokens } from '../../utils/rpg/skinWeights';
import { endRig, rigStage, startRig, trackRig, type RigStage } from '../../utils/rpg/rigging';
import { recordMeasurement } from '../../lib/sentry';
import { Rig } from './characters';

export type { RigStage } from '../../utils/rpg/rigging';

/**
 * How far along a person is, worst to best (owner, 10 Nov 2026: "a stickman on the rig, static,
 * before the model has loaded, then the model, then the model with the simple rig, then with the
 * advanced one"): a stage is shown only over a lower one, never over one as good or better.
 */
export const STAGE_RANK: Record<RigStage, number> = { stickman: 0, static: 1, fast: 2, full: 3 };

export type Body = 'male' | 'female';

/**
 * Who gives a generated person their skeleton: Meshy on fal.ai, or the browser (`selfRig`) — with
 * the donor's weights copied (`self`), or weighed through the body from the joints (`voxel`,
 * `voxelSkin`; owner, 31 Oct 2026: "SOTA non-AI rigging methods we could use"), or with the joints
 * read off a T-posed mesh against a standard body (`fit`, `tPoseJoints`; owner, 1 Nov 2026).
 */
export type Rigger = 'meshy' | 'voxel' | 'fit' | 'skin';
export const DEFAULT_RIGGER: Rigger = 'meshy';

/** Heights a person is rigged at, feet to crown, by who they are. */
export const PERSON_HEIGHT = { male: 1.78, female: 1.68, hero: 1.85, enemy: 1.8 } as const;

/** A person rigged and stood on the origin, facing +Z; clone it for each copy (`dress`). */
export interface PersonTemplate {
  group: THREE.Group;
  /** Clips fitted to this rig's hips. */
  clips: Map<string, THREE.AnimationClip>;
  /** How long working out the rig took, 0 when it came from the cache. */
  ms: number;
  /** SkinTokens' own time on the server, when its weights are in this rig. */
  skinMs?: number;
}

/** A rig as `template` makes it, and whether it is the fitted rig standing in for a better one that failed. */
interface Made {
  template: PersonTemplate;
  fallback: boolean;
}

/** The TRELLIS model as `standing` reads it: its mesh, its geometry stood up the right way round. */
interface Standing {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  turned: boolean;
}

/** One person being brought in stage by stage (`People.staged`), shared by everyone who asks for them. */
interface Chain {
  best: { stage: RigStage; template: PersonTemplate } | null;
  listeners: Set<(t: PersonTemplate, stage: RigStage) => void>;
  done: Promise<PersonTemplate>;
}

/** The stickman's look: chalk-pale, matte, so it reads as a placeholder and not as somebody. */
const STICK_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xe6e1d3, roughness: 0.85, metalness: 0 });

interface ClipData {
  name: string;
  duration: number;
  tracks: { name: string; type: 'quaternion' | 'vector'; times: number[]; values: number[] }[];
}

/**
 * How many heads the model has: the separate lumps of it across the band just under its top (86 to
 * 96 per cent of its height), above where arms held out in a T-pose reach. One person has one; two
 * side by side, even of different heights, have two.
 */
export function heads(geometry: THREE.BufferGeometry): number {
  const p = geometry.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const x = p.getX(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const height = maxY - minY || 1;
  const mid = (minX + maxX) / 2;
  const xs: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const y = (p.getY(i) - minY) / height;
    // Only near the middle: a T-pose's thumbs, held up at the ends of the arms, reach the band too.
    if (y >= 0.86 && y <= 0.96 && Math.abs(p.getX(i) - mid) <= height * 0.35) xs.push(p.getX(i));
  }
  xs.sort((a, b) => a - b);
  let count = xs.length ? 1 : 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > height * 0.05) count++;
  return count;
}

/**
 * Whether a model stands with its arms straight out, a T-pose (owner, 29 Oct 2026: "now that Nano
 * Banana draws a good, repeatable T-pose, a procedural rig should be easier; the old one was for the
 * A-pose"): across its shoulders' band, 72–86 % of its height, it is most of its height wide, where
 * an A-pose is under half.
 */
export function armsOut(geometry: THREE.BufferGeometry): boolean {
  const p = geometry.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY || 1;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = (p.getY(i) - minY) / height;
    if (y < 0.72 || y > 0.86) continue;
    const x = p.getX(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  return maxX - minX > height * 0.7;
}

const ARMS = [
  ['LeftArm', 'LeftForeArm', 1],
  ['LeftForeArm', 'LeftHand', 1],
  ['RightArm', 'RightForeArm', -1],
  ['RightForeArm', 'RightHand', -1],
] as const;

/**
 * The donor stood in a T-pose: each upper arm and forearm turned to point straight out sideways, and
 * its points carried with them by its own skin weights. Warping this onto a T-posed model is the same
 * easy warp the A-posed donor has onto an A-posed one, where the A-posed donor's arms, hanging at its
 * sides, could never find arms held out. The posed rotations become the rig's rest, so the skin is
 * bound in the T-pose and a clip, which sets every bone's rotation outright, still lowers the arms.
 */
export function tPoseDonor(donor: Donor): Donor {
  const n = donor.bones.length;
  const index = new Map(donor.bones.map((b, i) => [b.name, i]));
  const local = donor.bones.map((b) => new THREE.Quaternion().fromArray(b.quaternion));
  const worldOf = (rot: THREE.Quaternion[]) => {
    const m: THREE.Matrix4[] = [];
    donor.bones.forEach((b, i) => {
      const own = new THREE.Matrix4().compose(new THREE.Vector3().fromArray(b.position), rot[i], new THREE.Vector3(1, 1, 1));
      m[i] = b.parent < 0 ? own : m[b.parent].clone().multiply(own);
    });
    return m;
  };
  const rest = worldOf(local);
  const posed = local.map((q) => q.clone());
  for (const [bone, child, side] of ARMS) {
    const b = index.get(bone);
    const c = index.get(child);
    if (b === undefined || c === undefined) continue;
    const m = worldOf(posed);
    const from = new THREE.Vector3().setFromMatrixPosition(m[b]);
    const dir = new THREE.Vector3().setFromMatrixPosition(m[c]).sub(from).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(side, 0, 0));
    const world = new THREE.Quaternion().setFromRotationMatrix(m[b]);
    const parent = new THREE.Quaternion().setFromRotationMatrix(m[donor.bones[b].parent]);
    posed[b] = parent.invert().multiply(turn.multiply(world));
  }
  const after = worldOf(posed);
  const skin = after.map((m, i) => m.clone().multiply(rest[i].clone().invert()));
  const positions = new Float32Array(donor.positions.length);
  const v = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (let i = 0; i < donor.positions.length / 3; i++) {
    sum.set(0, 0, 0);
    for (let a = 0; a < 4; a++) {
      const w = donor.skinWeight[i * 4 + a];
      if (!w) continue;
      v.fromArray(donor.positions, i * 3).applyMatrix4(skin[donor.skinIndex[i * 4 + a]]);
      sum.addScaledVector(v, w);
    }
    sum.toArray(positions, i * 3);
  }
  const bones = donor.bones.map((b, i) => ({
    ...b,
    quaternion: posed[i].toArray() as [number, number, number, number],
    world: new THREE.Vector3().setFromMatrixPosition(after[i]).toArray() as [number, number, number],
  }));
  return { bones: bones.slice(0, n), positions, skinIndex: donor.skinIndex, skinWeight: donor.skinWeight };
}

/** Bumped when `selfRig` changes what it answers, so no rig worked out before is reused. */
const RIG_VERSION = 1;
const CACHE = 'rpg-landmarks';

/** The rigged GLB's URL Meshy answered, from the cache when this browser has paid for it before. */
async function cachedMeshy(key: string, make: () => Promise<string>): Promise<string> {
  let cache: Cache | null = null;
  try {
    cache = typeof caches === 'undefined' ? null : await caches.open(CACHE);
    const hit = await cache?.match(key);
    if (hit) return await hit.text();
  } catch {
    cache = null;
  }
  const url = await make();
  try {
    await cache?.put(key, new Response(url));
  } catch {
    /* asked again next time, and paid again */
  }
  return url;
}

/**
 * The clip library carried onto a skeleton Meshy rigged (`retargetClips`): from the donor the clips
 * were made on, stood the way this rig rests (`aimedLike`), so a bone's own axes no longer have to be
 * the donor's. Copied as they were, a T-posed model's arms bent in the wrong plane and its hands
 * turned over (owner, 31 Oct 2026: "the arms bend unnaturally when walking, the hands the strangest").
 */
function meshyClips(clips: ClipData[], donor: Donor, hips: THREE.Bone): ClipData[] {
  const bones: THREE.Bone[] = [];
  hips.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const target: PoseSkeleton = {
    names: bones.map((b) => b.name),
    parent: bones.map((b) => bones.indexOf(b.parent as THREE.Bone)),
    local: bones.map((b) => b.quaternion.toArray() as [number, number, number, number]),
    offset: bones.map((b) => b.position.toArray() as [number, number, number]),
  };
  const source: PoseSkeleton = {
    names: donor.bones.map((b) => b.name),
    parent: donor.bones.map((b) => b.parent),
    local: donor.bones.map((b) => b.quaternion),
    offset: donor.bones.map((b) => b.position),
  };
  const holder = hips.parent ?? new THREE.Object3D();
  holder.updateMatrixWorld(true);
  const reference = aimedLike(source, target, holder.matrixWorld);
  return retargetClips(clips, source, reference, target, holder.getWorldQuaternion(new THREE.Quaternion()));
}

/** Clips fitted to a rig whose hips rest at `hips` (in the hips' parent's units). */
function fitClips(clips: ClipData[], hips: THREE.Vector3): Map<string, THREE.AnimationClip> {
  const fitted = new Map<string, THREE.AnimationClip>();
  for (const c of clips) {
    const tracks = c.tracks.map((t) => {
      if (t.type === 'quaternion') return new THREE.QuaternionKeyframeTrack(t.name, t.times, t.values);
      // The library's hips are a share of its rig's height; these are this rig's.
      const values = t.values.map((v, i) => (i % 3 === 1 ? v * hips.y : i % 3 === 0 ? hips.x : hips.z));
      return new THREE.VectorKeyframeTrack(t.name, t.times, values);
    });
    fitted.set(c.name, new THREE.AnimationClip(c.name, c.duration, tracks));
  }
  return fitted;
}

let worker: Worker | null | undefined;
let nextJob = 0;
const jobs = new Map<number, { resolve: (r: SelfRig) => void; reject: (e: Error) => void }>();

/** In a worker where there is one, else here: a frame frozen for a few seconds beats no person. */
function rigOffThread(donor: Donor, target: Float32Array, height: number, options: SelfRigOptions = {}): Promise<SelfRig> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./selfRig.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; rig?: SelfRig; error?: string }>) => {
        const job = jobs.get(e.data.id);
        jobs.delete(e.data.id);
        if (e.data.rig) job?.resolve(e.data.rig);
        else job?.reject(new Error(e.data.error ?? 'the rig failed'));
      };
      worker.onerror = () => {
        worker = null;
        for (const job of jobs.values()) job.reject(new Error('the rig worker failed'));
        jobs.clear();
      };
    } catch {
      worker = null;
    }
  }
  if (!worker) return Promise.resolve(selfRig(donor, target, height, options));
  const id = nextJob++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker!.postMessage({ id, donor, target, height, options });
  });
}

/** A rig as bytes for the Cache API: counts, then the four arrays. */
function packRig(r: SelfRig): ArrayBuffer {
  const nT = r.positions.length / 3, nB = r.joints.length / 3;
  const out = new ArrayBuffer(8 + nT * 12 + nT * 8 + nT * 16 + nB * 12);
  const head = new Uint32Array(out, 0, 2);
  head[0] = nT;
  head[1] = nB;
  let o = 8;
  new Float32Array(out, o, nT * 3).set(r.positions);
  o += nT * 12;
  new Uint16Array(out, o, nT * 4).set(r.skinIndex);
  o += nT * 8;
  new Float32Array(out, o, nT * 4).set(r.skinWeight);
  o += nT * 16;
  new Float32Array(out, o, nB * 3).set(r.joints);
  return out;
}

function unpackRig(buf: ArrayBuffer): SelfRig {
  const [nT, nB] = new Uint32Array(buf, 0, 2);
  let o = 8;
  const positions = new Float32Array(buf.slice(o, o + nT * 12));
  o += nT * 12;
  const skinIndex = new Uint16Array(buf.slice(o, o + nT * 8));
  o += nT * 8;
  const skinWeight = new Float32Array(buf.slice(o, o + nT * 16));
  o += nT * 16;
  const joints = new Float32Array(buf.slice(o, o + nB * 12));
  return { positions, skinIndex, skinWeight, joints };
}

/**
 * A rig from this browser's cache, else the account's (worked out on another device, kept in the
 * bucket by `keepSelfRig`), else worked out here and kept in both. Owner, 31 Oct 2026: "every
 * generated asset in the bucket", our own rigs included.
 */
async function cachedRig(key: string, make: () => Promise<SelfRig>): Promise<{ rig: SelfRig; ms: number }> {
  let cache: Cache | null = null;
  try {
    cache = typeof caches === 'undefined' ? null : await caches.open(CACHE);
    const hit = await cache?.match(key);
    if (hit) return { rig: unpackRig(await hit.arrayBuffer()), ms: 0 };
  } catch {
    cache = null;
  }
  const kept = await fetchSelfRig(key);
  if (kept) {
    try {
      const rig = unpackRig(kept);
      await cache?.put(key, new Response(kept)).catch(() => undefined);
      return { rig, ms: 0 };
    } catch {
      /* not a rig after all: worked out again */
    }
  }
  const started = performance.now();
  const rig = await make();
  const ms = performance.now() - started;
  const packed = packRig(rig);
  try {
    await cache?.put(key, new Response(packed));
  } catch {
    /* worked out again next time */
  }
  void keepSelfRig(key, packed, { cacheKey: key, version: RIG_VERSION, weights: /&w=skin/.test(key) ? 'skintokens' : 'voxel', joints: /&w=(fit|skin)/.test(key) ? 'fit' : 'warp', ms: Math.round(ms) });
  return { rig, ms };
}

/** The donors and the clips, fetched once, on the first person anybody asks for. */
/** A drawable's pixels at `size` × `size` (the aspect is not kept: both sides are compared on a grid). */
function pixelsOf(source: CanvasImageSource, size: number): Pixels | null {
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Whether the model faces −Z rather than +Z, which every rig here assumes (`utils/rpg/facing.ts`:
 * TRELLIS turned Mila round, 2 Nov 2026), judged against the picture it was made from and kept in
 * the Cache API beside the GLB, so the picture is fetched once. No picture, or one that will not
 * load, says nothing, and the model is taken as it is.
 */
async function turnedRound(url: string, mesh: THREE.Mesh, geometry: THREE.BufferGeometry, picture: string | undefined, label: string): Promise<boolean> {
  const key = `${url}?facing=1`;
  let cache: Cache | null = null;
  try {
    cache = typeof caches === 'undefined' ? null : await caches.open(CACHE);
    const hit = await cache?.match(key);
    if (hit) return (await hit.text()) === 'back';
  } catch {
    cache = null;
  }
  if (!picture) return false;
  try {
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const image = material.map?.image as CanvasImageSource | undefined;
    const uvs = geometry.attributes.uv;
    if (!image || !uvs) return false;
    const res = await fetch(picture);
    if (!res.ok) return false;
    const bitmap = await createImageBitmap(await res.blob());
    const pic = pixelsOf(bitmap, 128);
    bitmap.close();
    const tex = pixelsOf(image, 256);
    if (!pic || !tex) return false;
    const seen = facing(
      { positions: geometry.attributes.position.array, uvs: uvs.array, index: geometry.index ? geometry.index.array : null },
      tex,
      pic,
    );
    if (!seen) return false;
    if (seen.turned) log.info('rpg.person.turned', { label, url, front: Math.round(seen.front), back: Math.round(seen.back) });
    try {
      await cache?.put(key, new Response(seen.turned ? 'back' : 'front'));
    } catch {
      /* judged again next time */
    }
    return seen.turned;
  } catch (err) {
    log.warn('rpg.person.facing.failed', { label, url, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export class People {
  private loaded: Promise<{ donors: Record<Body, Donor>; clips: ClipData[] }> | null = null;
  private templates = new Map<string, Promise<Made>>();
  private chains = new Map<string, Chain>();
  private sticks = new Map<string, Promise<PersonTemplate>>();
  private stood = new Map<string, Promise<Standing>>();
  /** The quick rig's raw result, shared with the SkinTokens rig built on its joints. */
  private fitRigs = new Map<string, Promise<{ rig: SelfRig; ms: number }>>();
  private tPosed: Partial<Record<Body, Donor>> = {};
  /** The picture each model was made from, as last told, for a re-rig asked without one (`RpgScene.setRigger`). */
  private pictures = new Map<string, string>();
  /** Who rigs the people asked for from now on; Meshy only with a fal key to pay with. */
  rigger: Rigger = DEFAULT_RIGGER;
  private wokenAt = 0;
  falKey: string | null = null;

  private load() {
    this.loaded ??= (async () => {
      const [male, female, clips] = await Promise.all([
        fetch(donorMaleUrl).then((r) => r.arrayBuffer()),
        fetch(donorFemaleUrl).then((r) => r.arrayBuffer()),
        fetch(clipsUrl).then((r) => r.json() as Promise<ClipData[]>),
      ]);
      return { donors: { male: parseDonor(male), female: parseDonor(female) }, clips };
    })();
    this.loaded.catch(() => (this.loaded = null));
    return this.loaded;
  }

  /**
   * Wakes the SkinTokens service when a rig will soon need it (`wakeSkinTokens`), at most every five
   * minutes, which is less than Cloud Run keeps an idle instance. Nothing for any other rigger.
   */
  warm(): void {
    if (this.rigger !== 'skin' || Date.now() - this.wokenAt < 5 * 60_000) return;
    this.wokenAt = Date.now();
    void wakeSkinTokens();
  }

  /** Keeps a rig Meshy answered along with the model (`meshyRigged`), as if `buildMeshy` had asked for it. */
  async keepMeshyRig(url: string, height: number, rigged: string): Promise<void> {
    try {
      if (typeof caches !== 'undefined') await (await caches.open(CACHE)).put(`${url}?meshy=1&height=${height}`, new Response(rigged));
    } catch {
      /* rigged again, and paid again, if asked */
    }
  }

  /**
   * Whether Meshy's rig of `url` at `height` is already paid for, so asking for it again costs
   * nothing: held by this browser, or kept on the account (`accountAssets.ts`) — rigged in the game,
   * in the lab, or on another device, which the gateway then answers from the bucket.
   */
  async meshyCached(url: string, height: number): Promise<boolean> {
    try {
      if (typeof caches !== 'undefined' && (await (await caches.open(CACHE)).match(`${url}?meshy=1&height=${height}`))) return true;
    } catch {
      /* asked of the account instead */
    }
    return accountHasMeshyRig(url, height);
  }

  /** Which rig `rigger` and the fal key make in the end: Meshy with no key to pay with is `fit`. */
  private finalMode(): 'meshy' | 'voxel' | 'fit' | 'skin' {
    return this.rigger === 'meshy' ? (this.falKey ? 'meshy' : 'fit') : this.rigger;
  }

  /**
   * A person from their GLB, rigged on `body`'s donor at `height` metres; once per model and body.
   * Working out a rig is a row in the console (kind `fal`, `label` as the piece's): model `self-rig`,
   * with its time and a price of nothing, or Meshy's with its $0.20; one from the cache is not.
   * The lab's way in: the best rig in one go, with no stages (`staged` is the game's).
   */
  template(url: string, body: Body, height: number, label = 'person', picture?: string): Promise<PersonTemplate> {
    if (picture) this.pictures.set(url, picture);
    else picture = this.pictures.get(url);
    const { made, fresh } = this.rig(url, body, height, label, picture);
    const t = made.then((m) => m.template);
    // In the start's progress until it is there (`utils/rpg/rigging.ts`), the fallback included.
    if (fresh) trackRig(label, url, t);
    return t;
  }

  /** The rig keyed as `rigger` asks; `fresh` when this call is the one that started it. */
  private rig(url: string, body: Body, height: number, label: string, picture?: string): { made: Promise<Made>; fresh: boolean } {
    // A query, not a fragment: the Cache API drops fragments, and the GLB itself is kept under its URL.
    // Meshy with no fal.ai key, or Meshy failing, rigs as `fit` (the first way, the donor's weights
    // copied, was taken out on 1 Nov 2026: "it still mangles the character").
    const final = this.finalMode();
    const mode = final === 'meshy' ? 'fit' : final;
    const own = `${url}?rig=${RIG_VERSION}&body=${body}&height=${height}&w=${mode}`;
    const key = final === 'meshy' ? `${url}?meshy=1&height=${height}` : own;
    let t = this.templates.get(key);
    if (t) return { made: t, fresh: false };
    const fitted = () => this.fitTemplate(url, body, height, label, picture).then((template) => ({ template, fallback: true }));
    t =
      final === 'meshy'
        ? this.buildMeshy(this.falKey!, url, key, height, label, picture).then((template) => ({ template, fallback: false }), fitted)
        : mode === 'skin'
          ? this.build(url, key, body, height, label, 'skin', picture).then((template) => ({ template, fallback: false }), fitted)
          : mode === 'fit'
            ? this.fitTemplate(url, body, height, label, picture).then((template) => ({ template, fallback: false }))
            : this.build(url, key, body, height, label, mode, picture).then((template) => ({ template, fallback: false }));
    t.catch(() => this.templates.delete(key));
    this.templates.set(key, t);
    return { made: t, fresh: true };
  }

  /** The quick rig of our own (`fit`: fitted joints, voxel weights, ~1–4 s in the worker), once per model and body. */
  private fitTemplate(url: string, body: Body, height: number, label: string, picture?: string): Promise<PersonTemplate> {
    const key = `${url}?rig=${RIG_VERSION}&body=${body}&height=${height}&w=fit`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.build(url, key, body, height, label, 'fit', picture).then((template) => ({ template, fallback: false }));
      t.catch(() => this.templates.delete(key));
      this.templates.set(key, t);
    }
    return t.then((m) => m.template);
  }

  /**
   * A person brought in stage by stage, each shown as it comes and none blocking the game (owner,
   * 10 Nov 2026: "put the models up static as soon as they are generated, then the quick rig, then
   * the one from our backend — improve it step by step"): a static stickman on the donor's skeleton
   * at once, the model standing still once its GLB is read, our quick `fit` rig a second or a few
   * later, and then the rig the settings ask for (SkinTokens behind the gateway, or Meshy) when it is
   * a better one. `show` is called with each better stage, the best so far at once for a caller that
   * comes late. Settles with the last rig, and rejects only when no rig at all could be made (the
   * static model may still be standing then; what to do is the caller's).
   *
   * Every stage's time from the ask is recorded on the rig's job (`rigStage`) for the console, and
   * once the last is in, as `rpg.rig` in Sentry (`recordMeasurement`) when anything was worked out.
   */
  staged(url: string, body: Body, height: number, label: string, picture: string | undefined, show: (t: PersonTemplate, stage: RigStage) => void): Promise<PersonTemplate> {
    if (picture) this.pictures.set(url, picture);
    else picture = this.pictures.get(url);
    const final = this.finalMode();
    const key = `${url}|${body}|${height}|${label}|${final}`;
    let chain = this.chains.get(key);
    if (!chain) chain = this.chain(key, url, body, height, label, picture, final);
    if (chain.best) show(chain.best.template, chain.best.stage);
    chain.listeners.add(show);
    void chain.done.then(
      () => chain!.listeners.delete(show),
      () => chain!.listeners.delete(show),
    );
    return chain.done;
  }

  private chain(key: string, url: string, body: Body, height: number, label: string, picture: string | undefined, final: ReturnType<People['finalMode']>): Chain {
    const job = startRig(label, url);
    const started = performance.now();
    const at: Partial<Record<RigStage, number>> = {};
    const chain: Chain = { best: null, listeners: new Set(), done: null as unknown as Promise<PersonTemplate> };
    const offer = (stage: RigStage, template: PersonTemplate) => {
      at[stage] ??= Math.round(performance.now() - started);
      rigStage(job, stage, template.ms > 0);
      if (chain.best && STAGE_RANK[stage] <= STAGE_RANK[chain.best.stage]) return;
      chain.best = { stage, template };
      for (const l of chain.listeners) l(template, stage);
    };
    this.stickman(body, height).then((t) => offer('stickman', t), () => undefined);
    this.staticModel(url, height, label, picture).then(
      (t) => offer('static', t),
      () => undefined,
    );
    // Two rigs only when the last is better than our quick one: SkinTokens' weights, or Meshy's.
    const twoRigs = final === 'skin' || final === 'meshy';
    let fastMs = 0;
    if (twoRigs)
      this.fitTemplate(url, body, height, label, picture).then(
        (t) => {
          fastMs = t.ms;
          offer('fast', t);
        },
        () => undefined,
      );
    const { made } = this.rig(url, body, height, label, picture);
    chain.done = made.then(({ template, fallback }) => {
      offer(twoRigs && !fallback ? 'full' : 'fast', template);
      return template;
    });
    this.chains.set(key, chain);
    const measure = (template: PersonTemplate | null, error?: string) => {
      const worked = !template || template.ms > 0 || fastMs > 0;
      if (!worked) return;
      recordMeasurement('rpg.rig', {
        label,
        rigger: final,
        reached: chain.best?.stage ?? 'none',
        failed: !template,
        error,
        stickmanMs: at.stickman,
        staticMs: at.static,
        fastMs: at.fast,
        fullMs: at.full,
        totalMs: Math.round(performance.now() - started),
        fastWorkMs: Math.round(fastMs),
        lastWorkMs: template ? Math.round(template.ms) : undefined,
        skinMs: template?.skinMs,
      });
    };
    chain.done.then(
      (t) => {
        endRig(job, t.ms);
        measure(t);
        this.stood.delete(`${url}|${label === 'enemy' ? 'enemy' : 'person'}`);
      },
      (err) => {
        endRig(job, null);
        measure(null, err instanceof Error ? err.message : String(err));
        this.chains.delete(key);
      },
    );
    return chain;
  }

  /**
   * The first thing that stands for a person: the donor's skeleton as a stickman, static, at the
   * person's height — before their model has even been made. Once per body and height.
   */
  stickman(body: Body, height: number): Promise<PersonTemplate> {
    const key = `${body}@${height}`;
    let t = this.sticks.get(key);
    if (!t) {
      t = this.load().then(({ donors }) => {
        const bones = donors[body].bones;
        const top = bones.find((b) => b.name === 'head_end')?.world[1] ?? 1.73;
        const s = height / top;
        const at = (i: number) => new THREE.Vector3().fromArray(bones[i].world).multiplyScalar(s);
        const group = new THREE.Group();
        const r = 0.022 * (height / 1.8);
        const up = new THREE.Vector3(0, 1, 0);
        bones.forEach((b, i) => {
          if (b.parent < 0 || b.name === 'head_end' || b.name === 'headfront') return;
          const from = at(b.parent);
          const to = at(i);
          const length = from.distanceTo(to);
          if (length < 0.01) return;
          const limb = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 6), STICK_MATERIAL);
          limb.position.copy(from).add(to).multiplyScalar(0.5);
          limb.quaternion.setFromUnitVectors(up, to.clone().sub(from).normalize());
          limb.castShadow = true;
          group.add(limb);
          const knot = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 8, 6), STICK_MATERIAL);
          knot.position.copy(to);
          group.add(knot);
        });
        const head = bones.findIndex((b) => b.name === 'Head');
        const crown = bones.findIndex((b) => b.name === 'head_end');
        if (head >= 0 && crown >= 0) {
          const a = at(head);
          const c = at(crown);
          const skull = new THREE.Mesh(new THREE.SphereGeometry(a.distanceTo(c) * 0.5, 14, 10), STICK_MATERIAL);
          skull.position.copy(a).add(c).multiplyScalar(0.5);
          skull.castShadow = true;
          group.add(skull);
        }
        return { group, clips: new Map(), ms: 0 };
      });
      t.catch(() => this.sticks.delete(key));
      this.sticks.set(key, t);
    }
    return t;
  }

  /** The person's model as it came, unrigged and still: stood on the origin, `height` tall, facing +Z. */
  private staticModel(url: string, height: number, label: string, picture?: string): Promise<PersonTemplate> {
    return this.standing(url, label, picture).then(({ mesh, geometry }) => {
      const g = geometry.clone();
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const s = height / Math.max(box.max.y - box.min.y, 1e-3);
      const centre = box.getCenter(new THREE.Vector3());
      g.translate(-centre.x, -box.min.y, -centre.z);
      g.scale(s, s, s);
      g.computeBoundingSphere();
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
      // TRELLIS writes no metallic factor, which glTF reads as fully metallic: black, with no environment map.
      if (typeof material.metalness === 'number') material.metalness = 0;
      const still = new THREE.Mesh(g, material);
      still.castShadow = true;
      const group = new THREE.Group();
      group.add(still);
      return { group, clips: new Map(), ms: 0 };
    });
  }

  /**
   * The TRELLIS model's one mesh, in its file's frame; refused when it is not one standing person.
   * Not an enemy's: a rusted automaton with an exhaust pipe beside its head counted two (2 Nov 2026),
   * and an ogre may have two heads; FLUX drawing two people is a risk of the quest's characters.
   */
  private standing(url: string, label: string, picture?: string): Promise<Standing> {
    // Read once for the static model and the rigs that follow it (each rig clones the geometry).
    const key = `${url}|${label === 'enemy' ? 'enemy' : 'person'}`;
    let s = this.stood.get(key);
    if (!s) {
      s = this.readStanding(url, label, picture);
      s.catch(() => this.stood.delete(key));
      this.stood.set(key, s);
    }
    return s;
  }

  private async readStanding(url: string, label: string, picture?: string): Promise<Standing> {
    const bytes = await loadLandmarkBytes(url);
    const gltf = await new GLTFLoader().parseAsync(bytes, '');
    gltf.scene.updateMatrixWorld(true);
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !source) source = o as THREE.Mesh;
    });
    if (!source) throw new Error('no mesh in the model');
    const mesh: THREE.Mesh = source;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    // Two people side by side (FLUX did draw that) are two heads. Counted rather than measured: a
    // wide stance or a T-pose — Nano Banana draws one when asked for a wide pose — is as wide as two
    // people, but still has one head.
    const n = label === 'enemy' ? 1 : heads(geometry);
    if (n !== 1) throw new Error(`not one standing person (${n} heads)`);
    // Turned round to face +Z when it came facing −Z, before anything reads its joints off it.
    const turned = await turnedRound(url, mesh, geometry, picture, label);
    if (turned) {
      geometry.rotateY(Math.PI);
      geometry.computeBoundingBox();
    }
    return { mesh, geometry, turned };
  }

  /**
   * A person rigged by Meshy: its own skeleton, the donors' bone names, stood on the origin at
   * `height` (Meshy keeps the TRELLIS frame and its own centimetre armature). Checked as one standing
   * person first, so a picture of two is not paid for.
   */
  private async buildMeshy(falKey: string, url: string, key: string, height: number, label: string, picture?: string): Promise<PersonTemplate> {
    const [{ clips, donors }, { turned }] = await Promise.all([this.load(), this.standing(url, label, picture)]);
    const started = performance.now();
    // Meshy rigs the file as it is, with a skeleton facing +Z whichever way the body does (Mila's came
    // back with her left leg's bone in her right), so a model facing −Z goes to it turned round.
    const rigged = turned
      ? await cachedMeshy(`${key}&turn=1`, async () => rigWithMeshy(falKey, await keepGlbOnFal(falKey, turnGlb(await loadLandmarkBytes(url))), height, label))
      : await cachedMeshy(key, () => rigWithMeshy(falKey, url, height, label));
    const gltf = await new GLTFLoader().parseAsync(await loadLandmarkBytes(rigged), '');
    const model = gltf.scene;
    let hips: THREE.Bone | null = null;
    let skinned = false;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone && o.name === 'Hips' && !hips) hips = o as THREE.Bone;
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      skinned ||= !!mesh.isSkinnedMesh;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // TRELLIS writes no metallic factor, which glTF reads as fully metallic: black, with no environment map.
      for (const m of materials) if (typeof (m as THREE.MeshStandardMaterial).metalness === 'number') (m as THREE.MeshStandardMaterial).metalness = 0;
    });
    if (!skinned || !hips) throw new Error('Meshy answered a model with no skeleton');
    model.updateMatrixWorld(true);
    const moved = meshyClips(clips, donors.male, hips);
    const box = new THREE.Box3().setFromObject(model, true);
    const s = height / Math.max(box.max.y - box.min.y, 1e-3);
    const centre = box.getCenter(new THREE.Vector3());
    const stand = new THREE.Group();
    stand.scale.setScalar(s);
    stand.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
    stand.add(model);
    const group = new THREE.Group();
    group.add(stand);
    group.updateMatrixWorld(true);
    const ms = performance.now() - started;
    return { group, clips: fitClips(moved, (hips as THREE.Bone).position.clone()), ms };
  }

  private async build(url: string, key: string, wanted: Body, height: number, label: string, mode: 'voxel' | 'fit' | 'skin', picture?: string): Promise<PersonTemplate> {
    const [{ donors, clips }, stood] = await Promise.all([this.load(), this.standing(url, label, picture)]);
    const { mesh, turned } = stood;
    // Each rig its own copy: the static model and the other rigs are made from the same one.
    const geometry = stood.geometry.clone();
    // A T-posed model gets the donor stood in a T-pose (`tPoseDonor`), and a rig kept apart from the A-pose's.
    const tPosed = armsOut(geometry);
    // Fitted joints need no donor's shape, only its skeleton: the male one's, which the clips were
    // made on (the female donor's own skeleton is crooked — its head's end below its crown). An
    // A-posed model has no arms to measure along x, so it is weighed by voxels on the warp instead.
    // `skin` is `fit` (or the warp's joints on an A-posed model) with SkinTokens' weights in place of
    // the voxel ones, from the private service behind the gateway (`skinWeights.ts`).
    const fit = (mode === 'fit' || mode === 'skin') && tPosed;
    const body: Body = fit ? 'male' : wanted;
    const donor = tPosed ? (this.tPosed[body] ??= tPoseDonor(donors[body])) : donors[body];
    const pose = `${turned ? 'turned round (it faced −Z), ' : ''}${tPosed ? 'T-posed' : 'A-posed'}${fit ? ', fitted joints' : ''}, voxel weights`;
    const target = new Float32Array(geometry.attributes.position.array as ArrayLike<number>);
    const index = geometry.index ? new Uint32Array(geometry.index.array as ArrayLike<number>) : null;
    // A turned model is a rig of its own: one worked out before on it facing −Z is the backward one.
    const suffix = `${tPosed ? '&pose=t' : ''}${turned ? '&turn=1' : ''}`;
    // Our own rig, worked out once per key even when the quick stage and SkinTokens' rig both ask.
    const selfRigged = (rigKey: string) => {
      let r = this.fitRigs.get(rigKey);
      if (!r) {
        r = cachedRig(rigKey, async () => {
          const entry = startRequest('fal', 'self-rig', null, `← ${url}\n${body} donor, ${pose}, ${target.length / 3} vertices`, label);
          try {
            const made = await rigOffThread(donor, target, height, { index, joints: fit ? 'fit' : 'warp' });
            endRequest(entry, null, { cost: 0, text: `← ${url}\n${body} donor, ${pose}, ${target.length / 3} vertices → ${donor.bones.length} bones` });
            return made;
          } catch (err) {
            endRequest(entry, err instanceof Error ? err.message : String(err));
            throw err;
          }
        });
        r.catch(() => this.fitRigs.delete(rigKey));
        this.fitRigs.set(rigKey, r);
      }
      return r;
    };
    let skinMs: number | undefined;
    // A turned model is a rig of its own: one worked out before on it facing −Z is the backward one.
    // SkinTokens' rig is the quick one's joints and positions with the service's weights in place of the
    // voxel ones, so it waits on that rig (shared, not worked out twice) and then only on the service.
    const { rig, ms } =
      mode === 'skin'
        ? await cachedRig(`${key}${suffix}`, async () => {
            const base = (await selfRigged(`${key.replace('&w=skin', '&w=fit')}${suffix}`)).rig;
            if (!index) throw new Error('SkinTokens needs an indexed mesh');
            const entry = startRequest('fal', 'self-rig', null, `← ${url}\nSkinTokens weights on the fitted joints (${pose.replace(', voxel weights', '')}), ${target.length / 3} vertices`, label);
            try {
              const skin = await skinTokensWeights(base.positions, index, base.joints, donor.bones.map((b) => b.parent));
              skinMs = skin.ms;
              endRequest(entry, null, { cost: 0, text: `← ${url}\n${body} donor, ${pose.replace(', voxel weights', '')}, SkinTokens weights (${(skin.ms / 1000).toFixed(0)} s on the service), ${target.length / 3} vertices → ${donor.bones.length} bones` });
              return { ...base, skinIndex: skin.skinIndex, skinWeight: skin.skinWeight };
            } catch (err) {
              // Not kept under this rig's key: the quick rig (voxel weights) stays, and the next visit asks SkinTokens again.
              endRequest(entry, err instanceof Error ? err.message : String(err));
              throw err;
            }
          })
        : await selfRigged(`${key}${suffix}`);

    geometry.setAttribute('position', new THREE.BufferAttribute(rig.positions, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(rig.skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(rig.skinWeight, 4));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // The donor's bones, at the joints worked out for this body, with the donor's rest rotations.
    const world: THREE.Quaternion[] = [];
    const bones = donor.bones.map((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.quaternion.fromArray(b.quaternion);
      const at = new THREE.Vector3().fromArray(rig.joints, i * 3);
      if (b.parent < 0) {
        bone.position.copy(at);
        world[i] = bone.quaternion.clone();
      } else {
        const from = new THREE.Vector3().fromArray(rig.joints, b.parent * 3);
        bone.position.copy(at.sub(from).applyQuaternion(world[b.parent].clone().invert()));
        world[i] = world[b.parent].clone().multiply(bone.quaternion);
      }
      return bone;
    });
    donor.bones.forEach((b, i) => {
      if (b.parent >= 0) bones[b.parent].add(bones[i]);
    });

    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
    // TRELLIS writes no metallic factor, which glTF reads as fully metallic: black, with no environment map.
    if (typeof material.metalness === 'number') material.metalness = 0;
    const skinned = new THREE.SkinnedMesh(geometry, material);
    skinned.castShadow = true;
    skinned.frustumCulled = false;
    const group = new THREE.Group();
    group.add(bones[0]);
    group.add(skinned);
    group.updateMatrixWorld(true);
    skinned.bind(new THREE.Skeleton(bones));

    // The clips were made on the male donor; the female one's bones point their axes other ways (her
    // head 121° off, her upper spine 82°), so copied as they are her head went back and her arms
    // twisted (owner, 31 Oct 2026, over a maid in a dress). Carried across like Meshy's (`meshyClips`).
    const fitted = body === 'male' ? clips : meshyClips(clips, donors.male, bones[0]);
    return { group, clips: fitClips(fitted, bones[0].position), ms, skinMs };
  }

  /** A copy of the person into `group` (emptied first), idling somewhere in the loop. */
  dress(group: THREE.Group, template: PersonTemplate): Rig {
    const rig = this.wear(group, template);
    if (!rig) throw new Error('a stage with no rig has nothing to animate');
    return rig;
  }

  /**
   * A copy of any stage into `group` (emptied first): the rigged ones idling somewhere in the loop,
   * the stickman and the static model standing still, with no rig to drive.
   */
  wear(group: THREE.Group, template: PersonTemplate): Rig | null {
    const model = SkeletonUtils.clone(template.group) as THREE.Group;
    group.clear();
    group.add(model);
    if (template.clips.size === 0) return null;
    const rig = new Rig(model, template.clips, 'RightHand');
    rig.play('Idle_Loop', { fade: 0 });
    rig.update(Math.random() * 2);
    return rig;
  }
}
