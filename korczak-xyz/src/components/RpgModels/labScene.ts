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

import { People, type Body, type PersonTemplate, type Rigger } from '../Rpg/people';

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
  rigger: Rigger;
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  helper: THREE.SkeletonHelper;
}

const SPACING = 1.3;

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
  private wire = false;

  constructor(private canvas: HTMLCanvasElement) {
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
    rigger: Rigger,
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
            this.people.rigger = rigger;
            const started = performance.now();
            const template = await this.people.template(item.glb, item.body, item.height, item.label);
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
    for (const s of this.standing) if (!next.includes(s)) this.scene.remove(s.group, s.helper);
    this.standing = next.filter(Boolean);
    const n = this.standing.length;
    this.standing.forEach((s, i) => {
      s.group.position.x = (i - (n - 1) / 2) * SPACING;
      if (!s.group.parent) this.scene.add(s.group, s.helper);
    });
    this.play(this.clip);
    this.frame(n);
  }

  private stand(item: StageItem, rigger: Rigger, template: PersonTemplate): Standing {
    const group = new THREE.Group();
    const rig = this.people.dress(group, template);
    rig.mixer.stopAllAction();
    const helper = new THREE.SkeletonHelper(group);
    helper.visible = this.skeletons;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const mat of [m.material].flat()) (mat as THREE.MeshStandardMaterial).wireframe = this.wire;
    });
    return { item, rigger, group, mixer: rig.mixer, clips: template.clips, helper };
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
    return [...(this.standing[0]?.clips.keys() ?? [])];
  }

  /** Every person on `clip`, from its start. */
  play(clip: string) {
    this.clip = clip;
    this.time = 0;
    for (const s of this.standing) {
      s.mixer.stopAllAction();
      const c = s.clips.get(clip);
      if (c) s.mixer.clipAction(c).play();
      s.mixer.setTime(0);
    }
  }

  setSkeletons(on: boolean) {
    this.skeletons = on;
    for (const s of this.standing) s.helper.visible = on;
  }

  setWireframe(on: boolean) {
    this.wire = on;
    for (const s of this.standing)
      s.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) for (const mat of [m.material].flat()) (mat as THREE.MeshStandardMaterial).wireframe = on;
      });
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.playing) {
      this.time += dt * this.speed;
      for (const s of this.standing) s.mixer.setTime(this.time);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
  }
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
