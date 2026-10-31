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
import { loadLandmarkBytes, rigWithMeshy } from '../../utils/rpg/landmark3d';
import { retargetClips, aimedLike, type PoseSkeleton } from '../../utils/rpg/retarget';
import { parseDonor, selfRig, type Donor, type SelfRig, type SelfRigOptions } from '../../utils/rpg/selfRig';
import { Rig } from './characters';

export type Body = 'male' | 'female';

/**
 * Who gives a generated person their skeleton: Meshy on fal.ai, or the browser (`selfRig`) — with
 * the donor's weights copied (`self`), or weighed through the body from the joints (`voxel`,
 * `voxelSkin`; owner, 31 Oct 2026: "SOTA non-AI rigging methods we could use").
 */
export type Rigger = 'meshy' | 'self' | 'voxel';
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
}

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

async function cachedRig(key: string, make: () => Promise<SelfRig>): Promise<{ rig: SelfRig; ms: number }> {
  let cache: Cache | null = null;
  try {
    cache = typeof caches === 'undefined' ? null : await caches.open(CACHE);
    const hit = await cache?.match(key);
    if (hit) return { rig: unpackRig(await hit.arrayBuffer()), ms: 0 };
  } catch {
    cache = null;
  }
  const started = performance.now();
  const rig = await make();
  const ms = performance.now() - started;
  try {
    await cache?.put(key, new Response(packRig(rig)));
  } catch {
    /* worked out again next time */
  }
  return { rig, ms };
}

/** The donors and the clips, fetched once, on the first person anybody asks for. */
export class People {
  private loaded: Promise<{ donors: Record<Body, Donor>; clips: ClipData[] }> | null = null;
  private templates = new Map<string, Promise<PersonTemplate>>();
  private tPosed: Partial<Record<Body, Donor>> = {};
  /** Who rigs the people asked for from now on; Meshy only with a fal key to pay with. */
  rigger: Rigger = DEFAULT_RIGGER;
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

  /** Keeps a rig Meshy answered along with the model (`meshyRigged`), as if `buildMeshy` had asked for it. */
  async keepMeshyRig(url: string, height: number, rigged: string): Promise<void> {
    try {
      if (typeof caches !== 'undefined') await (await caches.open(CACHE)).put(`${url}?meshy=1&height=${height}`, new Response(rigged));
    } catch {
      /* rigged again, and paid again, if asked */
    }
  }

  /** Whether this browser already holds Meshy's rig of `url` at `height`, so asking for it again costs nothing. */
  async meshyCached(url: string, height: number): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false;
      return Boolean(await (await caches.open(CACHE)).match(`${url}?meshy=1&height=${height}`));
    } catch {
      return false;
    }
  }

  /**
   * A person from their GLB, rigged on `body`'s donor at `height` metres; once per model and body.
   * Working out a rig is a row in the console (kind `fal`, `label` as the piece's): model `self-rig`,
   * with its time and a price of nothing, or Meshy's with its $0.20; one from the cache is not.
   */
  template(url: string, body: Body, height: number, label = 'person'): Promise<PersonTemplate> {
    // A query, not a fragment: the Cache API drops fragments, and the GLB itself is kept under its URL.
    const own = `${url}?rig=${RIG_VERSION}&body=${body}&height=${height}${this.rigger === 'voxel' ? '&w=voxel' : ''}`;
    const falKey = this.rigger === 'meshy' ? this.falKey : null;
    const key = falKey ? `${url}?meshy=1&height=${height}` : own;
    let t = this.templates.get(key);
    if (!t) {
      t = falKey
        ? this.buildMeshy(falKey, url, key, height, label).catch(() => this.build(url, own, body, height, label))
        : this.build(url, key, body, height, label, this.rigger === 'voxel' ? 'voxel' : 'donor');
      t.catch(() => this.templates.delete(key));
      this.templates.set(key, t);
    }
    return t;
  }

  /** The TRELLIS model's one mesh, in its file's frame; refused when it is not one standing person. */
  private async standing(url: string): Promise<{ mesh: THREE.Mesh; geometry: THREE.BufferGeometry }> {
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
    const n = heads(geometry);
    if (n !== 1) throw new Error(`not one standing person (${n} heads)`);
    return { mesh, geometry };
  }

  /**
   * A person rigged by Meshy: its own skeleton, the donors' bone names, stood on the origin at
   * `height` (Meshy keeps the TRELLIS frame and its own centimetre armature). Checked as one standing
   * person first, so a picture of two is not paid for.
   */
  private async buildMeshy(falKey: string, url: string, key: string, height: number, label: string): Promise<PersonTemplate> {
    const [{ clips, donors }] = await Promise.all([this.load(), this.standing(url)]);
    const started = performance.now();
    const rigged = await cachedMeshy(key, () => rigWithMeshy(falKey, url, height, label));
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

  private async build(url: string, key: string, body: Body, height: number, label: string, weights: 'donor' | 'voxel' = 'donor'): Promise<PersonTemplate> {
    const [{ donors, clips }, { mesh, geometry }] = await Promise.all([this.load(), this.standing(url)]);
    // A T-posed model gets the donor stood in a T-pose (`tPoseDonor`), and a rig kept apart from the A-pose's.
    const tPosed = armsOut(geometry);
    const donor = tPosed ? (this.tPosed[body] ??= tPoseDonor(donors[body])) : donors[body];
    const pose = `${tPosed ? 'T-posed' : 'A-posed'}${weights === 'voxel' ? ', voxel weights' : ''}`;
    const target = new Float32Array(geometry.attributes.position.array as ArrayLike<number>);
    const index = geometry.index ? new Uint32Array(geometry.index.array as ArrayLike<number>) : null;
    const { rig, ms } = await cachedRig(tPosed ? `${key}&pose=t` : key, async () => {
      const entry = startRequest('fal', 'self-rig', null, `← ${url}\n${body} donor, ${pose}, ${target.length / 3} vertices`, label);
      try {
        const made = await rigOffThread(donor, target, height, { weights, index });
        endRequest(entry, null, { cost: 0, text: `← ${url}\n${body} donor, ${pose}, ${target.length / 3} vertices → ${donor.bones.length} bones` });
        return made;
      } catch (err) {
        endRequest(entry, err instanceof Error ? err.message : String(err));
        throw err;
      }
    });

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
    return { group, clips: fitClips(fitted, bones[0].position), ms };
  }

  /** A copy of the person into `group` (emptied first), idling somewhere in the loop. */
  dress(group: THREE.Group, template: PersonTemplate): Rig {
    const model = SkeletonUtils.clone(template.group) as THREE.Group;
    group.clear();
    group.add(model);
    const rig = new Rig(model, template.clips, 'RightHand');
    rig.play('Idle_Loop', { fade: 0 });
    rig.update(Math.random() * 2);
    return rig;
  }
}
