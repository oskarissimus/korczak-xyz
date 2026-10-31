/*
 * The model lab's stage: the people being compared stand in one row on a floor, under one orbiting
 * camera (drag to turn, wheel or pinch to zoom, right-drag or two fingers to move), all playing the
 * same clip from the same moment, so a walk on one is the walk on the other. Each is the game's own
 * template (`components/Rpg/people.ts`), rigged as the game would rig it, and lit the way the game
 * lights a person: no environment map, which is why a model that comes back metallic shows black
 * here exactly as it would in the village.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadLandmarkBytes } from '../../utils/rpg/landmark3d';
import { People, type Body, type PersonTemplate, type Rigger } from '../Rpg/people';

/** How the stage stands a model: rigged by one of the game's two rigs, or `raw`, as the GLB came, still. */
export type StageRig = Rigger | 'raw';

/** What a model weighs, worked out from the loaded template. */
export interface ModelStats {
  triangles: number;
  vertices: number;
  bones: number;
  /** The largest texture's width, px. */
  texture: number | null;
}

export interface StageItem {
  key: string;
  glb: string;
  body: Body;
  height: number;
  label: string;
}

interface Standing {
  item: StageItem;
  rigger: StageRig;
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  helper: THREE.SkeletonHelper;
  /** A dot at every joint, drawn through the body like the helper's lines. */
  joints: THREE.Points | null;
}

const SPACING = 1.3;

/**
 * The "clip" that stands everyone in the pose their skin was bound in, still (owner, 31 Oct 2026:
 * "let me look at the rig inside the character with no animation, since the problems can be there").
 */
export const REST = '__rest';

/** Each stage mesh's own material, and its weights view once asked for (kept off `userData`, which clones copy as JSON). */
const ownMaterial = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const weightMaterials = new WeakMap<THREE.Mesh, THREE.Material>();

/** A colour per bone, far apart for neighbours, for the weights view. */
function boneColour(i: number): THREE.Color {
  return new THREE.Color().setHSL((i * 0.618034) % 1, 0.8, 0.52);
}

/**
 * The mesh painted by its skin weights: each vertex the blend of its bones' colours by weight, so a
 * clean limb is one flat colour, a joint a short gradient, and a stray weight a speck of the wrong one.
 */
function weightMaterial(mesh: THREE.SkinnedMesh): THREE.Material {
  const g = mesh.geometry;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  if (!si || !sw) return mesh.material as THREE.Material;
  const colours = new Float32Array(si.count * 3);
  const palette = mesh.skeleton.bones.map((_, i) => boneColour(i));
  for (let v = 0; v < si.count; v++)
    for (let a = 0; a < 4; a++) {
      const w = sw.getComponent(v, a);
      if (!w) continue;
      const c = palette[si.getComponent(v, a)] ?? new THREE.Color(0x000000);
      colours[v * 3] += c.r * w;
      colours[v * 3 + 1] += c.g * w;
      colours[v * 3 + 2] += c.b * w;
    }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  // Unlit: the colours are the reading, and TRELLIS meshes carry no normals to light them by.
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

export class LabStage {
  readonly people = new People();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private controls: OrbitControls;
  private standing: Standing[] = [];
  private clip = 'Idle_Loop';
  private time = 0;
  private last = performance.now();
  private raf = 0;
  /** Bumped on every `show`, so a slower load from an earlier one is dropped. */
  private token = 0;
  speed = 1;
  playing = true;
  private skeletons = false;
  private lost: () => void;
  private wire = false;
  private xray = false;
  private weights = false;

  /**
   * `onLost`: the browser took the GPU context back, which iOS does when a page holds too much on it;
   * nothing draws again on this canvas, so the caller makes a new stage.
   */
  constructor(
    private canvas: HTMLCanvasElement,
    onLost: () => void = () => {},
  ) {
    canvas.addEventListener('webglcontextlost', this.lost = () => onLost());
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xd9dccf);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f6e, 2.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -1;
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: 0xbfc3b2, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, 0x8f9484, 0xa9ad9d);
    grid.position.y = 0.002;
    this.scene.add(grid);
    this.camera.position.set(1.6, 1.5, 4.2);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.update();
    this.loop();
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Puts `items` in a row, left to right, rigged by `rigger` (Meshy only where `falKey` pays for it
   * or the rig is cached); answers each one's stats, or its error, as it stands.
   */
  async show(
    items: readonly StageItem[],
    rigger: StageRig,
    falKey: string | null,
    onItem: (key: string, result: { stats: ModelStats; ms: number } | { error: string }) => void,
  ): Promise<void> {
    const token = ++this.token;
    const keep = new Map(this.standing.map((s) => [`${s.item.key}|${s.rigger}`, s]));
    const next: Standing[] = [];
    this.people.falKey = falKey;
    await Promise.all(
      items.map(async (item, i) => {
        const id = `${item.key}|${rigger}`;
        let s = keep.get(id);
        if (!s) {
          try {
            const started = performance.now();
            let template: PersonTemplate;
            if (rigger === 'raw') template = await rawTemplate(item.glb, item.height);
            else {
              this.people.rigger = rigger;
              template = await this.people.template(item.glb, item.body, item.height, item.label);
            }
            s = this.stand(item, rigger, template);
            onItem(item.key, { stats: statsOf(template), ms: template.ms || performance.now() - started });
          } catch (err) {
            onItem(item.key, { error: err instanceof Error ? err.message : String(err) });
            return;
          }
        }
        next[i] = s;
      }),
    );
    if (token !== this.token) return;
    for (const s of this.standing)
      if (!next.includes(s)) {
        this.scene.remove(s.group, s.helper);
        release(s);
      }
    this.standing = next.filter(Boolean);
    const n = this.standing.length;
    this.standing.forEach((s, i) => {
      s.group.position.x = (i - (n - 1) / 2) * SPACING;
      if (!s.group.parent) this.scene.add(s.group, s.helper);
      if (s.joints && !s.joints.parent) this.scene.add(s.joints);
    });
    this.play(this.clip);
    this.frame(n);
  }

  private stand(item: StageItem, rigger: StageRig, template: PersonTemplate): Standing {
    const group = new THREE.Group();
    let mixer: THREE.AnimationMixer;
    if (rigger === 'raw') {
      group.add(template.group.clone());
      mixer = new THREE.AnimationMixer(group);
    } else {
      mixer = this.people.dress(group, template).mixer;
      mixer.stopAllAction();
    }
    const helper = new THREE.SkeletonHelper(group);
    helper.visible = this.skeletons;
    const bones = (helper as unknown as { bones: THREE.Bone[] }).bones;
    let joints: THREE.Points | null = null;
    if (bones.length) {
      joints = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(bones.length * 3), 3)),
        new THREE.PointsMaterial({ color: 0xff2d55, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }),
      );
      joints.renderOrder = 999;
      joints.frustumCulled = false;
      joints.visible = this.skeletons;
    }
    const s: Standing = { item, rigger, group, mixer, clips: template.clips, helper, joints };
    this.look(s);
    return s;
  }

  /** Puts the views ticked now (weights, x-ray, wireframe) on one person's meshes. */
  private look(s: Standing) {
    s.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (!ownMaterial.has(m)) ownMaterial.set(m, m.material);
      const own = ownMaterial.get(m)!;
      if (this.weights && m.isSkinnedMesh) {
        if (!weightMaterials.has(m)) weightMaterials.set(m, weightMaterial(m));
        m.material = weightMaterials.get(m)!;
      } else m.material = own;
      for (const mat of [m.material].flat() as THREE.MeshStandardMaterial[]) {
        mat.wireframe = this.wire;
        mat.transparent = this.xray;
        mat.opacity = this.xray ? 0.3 : 1;
        mat.depthWrite = !this.xray;
        mat.needsUpdate = true;
      }
    });
  }

  /** Each joint's dot where its bone is now. */
  private placeJoints(s: Standing) {
    if (!s.joints?.visible) return;
    const bones = (s.helper as unknown as { bones: THREE.Bone[] }).bones;
    const at = s.joints.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    bones.forEach((b, i) => {
      b.getWorldPosition(v);
      at.setXYZ(i, v.x, v.y, v.z);
    });
    at.needsUpdate = true;
  }

  /** Frames a row of `n` people. */
  private frame(n: number) {
    const width = Math.max(1, n) * SPACING;
    const distance = Math.max(4.8, width * 1.7);
    this.controls.target.set(0, 0.95, 0);
    this.camera.position.set(distance * 0.3, 1.4, distance);
    this.controls.update();
  }

  clipNames(): string[] {
    return [...(this.standing.find((s) => s.clips.size)?.clips.keys() ?? [])];
  }

  /** Every person on `clip`, from its start. */
  play(clip: string) {
    this.clip = clip;
    this.time = 0;
    for (const s of this.standing) {
      s.mixer.stopAllAction();
      if (clip === REST) {
        // The bind pose: every bone where the skin was bound to it, so the joints sit as the rig put them.
        s.group.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose();
        });
        continue;
      }
      const c = s.clips.get(clip);
      if (c) s.mixer.clipAction(c).play();
      s.mixer.setTime(0);
    }
  }

  setSkeletons(on: boolean) {
    this.skeletons = on;
    for (const s of this.standing) {
      s.helper.visible = on;
      if (s.joints) s.joints.visible = on;
    }
  }

  setWireframe(on: boolean) {
    this.wire = on;
    for (const s of this.standing) this.look(s);
  }

  /** The body at a third of its opacity, so the skeleton inside it shows (owner, 31 Oct 2026). */
  setXray(on: boolean) {
    this.xray = on;
    for (const s of this.standing) this.look(s);
  }

  /** The body painted by its skin weights, a colour a bone (`weightMaterial`). */
  setWeights(on: boolean) {
    this.weights = on;
    for (const s of this.standing) this.look(s);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.time += dt * this.speed;
      if (this.clip !== REST) for (const s of this.standing) s.mixer.setTime(this.time);
    }
    for (const s of this.standing) this.placeJoints(s);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    for (const s of this.standing) release(s);
    this.controls.dispose();
    this.renderer.dispose();
    // Handed back now rather than when collected: a browser keeps only so many contexts.
    this.renderer.forceContextLoss();
  }
}

/**
 * The model as fal.ai answered it, with no rig and no clip (owner, 30 Oct 2026: "an option in the lab
 * to look at the model alone, without animation"): the GLB's own meshes, stood on the floor at the
 * person's height, facing as it came, its material made non-metallic as the game's are.
 */
async function rawTemplate(url: string, height: number): Promise<PersonTemplate> {
  const gltf = await new GLTFLoader().parseAsync(await loadLandmarkBytes(url), '');
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = height / (size.y || 1);
  model.scale.multiplyScalar(s);
  const centre = box.getCenter(new THREE.Vector3());
  model.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    for (const mat of [m.material].flat()) if (typeof (mat as THREE.MeshStandardMaterial).metalness === 'number') (mat as THREE.MeshStandardMaterial).metalness = 0;
  });
  const group = new THREE.Group();
  group.add(model);
  return { group, clips: new Map(), ms: 0 };
}

/**
 * What a person off the stage holds on the GPU, handed back. The template keeps the data, so they
 * are uploaded again if shown again; without this every model ever looked at stayed on the GPU — a
 * Meshy one is a 2k texture — until a phone took the context back and nothing more was drawn
 * (owner, 30 Oct 2026: "after looking at a few models I have to reload, the next ones do not show").
 */
function release(s: Standing) {
  s.helper.dispose();
  s.joints?.removeFromParent();
  s.joints?.geometry.dispose();
  (s.joints?.material as THREE.Material | undefined)?.dispose();
  s.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const all = new Set([m.material, ownMaterial.get(m), weightMaterials.get(m)].flat().filter(Boolean) as THREE.Material[]);
    for (const mat of all) {
      for (const value of Object.values(mat)) if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      mat.dispose();
    }
    if (m.isSkinnedMesh) m.skeleton.dispose();
  });
}

export function statsOf(template: PersonTemplate): ModelStats {
  let triangles = 0;
  let vertices = 0;
  let bones = 0;
  let texture: number | null = null;
  template.group.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    vertices += g.attributes.position.count;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (m.isSkinnedMesh) bones = Math.max(bones, m.skeleton.bones.length);
    for (const mat of [m.material].flat()) {
      const img = (mat as THREE.MeshStandardMaterial).map?.image as { width?: number } | undefined;
      if (img?.width) texture = Math.max(texture ?? 0, img.width);
    }
  });
  return { triangles: Math.round(triangles), vertices, bones, texture };
}
