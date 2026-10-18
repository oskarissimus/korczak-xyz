/*
 * The RPG's people: Quaternius's fantasy outfits, base heads, hair and animation library (CC0),
 * cut down by `scripts/rpg-characters.mjs` into `src/assets/rpg/`. Every file is rigged to the
 * same 65-bone skeleton, so a person is put together here at run time — an outfit, a head, hair —
 * and the one clip library moves them all.
 *
 * The scene never waits for this. A character is a `THREE.Group` from the moment it exists (it
 * has a position, an obstacle, a marker pointing at it); `dress` fills the group once the files
 * have arrived, and until then it is simply empty. The files are a few MB, fetched once and then
 * served from cache under their content hash.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import animationsUrl from '../../assets/rpg/animations.glb?url';
import bodyMaleUrl from '../../assets/rpg/body_male.glb?url';
import femalePeasantUrl from '../../assets/rpg/female_peasant.glb?url';
import femaleRangerUrl from '../../assets/rpg/female_ranger.glb?url';
import hairBeardUrl from '../../assets/rpg/hair_beard.glb?url';
import hairBunsUrl from '../../assets/rpg/hair_buns.glb?url';
import hairBuzzedUrl from '../../assets/rpg/hair_buzzed.glb?url';
import hairBuzzedFemaleUrl from '../../assets/rpg/hair_buzzedfemale.glb?url';
import hairLongUrl from '../../assets/rpg/hair_long.glb?url';
import hairSimplePartedUrl from '../../assets/rpg/hair_simpleparted.glb?url';
import headFemaleUrl from '../../assets/rpg/head_female.glb?url';
import headMaleUrl from '../../assets/rpg/head_male.glb?url';
import malePeasantUrl from '../../assets/rpg/male_peasant.glb?url';
import maleRangerUrl from '../../assets/rpg/male_ranger.glb?url';

const PARTS = {
  male_ranger: maleRangerUrl,
  male_peasant: malePeasantUrl,
  female_ranger: femaleRangerUrl,
  female_peasant: femalePeasantUrl,
  body_male: bodyMaleUrl,
  head_male: headMaleUrl,
  head_female: headFemaleUrl,
  hair_simpleparted: hairSimplePartedUrl,
  hair_buzzed: hairBuzzedUrl,
  hair_beard: hairBeardUrl,
  hair_long: hairLongUrl,
  hair_buns: hairBunsUrl,
  hair_buzzedfemale: hairBuzzedFemaleUrl,
};
export type Part = keyof typeof PARTS;
export type Outfit = 'male_ranger' | 'male_peasant' | 'female_ranger' | 'female_peasant' | 'body_male';

/** The clips `scripts/rpg-characters.mjs` keeps. */
export type Clip =
  | 'Idle_Loop'
  | 'Idle_Talking_Loop'
  | 'Walk_Loop'
  | 'Jog_Fwd_Loop'
  | 'Sword_Idle'
  | 'Sword_Attack'
  | 'Punch_Jab'
  | 'Hit_Chest'
  | 'Death01';

export interface Look {
  outfit: Outfit;
  /** Worn on the outfit's skeleton; an outfit with a hood brings its own head covering. */
  head?: 'head_male' | 'head_female';
  hair?: Part[];
  hairColor?: number;
  /** Multiplied into the outfit's cloth, so a quest's "green cloak" still reads as green. */
  tint?: number;
  /** How much of `tint` to take: 0 keeps the texture as it is, 1 multiplies the colour in fully. */
  tintAmount?: number;
  /** Metres, feet to crown. */
  height?: number;
}

/** Hair colours a villager is drawn from: fair, brown, dark, red, grey. */
export const HAIR_COLORS = [0xd8b77a, 0x6b4a2e, 0x2b2420, 0x9a4a24, 0xb8b4ac];

/** One dressed character: its animations, and the bone a sword goes in. */
export class Rig {
  readonly mixer: THREE.AnimationMixer;
  readonly hand: THREE.Object3D | null;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private loop: Clip | null = null;

  constructor(
    readonly model: THREE.Object3D,
    private clips: Map<string, THREE.AnimationClip>,
  ) {
    this.mixer = new THREE.AnimationMixer(model);
    this.hand = model.getObjectByName('hand_r') ?? null;
    this.mixer.addEventListener('finished', (e) => {
      // A one-off (a swing, a flinch) hands back to whatever was looping.
      if (e.action === this.current && this.loop && e.action.loop === THREE.LoopOnce && !this.dead) {
        this.play(this.loop, { fade: 0.15 });
      }
    });
  }

  private dead = false;

  private action(clip: Clip): THREE.AnimationAction | null {
    let a = this.actions.get(clip);
    if (!a) {
      const c = this.clips.get(clip);
      if (!c) return null;
      a = this.mixer.clipAction(c);
      this.actions.set(clip, a);
    }
    return a;
  }

  /** Crossfades to a looping clip; the same clip again only changes its speed. */
  play(clip: Clip, { fade = 0.25, speed = 1 }: { fade?: number; speed?: number } = {}) {
    if (this.dead) return;
    this.loop = clip;
    const next = this.action(clip);
    if (!next) return;
    // A one-off still playing finishes first; the 'finished' handler then picks this up.
    if (this.current && this.current !== next && this.current.loop === THREE.LoopOnce && this.current.isRunning()) return;
    next.timeScale = speed;
    if (next === this.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
  }

  /** Plays a clip once over `duration` seconds, then goes back to the loop. */
  once(clip: Clip, duration?: number, { fade = 0.08, final = false } = {}) {
    if (this.dead) return;
    const next = this.action(clip);
    if (!next) return;
    next.reset().setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.timeScale = duration ? next.getClip().duration / duration : 1;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    if (final) this.dead = true;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** Loads the parts once and dresses as many characters as the quest needs from them. */
export class Characters {
  private parts = new Map<Part, GLTF>();
  private clips = new Map<string, THREE.AnimationClip>();
  private heights = new Map<Outfit, number>();
  readonly ready: Promise<void>;

  constructor() {
    const loader = new GLTFLoader();
    this.ready = (async () => {
      const [anim, ...parts] = await Promise.all([
        loader.loadAsync(animationsUrl),
        ...Object.values(PARTS).map((url) => loader.loadAsync(url)),
      ]);
      for (const clip of anim.animations) this.clips.set(clip.name, clip);
      Object.keys(PARTS).forEach((name, i) => this.parts.set(name as Part, parts[i]));
    })();
  }

  /** Builds a person into `group` (emptied first) and returns how to move them. */
  dress(group: THREE.Group, look: Look): Rig {
    const body = SkeletonUtils.clone(this.parts.get(look.outfit)!.scene);
    const bones = new Map<string, THREE.Bone>();
    body.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });

    const tint = look.tint !== undefined ? new THREE.Color(0xffffff).lerp(new THREE.Color(look.tint), look.tintAmount ?? 0.5) : null;
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      // The outfits are textured as metal-on-cloth; with no environment map to reflect, metal
      // renders as black. Rough cloth everywhere reads better than black buckles.
      mat.metalness = Math.min(mat.metalness, 0.3);
      // The skin materials are MI_Regular_* and MI_Superhero_*; only the clothes take the tint.
      if (tint && !/Regular|Hair|Eyes/.test(mat.name)) mat.color.multiply(tint);
      mesh.material = mat;
    });

    for (const part of [look.head, ...(look.hair ?? [])]) {
      if (!part) continue;
      const piece = SkeletonUtils.clone(this.parts.get(part)!.scene);
      const meshes: THREE.SkinnedMesh[] = [];
      piece.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
      });
      for (const mesh of meshes) {
        // Onto the outfit's own bones, so one mixer moves the whole person.
        const skeleton = new THREE.Skeleton(
          mesh.skeleton.bones.map((b) => bones.get(b.name) ?? b),
          mesh.skeleton.boneInverses,
        );
        mesh.bind(skeleton, mesh.bindMatrix);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        if (look.hairColor !== undefined && /Hair/.test(mat.name)) mat.color.set(look.hairColor);
        mesh.material = mat;
        body.add(mesh);
      }
    }

    body.scale.setScalar((look.height ?? 1.8) / this.height(look.outfit));
    group.clear();
    group.add(body);
    const rig = new Rig(body, this.clips);
    rig.play('Idle_Loop', { fade: 0 });
    // A crowd that breathes in step looks like a drill; start each somewhere else in the loop.
    rig.update(Math.random() * 2);
    return rig;
  }

  /** The outfit's height in its own units, standing in its bind pose. */
  private height(outfit: Outfit): number {
    let h = this.heights.get(outfit);
    if (!h) {
      const box = new THREE.Box3().setFromObject(this.parts.get(outfit)!.scene);
      h = box.max.y - box.min.y || 1.8;
      this.heights.set(outfit, h);
    }
    return h;
  }
}
