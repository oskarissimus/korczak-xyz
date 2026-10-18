/*
 * The RPG's world: one village, a hunter, the places the open quest has sent him to — each built
 * from the model's description when a beat names it (`placeBuilder.ts`) and standing until the
 * quest ends — and the quest's characters, in the village square or at their places. Plain Three.js, no assets — every mesh is a
 * primitive, so the page loads nothing but code.
 *
 * The React side (`Rpg.tsx`) owns the story; this file owns space and time and talks back only
 * through `SceneCallbacks`. It never decides what a quest says, only where its things are and
 * whether they have been picked up or killed.
 */

import * as THREE from 'three';
import { placePosition, type PlaceSpec, type TargetLook } from '../../utils/rpg/place';
import type { ObjectiveKind } from '../../utils/rpg/quest';
import {
  PLACE_RADIUS,
  buildEnemy,
  buildItem,
  buildPlace,
  hashString,
  rng,
  type Obstacle,
} from './placeBuilder';

export type Prompt = 'talk' | 'pickup' | 'examine';

export interface SceneCallbacks {
  /** A hint for what E would do here, or null when nothing is in reach. */
  onPrompt: (prompt: Prompt | null) => void;
  /** E beside a character: which one, by name. */
  onTalk: (name: string) => void;
  /** E beside a clue: which one, by id. */
  onExamine: (id: string) => void;
  /** One more thing collected or killed. */
  onProgress: () => void;
  onHealth: (hp: number) => void;
  onDeath: () => void;
  /** Where the current marker is, relative to where the camera looks: radians, and metres. */
  onCompass: (angle: number | null, distance: number) => void;
  onLockChange: (locked: boolean) => void;
  /** The hunter has walked into one of the quest's places, once per place. */
  onArrive: (name: string) => void;
}

/** Where characters stand in the village, in the order they first appear there. */
const VILLAGE_SPOTS = [
  new THREE.Vector3(4, 0, -4),
  new THREE.Vector3(-5, 0, 3),
  new THREE.Vector3(6, 0, 5),
  new THREE.Vector3(-4, 0, -9),
  new THREE.Vector3(9, 0, -1),
];
const SPAWN = new THREE.Vector3(0, 0, 8);
const WORLD_HALF = 115;
const WALK = 6;
const RUN = 12;
const TALK_RANGE = 3.2;
const PICKUP_RANGE = 2.2;
const ATTACK_RANGE = 3;
const ATTACK_COOLDOWN = 0.55;
const MAX_HP = 100;

interface Tree {
  meshes: THREE.Mesh[];
  obstacle: Obstacle;
}

interface Enemy {
  mesh: THREE.Group;
  /** The look's size, so a hit's flash can grow it from there. */
  size: number;
  hp: number;
  home: THREE.Vector3;
  hitCooldown: number;
  flash: number;
}

interface Pickup {
  mesh: THREE.Object3D;
  phase: number;
}

interface Npc {
  group: THREE.Group;
  obstacle: Obstacle;
  /** The village spot it holds, if it stands in the village. */
  spot: number | null;
}

interface Place {
  spec: PlaceSpec;
  group: THREE.Group;
  path: THREE.Mesh;
  obstacles: Obstacle[];
  center: THREE.Vector3;
  arrived: boolean;
}

export type MarkerTarget = { npc: string } | { place: string } | null;

/** How far (x, z) is from the path running from the village square to (px, pz). */
function nearSegment(x: number, z: number, px: number, pz: number): number {
  const t = Math.max(0, Math.min(1, (x * px + z * pz) / (px * px + pz * pz)));
  return Math.hypot(x - px * t, z - pz * t);
}

function humanoid(body: number, head: number, height = 1.8): THREE.Group {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, height - 1.05, 4, 10),
    new THREE.MeshStandardMaterial({ color: body, roughness: 0.8 }),
  );
  torso.position.y = (height - 0.35) / 2;
  torso.castShadow = true;
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: head, roughness: 0.7 }),
  );
  skull.position.y = height - 0.12;
  skull.castShadow = true;
  group.add(torso, skull);
  return group;
}

export class RpgScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
  private clock = new THREE.Clock();
  private frame = 0;
  private canvas: HTMLCanvasElement;
  private cb: SceneCallbacks;

  private player: THREE.Group;
  private sword: THREE.Mesh;
  private npcs = new Map<string, Npc>();
  private marker: THREE.Mesh;
  private yaw = 0;
  private pitch = 0.25;
  private keys = new Set<string>();
  private obstacles: Obstacle[] = [];
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private markerTarget: THREE.Vector3 | null = null;
  private hp = MAX_HP;
  private attackTimer = 0;
  private swing = 0;
  private paused = false;
  private lastPrompt: Prompt | null = null;
  /** Things to examine, by id, with a glint so they can be found. */
  private clues = new Map<string, THREE.Object3D>();
  private compassTimer = 0;
  private trees: Tree[] = [];
  /** The open quest's places, by name: meshes, obstacles, the path to each, and where it is. */
  private places = new Map<string, Place>();
  /** The character the marker points at, for `teleport('npc')`. */
  private markerNpc: string | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x9fb8c8);
    this.scene.fog = new THREE.Fog(0x9fb8c8, 40, 170);

    this.buildLight();
    this.buildWorld();

    this.player = humanoid(0x3b3b46, 0xe0c2a2);
    this.sword = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.8, roughness: 0.25 }),
    );
    this.sword.position.set(0.45, 1.05, 0.45);
    this.sword.castShadow = true;
    this.player.add(this.sword);
    this.player.position.copy(SPAWN);
    this.scene.add(this.player);

    this.marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.bindInput();
  }

  // --- the world --------------------------------------------------------------------------------

  private buildLight() {
    this.scene.add(new THREE.HemisphereLight(0xdfe9f3, 0x4a5a3a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -60;
    s.right = 60;
    s.top = 60;
    s.bottom = -60;
    s.far = 200;
    this.scene.add(sun, sun.target);
    // The shadow box follows the player, so the whole map can cast shadows on a modest map size.
    this.sunLight = sun;
  }

  private sunLight!: THREE.DirectionalLight;

  private buildWorld() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40),
      new THREE.MeshStandardMaterial({ color: 0x5f7d3f, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildVillage();
    this.buildTrees();
  }

  private buildVillage() {
    const wall = new THREE.MeshStandardMaterial({ color: 0xcdbb98, roughness: 0.9 });
    const timber = new THREE.MeshStandardMaterial({ color: 0x5b3f26, roughness: 0.9 });
    const thatch = new THREE.MeshStandardMaterial({ color: 0x9c7a3c, roughness: 1 });
    const houses: [number, number, number][] = [
      [-12, -10, 0.3],
      [14, -14, -0.4],
      [-14, 10, 0.2],
      [15, 12, 0.6],
      [-10, -22, 0.1],
    ];
    for (const [x, z, rot] of houses) {
      const house = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 5), wall);
      base.position.y = 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.3, 5.2), timber);
      beam.position.y = 4;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.4, 3.5, 4), thatch);
      roof.position.y = 5.7;
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.8);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), timber);
      door.position.set(0, 1.1, 2.55);
      for (const m of [base, beam, roof, door]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      house.add(base, beam, roof, door);
      house.position.set(x, 0, z);
      house.rotation.y = rot;
      this.scene.add(house);
      this.obstacles.push({ x, z, r: 4.3 });
    }

    // A well in the square, the NPC beside it.
    const stone = new THREE.MeshStandardMaterial({ color: 0x8c8c86, roughness: 1 });
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1, 14, 1, true), stone);
    well.position.set(0, 0.5, -3);
    well.castShadow = true;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 14),
      new THREE.MeshStandardMaterial({ color: 0x1f3a4a }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.6, -3);
    this.scene.add(well, water);
    this.obstacles.push({ x: 0, z: -3, r: 1.5 });

    // A fence ring around the village, open toward each of the eight directions a quest may name.
    const post = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const toGap = a % (Math.PI / 4);
      if (Math.min(toGap, Math.PI / 4 - toGap) < 0.1) continue;
      const p = new THREE.Mesh(post, timber);
      p.position.set(Math.sin(a) * 28, 0.6, Math.cos(a) * 28);
      p.castShadow = true;
      this.scene.add(p);
    }
  }

  private tree(x: number, z: number, scale: number) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25 * scale, 0.35 * scale, 2 * scale, 6),
      this.trunkMat,
    );
    trunk.position.set(x, scale, z);
    trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.8 * scale, 5 * scale, 7), this.leafMat);
    crown.position.set(x, 2 * scale + 2.2 * scale, z);
    crown.castShadow = true;
    this.scene.add(trunk, crown);
    const obstacle = { x, z, r: 0.5 * scale };
    this.obstacles.push(obstacle);
    this.trees.push({ meshes: [trunk, crown], obstacle });
  }

  private trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d3420, roughness: 1 });
  private leafMat = new THREE.MeshStandardMaterial({ color: 0x2f4f2a, roughness: 1 });

  /** Trees across the whole map, kept off the village. A place clears its own patch of them. */
  private buildTrees() {
    const rand = rng(42);
    for (let i = 0; i < 260; i++) {
      const x = (rand() - 0.5) * WORLD_HALF * 2;
      const z = (rand() - 0.5) * WORLD_HALF * 2;
      if (Math.hypot(x, z) < 32) continue;
      this.tree(x, z, 0.7 + rand() * 0.9);
    }
  }

  /**
   * Builds a place where its direction and distance put it, with a dirt path from the village,
   * clearing the scattered trees that stand on either. A place already standing under that name is
   * left as it is: a beat that returns somewhere returns to the same place.
   */
  addPlace(spec: PlaceSpec) {
    if (this.places.has(spec.name)) return;
    const { x, z } = placePosition(spec);
    const center = new THREE.Vector3(x, 0, z);
    for (const tree of this.trees) {
      const { x: tx, z: tz } = tree.obstacle;
      const inPlace = Math.hypot(tx - x, tz - z) < PLACE_RADIUS + 3;
      if (inPlace || nearSegment(tx, tz, x, z) < 4) {
        tree.obstacle.off = true;
        for (const m of tree.meshes) m.visible = false;
      }
    }

    const built = buildPlace(spec);
    built.group.position.copy(center);
    this.scene.add(built.group);
    const obstacles = built.obstacles.map((o) => ({ ...o, x: o.x + x, z: o.z + z }));

    const length = Math.max(1, center.length() - PLACE_RADIUS);
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(3, length),
      new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 1 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = Math.atan2(-x, -z);
    const mid = center.clone().setLength(length / 2);
    path.position.set(mid.x, 0.01, mid.z);
    path.receiveShadow = true;
    this.scene.add(path);

    this.places.set(spec.name, { spec, group: built.group, path, obstacles, center, arrived: false });
  }

  /** Takes down every place, for a new quest; the trees they cleared grow back. */
  clearPlaces() {
    for (const place of this.places.values()) {
      this.scene.remove(place.group, place.path);
      place.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
    }
    this.places.clear();
    for (const tree of this.trees) {
      tree.obstacle.off = false;
      for (const m of tree.meshes) m.visible = true;
    }
  }

  // --- the quest's characters -------------------------------------------------------------------

  /**
   * Puts a character at a place (by name) or, with null, on a free spot in the village square;
   * one already standing somewhere walks over. Their clothes are `color`.
   */
  placeNpc(name: string, color: string, at: string | null, nth = 0) {
    let npc = this.npcs.get(name);
    if (!npc) {
      const group = humanoid(new THREE.Color(color).getHex(), 0xd9b38c, 1.75);
      const obstacle: Obstacle = { x: 0, z: 0, r: 0.6 };
      this.obstacles.push(obstacle);
      this.scene.add(group);
      npc = { group, obstacle, spot: null };
      this.npcs.set(name, npc);
    }
    const place = at ? this.places.get(at) : undefined;
    let pos: THREE.Vector3;
    if (place) {
      npc.spot = null;
      // On the village side of the place's middle, where the hunter walks in, clear of the targets.
      // A second character stands a little round the middle from the first.
      const toVillage = place.center.clone().negate().setLength(8).applyAxisAngle(new THREE.Vector3(0, 1, 0), nth * 0.8);
      pos = place.center.clone().add(toVillage);
    } else {
      if (npc.spot === null) {
        const used = new Set([...this.npcs.values()].map((n) => n.spot));
        const free = VILLAGE_SPOTS.findIndex((_, i) => !used.has(i));
        npc.spot = free >= 0 ? free : 0;
      }
      pos = VILLAGE_SPOTS[npc.spot].clone();
    }
    npc.group.position.copy(pos);
    npc.obstacle.x = pos.x;
    npc.obstacle.z = pos.z;
  }

  /** Sends every character away, for a new quest. */
  clearNpcs() {
    for (const npc of this.npcs.values()) {
      this.scene.remove(npc.group);
      npc.obstacle.off = true;
    }
    this.obstacles = this.obstacles.filter((o) => !o.off || this.trees.some((t) => t.obstacle === o));
    this.npcs.clear();
  }

  /**
   * Puts something to examine near a character (by name): a few metres off, on the ground, with a
   * slow turn so it catches the eye. Replaces any clue already under that id.
   */
  placeClue(id: string, look: TargetLook, near: string) {
    this.clues.get(id) && this.scene.remove(this.clues.get(id)!);
    const anchor = this.npcs.get(near)?.group.position ?? SPAWN;
    const rand = rng(hashString(id + near));
    const a = rand() * Math.PI * 2;
    const d = 6 + rand() * 3;
    const mesh = buildItem(look);
    mesh.position.set(anchor.x + Math.sin(a) * d, 0.5, anchor.z + Math.cos(a) * d);
    this.scene.add(mesh);
    this.clues.set(id, mesh);
  }

  clearClues() {
    for (const mesh of this.clues.values()) this.scene.remove(mesh);
    this.clues.clear();
  }

  private nearestClue(): string | null {
    let best: string | null = null;
    let bestD = PICKUP_RANGE + 0.5;
    for (const [id, mesh] of this.clues) {
      const d = mesh.position.clone().setY(0).distanceTo(this.player.position);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /**
   * Whatever E would reach, the nearest of a character, a clue and a thing to pick up: with a
   * second character and clues at a place, the first version let a character standing among the
   * herbs swallow every press.
   */
  private nearestThing(): { talk: string } | { examine: string } | { pickup: Pickup } | null {
    const at = this.player.position;
    const options: { d: number; thing: { talk: string } | { examine: string } | { pickup: Pickup } }[] = [];
    const npc = this.nearestNpc();
    if (npc) options.push({ d: this.npcs.get(npc)!.group.position.distanceTo(at), thing: { talk: npc } });
    const clue = this.nearestClue();
    if (clue) options.push({ d: this.clues.get(clue)!.position.clone().setY(0).distanceTo(at), thing: { examine: clue } });
    for (const p of this.pickups) {
      const d = p.mesh.position.clone().setY(0).distanceTo(at);
      if (d < PICKUP_RANGE) options.push({ d, thing: { pickup: p } });
    }
    options.sort((a, b) => a.d - b.d);
    return options[0]?.thing ?? null;
  }

  private nearestNpc(): string | null {
    let best: string | null = null;
    let bestD = TALK_RANGE;
    for (const [name, npc] of this.npcs) {
      const d = npc.group.position.distanceTo(this.player.position);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  // --- the quest's things -----------------------------------------------------------------------

  /** Puts a beat's things in the middle of its place, replacing any left from before. */
  spawnObjective(kind: ObjectiveKind, count: number, look: TargetLook, at: string | null) {
    this.clearObjective();
    const center = (at ? this.places.get(at)?.center : null) ?? SPAWN;
    const rand = rng(Math.floor(Math.random() * 1e6) + 1);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand();
      const d = 3 + rand() * 6;
      const pos = new THREE.Vector3(center.x + Math.sin(a) * d, 0, center.z + Math.cos(a) * d);
      if (kind === 'collect') {
        const mesh = buildItem(look);
        mesh.position.copy(pos).setY(0.8);
        this.scene.add(mesh);
        this.pickups.push({ mesh, phase: rand() * 6 });
      } else {
        const mesh = buildEnemy(look);
        mesh.position.copy(pos);
        this.scene.add(mesh);
        this.enemies.push({ mesh, size: look.size, hp: 3, home: pos.clone(), hitCooldown: 1, flash: 0 });
      }
    }
  }

  clearObjective() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.pickups = [];
    this.enemies = [];
  }

  /** The golden beam the compass points at: a character, a place, or nothing. */
  setMarker(target: MarkerTarget) {
    this.markerNpc = target && 'npc' in target ? target.npc : null;
    this.markerTarget = !target
      ? null
      : 'npc' in target
        ? (this.npcs.get(target.npc)?.group.position.clone() ?? null)
        : (this.places.get(target.place)?.center.clone() ?? null);
    this.marker.visible = this.markerTarget !== null;
    if (this.markerTarget) this.marker.position.set(this.markerTarget.x, 30, this.markerTarget.z);
    else this.cb.onCompass(null, 0);
  }

  /** While a dialogue or a menu is open the world stands still and the mouse is the reader's. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.keys.clear();
    if (paused && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  requestLock() {
    if (this.paused) return;
    // A rejected lock (Safari, an iframe) is not an error worth surfacing: the mouse just will not
    // turn the camera, and Q/E-style keys are not this game's controls.
    const result = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    result?.catch?.(() => {});
  }

  /** For tests and the console: beside the marked character, into the marked place, or home. */
  teleport(where: 'marker' | 'npc' | 'spawn') {
    const npc = this.markerNpc ? this.npcs.get(this.markerNpc) : undefined;
    const p =
      where === 'npc' && npc
        ? npc.group.position.clone().add(new THREE.Vector3(0, 0, 2))
        : where === 'marker' && this.markerTarget
          ? this.markerTarget.clone().add(new THREE.Vector3(0, 0, npc ? 2 : 0))
          : SPAWN;
    this.player.position.set(p.x, 0, p.z);
  }

  /** For tests: beside a clue. */
  teleportToClue(id: string) {
    const mesh = this.clues.get(id);
    if (mesh) this.player.position.set(mesh.position.x + 1, 0, mesh.position.z);
  }

  /** Turns the hunter and the camera toward the marker. */
  facePosition() {
    if (!this.markerTarget) return;
    const d = this.markerTarget.clone().sub(this.player.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.player.rotation.y = Math.atan2(d.x, d.z);
  }

  /** Swings the sword now, as a click would. */
  attack() {
    if (this.paused || this.attackTimer > 0) return;
    this.attackTimer = ATTACK_COOLDOWN;
    this.swing = 1;
    const forward = new THREE.Vector3(Math.sin(this.player.rotation.y), 0, Math.cos(this.player.rotation.y));
    for (const enemy of [...this.enemies]) {
      const to = enemy.mesh.position.clone().sub(this.player.position);
      const dist = to.length();
      if (dist > ATTACK_RANGE) continue;
      // A wide arc in front, so a swing does not need perfect aim with a mouse.
      if (dist > 0.8 && to.normalize().dot(forward) < 0.2) continue;
      enemy.hp -= 1;
      enemy.flash = 0.15;
      enemy.mesh.position.add(to.multiplyScalar(1.2));
      if (enemy.hp <= 0) {
        this.scene.remove(enemy.mesh);
        this.enemies = this.enemies.filter((e) => e !== enemy);
        this.cb.onProgress();
      }
    }
  }

  interact() {
    if (this.paused) return;
    const thing = this.nearestThing();
    if (!thing) return;
    if ('talk' in thing) {
      this.cb.onTalk(thing.talk);
      return;
    }
    if ('examine' in thing) {
      this.cb.onExamine(thing.examine);
      return;
    }
    const near = thing.pickup;
    this.scene.remove(near.mesh);
    this.pickups = this.pickups.filter((p) => p !== near);
    this.cb.onProgress();
  }

  heal() {
    this.hp = MAX_HP;
    this.cb.onHealth(this.hp);
  }

  // --- input ------------------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
      e.preventDefault();
    }
    if (code === 'KeyE' || code === 'KeyF') this.interact();
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    // Chromium sends one jump as the lock engages (the cursor's leap to the centre), which turned
    // the camera by a random quarter turn on Start. No hand moves a mouse that far in one event.
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
    this.yaw -= e.movementX * 0.0025;
    this.pitch = Math.min(1.1, Math.max(-0.35, this.pitch + e.movementY * 0.002));
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.paused || e.button !== 0) return;
    if (document.pointerLockElement !== this.canvas) {
      this.requestLock();
      return;
    }
    this.attack();
  };

  private onLock = () => this.cb.onLockChange(document.pointerLockElement === this.canvas);
  private onBlur = () => this.keys.clear();

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLock);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
  }

  // --- the loop ---------------------------------------------------------------------------------

  start() {
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (!this.paused) this.update(dt);
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
    };
    this.clock.start();
    tick();
  }

  private collide(pos: THREE.Vector3, radius = 0.45) {
    const all = [this.obstacles, ...[...this.places.values()].map((p) => p.obstacles)];
    for (const o of all.flat()) {
      if (o.off) continue;
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (d < min && d > 0.0001) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
    pos.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, pos.x));
    pos.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, pos.z));
  }

  private update(dt: number) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const moving = fwd !== 0 || side !== 0;
    if (moving) {
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
      // Camera-relative: W walks away from the camera, whatever way the hunter was facing.
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const dir = forward.multiplyScalar(fwd).add(right.multiplyScalar(side)).normalize();
      this.player.position.addScaledVector(dir, speed * dt);
      this.collide(this.player.position);
      const targetRot = Math.atan2(dir.x, dir.z);
      const diff = Math.atan2(Math.sin(targetRot - this.player.rotation.y), Math.cos(targetRot - this.player.rotation.y));
      this.player.rotation.y += diff * Math.min(1, dt * 12);
    }
    // A little bob while walking, so it reads as walking and not as sliding.
    const t = this.clock.elapsedTime;
    this.player.children[0].position.y = 0.725 + (moving ? Math.abs(Math.sin(t * 10)) * 0.06 : 0);

    // The sword: a quick arc on a swing, at rest otherwise.
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.swing = Math.max(0, this.swing - dt * 4);
    this.sword.rotation.y = this.swing > 0 ? Math.sin(this.swing * Math.PI) * 1.8 - 0.6 : 0;

    for (const mesh of this.clues.values()) mesh.rotation.y += dt * 0.8;
    for (const p of this.pickups) {
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.8 + Math.sin(t * 2 + p.phase) * 0.15;
    }

    this.updateEnemies(dt);
    for (const npc of this.npcs.values()) {
      if (npc.group.position.distanceTo(this.player.position) < 12) {
        npc.group.lookAt(this.player.position.x, 0, this.player.position.z);
      }
    }

    for (const place of this.places.values()) {
      if (!place.arrived && this.player.position.distanceTo(place.center) < PLACE_RADIUS) {
        place.arrived = true;
        this.cb.onArrive(place.spec.name);
      }
    }

    const thing = this.nearestThing();
    const prompt: Prompt | null = !thing ? null : 'talk' in thing ? 'talk' : 'examine' in thing ? 'examine' : 'pickup';
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.cb.onPrompt(prompt);
    }

    this.sunLight.position.set(this.player.position.x + 40, 70, this.player.position.z + 25);
    this.sunLight.target.position.copy(this.player.position);

    this.compassTimer -= dt;
    if (this.compassTimer <= 0) {
      this.compassTimer = 0.1;
      if (this.markerTarget) {
        const d = this.markerTarget.clone().sub(this.player.position).setY(0);
        const bearing = Math.atan2(-d.x, -d.z);
        const angle = Math.atan2(Math.sin(bearing - this.yaw), Math.cos(bearing - this.yaw));
        this.cb.onCompass(-angle, d.length());
      } else {
        this.cb.onCompass(null, 0);
      }
    }
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.enemies) {
      const pos = enemy.mesh.position;
      const toPlayer = this.player.position.clone().sub(pos).setY(0);
      const dist = toPlayer.length();
      enemy.hitCooldown = Math.max(0, enemy.hitCooldown - dt);
      if (dist < 14 && dist > 1.2) {
        pos.addScaledVector(toPlayer.normalize(), 3.2 * dt);
      } else if (dist >= 14) {
        const home = enemy.home.clone().sub(pos).setY(0);
        if (home.length() > 0.5) pos.addScaledVector(home.normalize(), 2 * dt);
      }
      this.collide(pos, 0.4);
      enemy.mesh.lookAt(this.player.position.x, 0, this.player.position.z);
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.mesh.scale.setScalar(enemy.size * (enemy.flash > 0 ? 1.12 : 1));
      if (dist <= 1.5 && enemy.hitCooldown === 0) {
        enemy.hitCooldown = 1.2;
        this.hp = Math.max(0, this.hp - 12);
        this.cb.onHealth(this.hp);
        if (this.hp === 0) {
          this.player.position.copy(SPAWN);
          this.hp = MAX_HP;
          this.cb.onDeath();
          this.cb.onHealth(this.hp);
        }
      }
    }
    // Slow regeneration out of combat.
    if (this.hp < MAX_HP && this.enemies.every((e) => e.hitCooldown === 0 || e.mesh.position.distanceTo(this.player.position) > 6)) {
      const before = Math.floor(this.hp);
      this.hp = Math.min(MAX_HP, this.hp + dt * 4);
      if (Math.floor(this.hp) !== before) this.cb.onHealth(Math.floor(this.hp));
    }
  }

  private updateCamera() {
    const distance = 6.5;
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1.7, 0));
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(distance);
    this.camera.position.copy(target).add(offset);
    if (this.camera.position.y < 0.4) this.camera.position.y = 0.4;
    this.camera.lookAt(target);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
