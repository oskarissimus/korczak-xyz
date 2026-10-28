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
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import clipsUrl from '../../assets/rpg/people/people_clips.json?url';
import donorFemaleUrl from '../../assets/rpg/people/donor_female.bin?url';
import donorMaleUrl from '../../assets/rpg/people/donor_male.bin?url';
import { endRequest, startRequest } from '../../utils/rpg/devlog';
import { loadLandmarkBytes } from '../../utils/rpg/landmark3d';
import { parseDonor, selfRig, type Donor, type SelfRig } from '../../utils/rpg/selfRig';
import { Rig } from './characters';

export type Body = 'male' | 'female';

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

/** Bumped when `selfRig` changes what it answers, so no rig worked out before is reused. */
const RIG_VERSION = 1;
const CACHE = 'rpg-landmarks';

let worker: Worker | null | undefined;
let nextJob = 0;
const jobs = new Map<number, { resolve: (r: SelfRig) => void; reject: (e: Error) => void }>();

/** In a worker where there is one, else here: a frame frozen for a few seconds beats no person. */
function rigOffThread(donor: Donor, target: Float32Array, height: number): Promise<SelfRig> {
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
  if (!worker) return Promise.resolve(selfRig(donor, target, height));
  const id = nextJob++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker!.postMessage({ id, donor, target, height });
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
   * A person from their GLB, rigged on `body`'s donor at `height` metres; once per model and body.
   * Working out a rig is a row in the console (kind `fal`, model `self-rig`, `label` as the piece's),
   * with its time and a price of nothing; one from the cache is not.
   */
  template(url: string, body: Body, height: number, label = 'person'): Promise<PersonTemplate> {
    // A query, not a fragment: the Cache API drops fragments, and the GLB itself is kept under its URL.
    const key = `${url}?rig=${RIG_VERSION}&body=${body}&height=${height}`;
    let t = this.templates.get(key);
    if (!t) {
      t = this.build(url, key, body, height, label);
      t.catch(() => this.templates.delete(key));
      this.templates.set(key, t);
    }
    return t;
  }

  private async build(url: string, key: string, body: Body, height: number, label: string): Promise<PersonTemplate> {
    const [{ donors, clips }, bytes] = await Promise.all([this.load(), loadLandmarkBytes(url)]);
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
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    // A person in an A-pose is about half as wide as tall; two side by side (FLUX did draw that) are not.
    if (size.x > size.y * 0.85) throw new Error(`not one standing person (${size.x.toFixed(2)} wide, ${size.y.toFixed(2)} tall)`);
    const donor = donors[body];
    const target = new Float32Array(geometry.attributes.position.array as ArrayLike<number>);
    const { rig, ms } = await cachedRig(key, async () => {
      const entry = startRequest('fal', 'self-rig', null, `← ${url}\n${body} donor, ${target.length / 3} vertices`, label);
      try {
        const made = await rigOffThread(donor, target, height);
        endRequest(entry, null, { cost: 0, text: `← ${url}\n${body} donor, ${target.length / 3} vertices → ${donor.bones.length} bones` });
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

    const hips = bones[0].position;
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
    return { group, clips: fitted, ms };
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
