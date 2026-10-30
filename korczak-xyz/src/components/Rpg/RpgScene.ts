/*
 * The RPG's world: one village, a hunter, the places the open quest has sent him to — each built
 * from the model's description when a beat names it (`placeBuilder.ts`) and standing until the
 * quest ends — and the quest's characters, in the village square or at their places. The people
 * are rigged, animated CC0 models (`characters.ts`) and the surfaces scanned CC0 textures
 * (`surfaces.ts`); the shapes of the world are still Three.js primitives.
 *
 * The React side (`Rpg.tsx`) owns the story; this file owns space and time and talks back only
 * through `SceneCallbacks`. It never decides what a quest says, only where its things are and
 * whether they have been picked up or killed.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANDMARK_REACH, placePosition, type PlaceSpec, type TargetLook } from '../../utils/rpg/place';
import type { ObjectiveKind } from '../../utils/rpg/quest';
import {
  PLACE_RADIUS,
  buildEnemy,
  buildItem,
  buildPlace,
  forestTree,
  hashString,
  rng,
  type Obstacle,
} from './placeBuilder';
import { Characters, HAIR_COLORS, type Look, type Part, type Rig } from './characters';
import { People, PERSON_HEIGHT, type Body, type Rigger } from './people';
import { breakTiling, cutOut, seamless, surfaceMat } from './surfaces';
import { disposeHubModel, disposeTreeParts, FOREST_FIT, hubFit, loadForestTree, loadHubModel, type TreePart } from './hubModels';
import type { Spinner } from './landmark';
import { DEAD_TREES, GROUND_COVER, HOUSE_RADIUS, TREES, WorldKit, mergeStatic, type HouseKind } from './world';
import { CLASSIC_LOOK, type HubSize, type HubSizes, type WorldLook } from '../../utils/rpg/genesis';
import { HUB_SLOTS, isForestVariant, loadLandmarkBytes, type HubSlot } from '../../utils/rpg/landmark3d';
import { SPAWN_AT, VILLAGE_STANDS, type HubLayout } from '../../utils/rpg/hubLayout';
import { DAYLIGHT, HAZE, recolor, Sky, stars, Weather } from './atmosphere';
import { DEFAULT_QUALITY, FrameRecorder, type FrameStats, type FrameWindow, type Quality } from './frames';
import { SENSES_SECONDS, SensesView, type SenseTarget } from './senses';
import { footprints, nearestOnLine, roadPoints, trailPoints, type Ground } from '../../utils/rpg/trail';
import { HALT, Routine, type Spot, type SpotKind } from '../../utils/rpg/routine';

export type Prompt = 'talk' | 'pickup' | 'examine';

/**
 * Who a person is drawn as: their fal.ai model (`url`, rigged in `people.ts`), nothing at all while it
 * is being made (`wait`), or else Quaternius's kit — only where no model will ever come: the classic
 * world, a reader without a fal.ai key (owner, 28 Oct 2026: "no Quaternius characters; nothing until
 * it is generated, then it is there"), and a model that would not load or rig.
 */
export interface PersonBody {
  url?: string;
  wait?: boolean;
}

/** What a body asks for, as one string to compare: the model's URL, `wait` or `kit`. */
const wanted = (body: PersonBody) => body.url ?? (body.wait ? 'wait' : 'kit');

const HEIGHT = PERSON_HEIGHT;

/** A hero described as a woman stands on the female donor; anyone else on the male one. */
export function heroBody(description: string): Body {
  return /\b(woman|female|girl|lady|she|her|heroine|priestess|witch|queen)\b/i.test(description) ? 'female' : 'male';
}

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
  /** The witcher's senses came on or wore off (`senses.ts`). */
  onSenses?: (on: boolean) => void;
}

/** Where characters stand in the village, in the order they first appear there. */
const VILLAGE_SPOTS = VILLAGE_STANDS.map(({ x, z }) => new THREE.Vector3(x, 0, z));
/** Spot `i` in the square: the five above, then a ring inside the houses for a world that has met many. */
function villageSpot(i: number): THREE.Vector3 {
  if (i < VILLAGE_SPOTS.length) return VILLAGE_SPOTS[i].clone();
  const k = i - VILLAGE_SPOTS.length;
  const a = k * 2.39996; // the golden angle, so no two stand in line
  // Inside the houses (their walls start ~11 m out) and outside the well.
  const r = 7 + (k % 3) * 1.2;
  return new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
}
const SPAWN = new THREE.Vector3(SPAWN_AT.x, 0, SPAWN_AT.z);
/** The five houses around the square, and which kit house stands on each plot. */
const HOUSES: [number, number][] = [
  [-12, -10],
  [14, -14],
  [-14, 10],
  [15, 12],
  [-10, -22],
];
const HOUSE_KINDS: HouseKind[] = ['large', 'small', 'large', 'small', 'small'];
// Room for the third ring of places (`distant`, 125 m) and its build: the world grows across
// quests (`.claude/rules/rpg.md`, *The world grows*).
const WORLD_HALF = 160;
/** Ground cover stays on the old square: covering the new one would double its instances on a phone. */
const COVER_HALF = 115;
const WALK = 6;
const RUN = 12;
const TALK_RANGE = 3.2;
/** A character's name shows over their head from this near, a step before E would reach them. */
const NAME_RANGE = 6;
const PICKUP_RANGE = 2.2;
/** A clue's model from fal.ai: something lying on the ground, knee-high at most. */
const CLUE_FIT = { height: 0.8, width: 1.2 };
/** A thing to gather from fal.ai, floating: about the block's size, times the look's own size. */
const ITEM_FIT = { height: 0.7, width: 0.8 };
/** How far out a village piece reaches when its spot says nothing: the kit's stall and cart, barrels, the well. */
const SPOT_SIZE: Partial<Record<SpotKind, number>> = { stall: 1.8, cart: 2.2, goods: 0.8, landmark: 1.6 };
const ATTACK_RANGE = 3;
const ATTACK_COOLDOWN = 0.55;
const MAX_HP = 100;

interface Tree {
  /** The cone and trunk it starts as; hidden for good once the kit's trees stand in. */
  meshes: THREE.Mesh[];
  obstacle: Obstacle;
  /** Its obstacle's radius as planted; a world with no flora walks through where it stood. */
  r: number;
  /** Its slot in the instanced kit trees, once those are up. */
  slot?: { meshes: THREE.InstancedMesh[]; index: number; matrices: THREE.Matrix4[] };
  hidden?: boolean;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/*
 * The scattered trees and the ground cover are instanced, and an instanced mesh is culled as one
 * thing: planted over the whole map, its bounds were the whole map, so every tree and every tuft
 * was drawn in every frame, and again for the shadow, whether it was behind the camera or past the
 * fog (measured Oct 2026: 3 M triangles a frame standing in the village). So each kind is planted
 * once per square of the map, which the camera and the sun's shadow can skip, and a square past
 * the fog is not drawn at all. 48 m, measured: 80 m squares drew a few dozen fewer calls and
 * 400 k more triangles, and 96 m for the grass alone the same trade.
 */
const CELL = 48;

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}

/** A square's meshes, and where the square is. */
interface Cell {
  meshes: THREE.Object3D[];
  x: number;
  z: number;
  /** From the centre to the farthest thing in it. */
  r: number;
}

function cellOf(meshes: THREE.Object3D[], at: { x: number; z: number }[]): Cell {
  const x = at.reduce((a, p) => a + p.x, 0) / at.length;
  const z = at.reduce((a, p) => a + p.z, 0) / at.length;
  // Plus a tree's own reach, so a crown at the edge is not cut off a step early.
  const r = Math.max(...at.map((p) => Math.hypot(p.x - x, p.z - z))) + 6;
  return { meshes, x, z, r };
}

/** Shows or hides one of the scattered trees, whichever form it has now. */
function showTree(tree: Tree, visible: boolean) {
  tree.hidden = !visible;
  if (tree.slot) {
    tree.slot.meshes.forEach((m, j) => {
      m.setMatrixAt(tree.slot!.index, visible ? tree.slot!.matrices[j] : ZERO);
      m.instanceMatrix.needsUpdate = true;
    });
  } else {
    for (const m of tree.meshes) m.visible = visible;
  }
}

interface Enemy {
  mesh: THREE.Group;
  /** Set once the people's models have loaded, for a humanoid; the others stay primitives. */
  rig: Rig | null;
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
  rig: Rig | null;
  /** Their clothes, for the capsule they become if the models never load. */
  color: number;
  /** The same, as the quest wrote it, for the kit's look (`lookFor`). */
  css: string;
  gender: 'male' | 'female';
  /** What they are drawn as (`wanted`), and a count that makes an older load's arrival stale. */
  want: string;
  token: number;
  obstacle: Obstacle;
  /** The village spot it holds, if it stands in the village. */
  spot: number | null;
  /** What they do with themselves between talks (`utils/rpg/routine.ts`): where they walk, what they work at. */
  routine: Routine;
}

interface Place {
  spec: PlaceSpec;
  group: THREE.Group;
  path: THREE.Mesh;
  /** The road's middle line, village first (`utils/rpg/trail.ts`), which the senses' trail follows. */
  road: Ground[];
  obstacles: Obstacle[];
  center: THREE.Vector3;
  arrived: boolean;
  spinners: Spinner[];
  /** The landmark's ground, in world coordinates. */
  keepOut: { x: number; z: number; r: number } | null;
  /** Built bare, for an invented world: everything in it is the world's trees and fal.ai's pieces. */
  bare?: {
    treeSpots: { x: number; z: number; s: number; r: number }[];
    trees: THREE.Group;
    treeObstacles: Obstacle[];
    /** Each piece's spots (place coordinates) and the obstacles they become once it stands. */
    pieces: Map<number, { spots: { x: number; z: number; rot: number }[]; obstacles: Obstacle[] }>;
  };
}

export type MarkerTarget = { npc: string } | { place: string } | null;

/** A strip of ground `width` wide along a line, its texture running down it a tile every 3 m. */
function ribbon(line: Ground[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  let along = 0;
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    if (i > 0) along += Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
    pos.push(line[i].x + nx, 0, line[i].z + nz, line[i].x - nx, 0, line[i].z - nz);
    uv.push(0, along / 3, 1, along / 3);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** What a character looks like, drawn from their name so they look the same every time. */
function lookFor(name: string, color: string, gender: 'male' | 'female'): Look {
  const rand = rng(hashString(name));
  const ranger = rand() < 0.3;
  const hairColor = HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)];
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  if (gender === 'female') {
    return {
      outfit: ranger ? 'female_ranger' : 'female_peasant',
      head: 'head_female',
      // A ranger's hood is up; hair would come through it.
      hair: ranger ? [] : [pick<Part>(['hair_long', 'hair_buns', 'hair_buzzedfemale'])],
      hairColor,
      tint: new THREE.Color(color).getHex(),
      tintAmount: 0.55,
      height: 1.68,
    };
  }
  const hair: Part[] = ranger ? [] : [pick<Part>(['hair_simpleparted', 'hair_buzzed', 'hair_long'])];
  if (rand() < 0.45) hair.push('hair_beard');
  return {
    outfit: ranger ? 'male_ranger' : 'male_peasant',
    head: 'head_male',
    hair,
    hairColor,
    tint: new THREE.Color(color).getHex(),
    tintAmount: 0.55,
    height: 1.78,
  };
}

/** The pill people, for when the models cannot be loaded: a capsule and a ball. */
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

/** A body's want that is a model's URL, not nobody, a wait or the kit. */
const isModel = (want: string) => want !== 'none' && want !== 'wait' && want !== 'kit';

export class RpgScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
  private clock = new THREE.Clock();
  private frame = 0;
  private frames = new FrameRecorder();
  private quality: Quality = DEFAULT_QUALITY;
  private canvas: HTMLCanvasElement;
  private cb: SceneCallbacks;

  private player: THREE.Group;
  private sword: THREE.Mesh;
  private chars = new Characters();
  private people = new People();
  private kit = new WorldKit();
  /** The primitive houses, taken down when the kit's are put up. */
  private stopgapHouses: THREE.Group[] = [];
  private houseObstacles: Obstacle[] = [];
  /** Null until the models load, and for good if they fail (the hunter is then a capsule). */
  private playerRig: Rig | null = null;
  /** Killed humanoids playing their death before they are taken away, seconds left. */
  private dying: { mesh: THREE.Group; rig: Rig; left: number }[] = [];
  private npcs = new Map<string, Npc>();
  private marker: THREE.Mesh;
  private yaw = 0;
  private pitch = 0.25;
  private keys = new Set<string>();
  /**
   * The touch controls (`TouchControls.tsx`): the stick's position, -1..1 each way with y down, and
   * the finger dragging the view. A phone has no keys, no mouse and no pointer lock.
   */
  private stick = { x: 0, y: 0 };
  private lookTouch: { id: number; x: number; y: number } | null = null;
  private obstacles: Obstacle[] = [];
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private markerTarget: THREE.Vector3 | null = null;
  private hp = MAX_HP;
  private attackTimer = 0;
  private swing = 0;
  private paused = false;
  private lastPrompt: Prompt | null = null;
  /**
   * The name over the nearest character's head: one element over the canvas, moved every frame
   * after the camera, so it follows whoever walks. HTML rather than a sprite, for text a phone draws sharp.
   */
  private nameTag: HTMLDivElement;
  private nameTagFor: string | null = null;
  /** Things to examine, by id, with a glint so they can be found. */
  private clues = new Map<string, THREE.Object3D>();
  private compassTimer = 0;
  private trees: Tree[] = [];
  /** The open quest's places, by name: meshes, obstacles, the path to each, and where it is. */
  private places = new Map<string, Place>();
  /** The character the marker points at, for `teleport('npc')`. */
  private markerNpc: string | null = null;
  /** The witcher's senses: what they draw, how long they have left, and when the trail is next laid. */
  private senses: SensesView;
  private sensesLeft = 0;
  private trailTimer = 0;
  private senseTargets: SenseTarget[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.cb = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x9fb8c8);
    this.scene.fog = new THREE.Fog(0x9fb8c8, 40, 170);
    this.scene.add(this.sky.mesh);
    this.sky.set(this.look, this.sunOffset);

    this.buildLight();
    this.buildWorld();

    this.player = new THREE.Group();
    this.sword = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.08, 1.1),
      // Polished steel would need something to reflect; there is no environment map, so it reads as
      // pale grey rather than as the black that full metalness renders.
      new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.35, roughness: 0.3 }),
    );
    this.sword.castShadow = true;
    this.player.position.copy(SPAWN);
    this.scene.add(this.player);
    // Nobody until the game says who the hero is (`setHero`): a generated hero must not have the kit's flash up first.

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
    this.senses = new SensesView(this.scene);

    this.nameTag = document.createElement('div');
    this.nameTag.className = 'rpg-name-tag';
    this.nameTag.hidden = true;
    canvas.parentElement?.appendChild(this.nameTag);

    this.bindInput();
  }

  // --- the world --------------------------------------------------------------------------------

  private buildLight() {
    this.hemi = new THREE.HemisphereLight(0xdfe9f3, 0x4a5a3a, 0.9);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // Without these the walls wore saw-toothed bands of their own shadow (owner's screenshot).
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
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
  private hemi!: THREE.HemisphereLight;
  /** Where the sun stands from the player: the world's time of day. */
  private sunOffset = new THREE.Vector3(40, 70, 25);

  private buildWorld() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40),
      breakTiling(surfaceMat('ground', 96, 96, { roughness: 1 })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
    this.scene.add(this.kitCover, this.ownCover);
    this.groundScan = (ground.material as THREE.MeshStandardMaterial).map!;

    this.buildVillage();
    this.buildTrees();
    this.kit.ready.then(
      () => this.furnish(),
      () => {},
    );
  }

  /** Once the kit is here: its houses, fence, props, trees and ground cover over the stopgaps. */
  private furnish() {
    // The houses: two large, three small, where the primitive ones stood.
    // One mesh per material (`mergeStatic`), they being built from the same kit; per kind, so a
    // world's own house or hall (`setHubModels`) can stand in for one kind.
    const village = { large: new THREE.Group(), small: new THREE.Group() };
    this.stopgapHouses.forEach((old, i) => {
      const house = this.kit.house(HOUSE_KINDS[i], rng(100 + i));
      house.position.copy(old.position);
      house.rotation.y = old.rotation.y;
      this.scene.remove(old);
      village[HOUSE_KINDS[i]].add(house);
      this.houseBase[i] = HOUSE_RADIUS[HOUSE_KINDS[i]];
    });
    const merged = { large: mergeStatic(village.large), small: mergeStatic(village.small) };
    this.scene.add(merged.large, merged.small);
    this.kitPieces.hall = [merged.large];
    this.kitPieces.house = [merged.small];
    this.stopgapHouses = [];

    // The fence: rails instead of posts, with the same eight gaps.
    for (const post of this.fencePosts) this.scene.remove(post);
    // One instanced mesh per part rather than a mesh per rail: seventy rails were seventy draws, and
    // as many again for the shadow.
    const n = 84;
    const rails: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const toGap = a % (Math.PI / 4);
      if (Math.min(toGap, Math.PI / 4 - toGap) < 0.1) continue;
      // A rail runs along its own x; turned by `a`, x is the ring's tangent there.
      rails.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(a) * 28, 0, Math.cos(a) * 28),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
    for (const part of this.kit.parts('Prop_WoodenFence_Single')) {
      const m = new THREE.InstancedMesh(part.geometry, part.material, rails.length);
      rails.forEach((r, i) => m.setMatrixAt(i, r.clone().multiply(part.matrix)));
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.shared = true;
      m.computeBoundingSphere();
      this.scene.add(m);
      this.classicOnly.push(m);
    }

    // Life in the square: barrels and crates by the houses, a cart, a bench and a bucket by the well.
    // Each kept under the piece of a world's own hub that replaces it (`setHubModels`).
    const place = (name: string, x: number, z: number, rot = 0, slot?: HubSlot) => {
      const p = this.kit.piece(name);
      p.position.set(x, 0, z);
      p.rotation.y = rot;
      this.scene.add(p);
      if (slot) (this.kitPieces[slot] ??= []).push(p);
      else this.classicOnly.push(p);
    };
    place('Barrel', -8.2, -6.4, 0, 'goods');
    place('Barrel', -7.4, -6.9, 1, 'goods');
    place('Crate_Wooden', 10.6, -10.2, 0.4, 'goods');
    place('Crate_Wooden', 11.3, -9.3, 1.2, 'goods');
    place('Barrel', -10.2, 6.8, 0, 'goods');
    place('Stall_Cart_Empty', 9.5, 4.2, -2.2, 'stall');
    place('Prop_Wagon', -18, -2, 0.5, 'cart');
    place('Bench', 3.2, -0.2, 0.15);
    place('Bucket_Wooden_1', 1.5, -1.6, 0, 'landmark');
    const props = [
      { x: 9.5, z: 4.2, r: 1.6 },
      { x: -18, z: -2, r: 2 },
    ];
    this.hubObstacles.push(...props);
    this.classicObstacles.push(...props);
    this.refreshHub();

    this.plantGroundCover();
    // The world's colours, its trees and how much grows: the kit is what they are drawn on.
    this.dressWorld();
  }

  /**
   * The scattered trees: the world's own from fal.ai once they have come (`setForest`), until then
   * its flora (`WorldLook.flora`) — the kit's pines, broadleaf or dead trees, or shapes of the
   * world's own (giant mushrooms, spires) — one instanced mesh per part per kind, hidden ones scaled
   * to 0. Planted again when a world changes it; with no flora at all the trees are gone and so are
   * the obstacles they were.
   */
  private plantTrees() {
    for (const m of this.treeMeshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.treeMeshes = [];
    this.treeCells = [];
    const classic = this.isClassic();
    // Under a world's own layout its trees are its own or none yet: no kit tree stands in for them.
    const flora = this.layout && !this.forest.length ? 'none' : this.look.flora;
    const forest = classic ? [] : this.forest;
    const kinds: readonly string[] | null = forest.length
      ? forest.map((_, i) => `forest${i}`)
      : classic
        ? TREES
        : flora === 'pines'
          ? TREES.slice(0, 3)
          : flora === 'broadleaf'
            ? TREES.slice(3)
            : flora === 'dead'
              ? DEAD_TREES
              : null;
    if (kinds && !forest.length && !this.kit.loaded) return;
    const bare = flora === 'none' && (!classic || this.layout !== null);
    for (const tree of this.trees) {
      for (const m of tree.meshes) this.scene.remove(m);
      tree.slot = undefined;
      tree.obstacle.r = bare ? 0 : tree.r;
    }
    if (bare) return;
    const rand = rng(7);
    const byKind = new Map<string, Tree[]>();
    for (const tree of this.trees) {
      const kind = kinds ? kinds[Math.floor(rand() * kinds.length)] : flora;
      const key = `${kind}|${cellKey(tree.obstacle.x, tree.obstacle.z)}`;
      byKind.set(key, [...(byKind.get(key) ?? []), tree]);
    }
    for (const [key, trees] of byKind) {
      const kind = key.split('|')[0];
      const parts = forest.length ? forest[Number(kind.slice(6))] : kinds ? this.kit.parts(kind) : this.floraParts();
      const meshes = parts.map((part) => {
        const m = new THREE.InstancedMesh(part.geometry, part.material, trees.length);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.shared = true;
        this.scene.add(m);
        this.treeMeshes.push(m);
        return m;
      });
      trees.forEach((tree, i) => {
        const scale = tree.r / 0.5;
        const base = new THREE.Matrix4().compose(
          new THREE.Vector3(tree.obstacle.x, 0, tree.obstacle.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
          new THREE.Vector3(scale, scale, scale),
        );
        // Each part sits differently inside the tree, so each instanced mesh has its own matrix.
        tree.slot = { meshes, index: i, matrices: parts.map((p) => base.clone().multiply(p.matrix)) };
        showTree(tree, !tree.hidden);
      });
      meshes.forEach((m) => {
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      });
      this.treeCells.push(cellOf(meshes, trees.map((t) => t.obstacle)));
    }
  }

  private treeMeshes: THREE.InstancedMesh[] = [];
  private treeCells: Cell[] = [];

  // --- the world's own trees, from fal.ai (`hubModels.ts`, `utils/rpg/landmark3d.ts`) ---------------

  /** The world's trees, each as parts to instance; empty until one has loaded, and in the classic world. */
  private forest: TreePart[][] = [];
  /** The urls the forest was last asked for, loaded or still loading. */
  private forestWanted = '';
  private forestToken = 0;

  /**
   * The world's own ground, painted by fal.ai (`utils/rpg/groundTexture.ts`), made to tile here
   * (`seamless`) and laid at the scan's tiling, undyed since it is already the world's colour; null
   * (a new world, the classic one, no key) puts the scan back.
   */
  async setGroundTexture(url: string | null, onError: (e: unknown) => void = () => {}): Promise<void> {
    if (url === this.groundUrl) return;
    this.groundUrl = url;
    const mat = this.ground.material as THREE.MeshStandardMaterial;
    const own = (tex: THREE.Texture | null) => {
      this.groundOwn?.dispose();
      this.groundOwn = tex;
      mat.map = tex ?? this.groundScan;
      recolor(mat, this.look.ground, this.isClassic() || tex ? 0 : 0.8);
    };
    if (!url) {
      own(null);
      return;
    }
    try {
      const bitmap = await createImageBitmap(new Blob([await loadLandmarkBytes(url)]));
      if (this.groundUrl !== url) {
        bitmap.close();
        return;
      }
      const tex = new THREE.CanvasTexture(seamless(bitmap));
      bitmap.close();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.copy(this.groundScan.repeat);
      tex.anisotropy = 4;
      own(tex);
    } catch (e) {
      if (this.groundUrl === url) this.groundUrl = null;
      onError(e);
    }
  }

  /**
   * The world's own trees across the map in place of the kit's (owner, 26 Oct 2026: "generate the
   * world's trees — now they are static assets"): the hub's tree and its young and old ones, mixed as
   * the kit's three were. Planted as each arrives, so the first is the whole forest for a minute;
   * none (a new world, the classic one, no key) puts the kit's back. Places' pines and dead trees
   * take them too, from the next place built.
   */
  async setForest(urls: string[], size: HubSize | undefined, onError: (url: string, e: unknown) => void = () => {}): Promise<void> {
    const fit = size ?? FOREST_FIT;
    const key = `${urls.join(' ')} ${fit.height}×${fit.width}`;
    if (key === this.forestWanted) return;
    this.forestWanted = key;
    const token = ++this.forestToken;
    // Whatever stands now and is still wanted, at the same size, stays while the rest loads.
    const resized = fit.height !== this.forestFit.height || fit.width !== this.forestFit.width;
    this.forestFit = fit;
    const kept = resized ? [] : this.forest.filter((parts) => urls.includes(this.forestUrls.get(parts) ?? ''));
    const gone = this.forest.filter((parts) => !kept.includes(parts));
    if (gone.length) {
      this.forest = kept;
      this.plantTrees();
      for (const place of this.places.values()) this.plantPlaceTrees(place);
      for (const parts of gone) {
        this.forestUrls.delete(parts);
        disposeTreeParts(parts);
      }
    }
    const have = new Set(kept.map((parts) => this.forestUrls.get(parts)));
    await Promise.all(
      urls
        .filter((url) => !have.has(url))
        .map(async (url) => {
          let parts: TreePart[];
          try {
            parts = await loadForestTree(url, fit);
          } catch (e) {
            onError(url, e);
            return;
          }
          if (token !== this.forestToken) {
            disposeTreeParts(parts);
            return;
          }
          this.forestUrls.set(parts, url);
          // In the order asked for, so the trees are mixed the same way whichever loaded first.
          this.forest = [...this.forest, parts].sort((a, b) => urls.indexOf(this.forestUrls.get(a)!) - urls.indexOf(this.forestUrls.get(b)!));
          this.plantTrees();
          for (const place of this.places.values()) this.plantPlaceTrees(place);
        }),
    );
  }

  private forestUrls = new Map<TreePart[], string>();
  private forestFit: HubSize = FOREST_FIT;
  private coverCells: Cell[] = [];
  /** The world's own flora's geometry and materials, made once per world. */
  private floraCache: { flora: string; parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[] } | null = null;

  /** A giant mushroom or a spire, in the world's colours, as parts to instance like a kit tree's. */
  private floraParts() {
    const look = this.look;
    if (this.floraCache?.flora === look.flora) return this.floraCache.parts;
    for (const p of this.floraCache?.parts ?? []) {
      p.geometry.dispose();
      p.material.dispose();
    }
    const at = (x: number, y: number, z: number, rx = 0, rz = 0) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
        new THREE.Vector3(1, 1, 1),
      );
    const glow = (color: string, k: number) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: new THREE.Color(look.accent), emissiveIntensity: k });
    let parts;
    if (look.flora === 'fungi') {
      const stalk = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.foliage).lerp(new THREE.Color(0xffffff), 0.65), roughness: 0.9 });
      parts = [
        { geometry: new THREE.CylinderGeometry(0.28, 0.42, 3.6, 8), material: stalk, matrix: at(0, 1.8, 0) },
        {
          geometry: new THREE.SphereGeometry(1.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
          material: glow(look.foliage, look.time === 'night' || look.time === 'dusk' ? 0.25 : 0.05),
          matrix: at(0, 3.2, 0),
        },
        { geometry: new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6), material: stalk, matrix: at(0.9, 0.7, 0.5) },
        { geometry: new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), material: glow(look.foliage, 0.1), matrix: at(0.9, 1.3, 0.5) },
      ];
    } else {
      const shard = new THREE.MeshStandardMaterial({
        color: look.foliage,
        roughness: 0.3,
        metalness: 0.25,
        emissive: new THREE.Color(look.accent),
        emissiveIntensity: look.time === 'night' || look.time === 'dusk' ? 0.35 : 0.08,
        flatShading: true,
      });
      parts = [
        { geometry: new THREE.ConeGeometry(0.7, 7, 5), material: shard, matrix: at(0, 3.5, 0) },
        { geometry: new THREE.ConeGeometry(0.4, 3.6, 5), material: shard, matrix: at(0.8, 1.6, 0.3, 0.2, -0.35) },
        { geometry: new THREE.ConeGeometry(0.35, 2.6, 5), material: shard, matrix: at(-0.7, 1.1, -0.4, -0.25, 0.4) },
      ];
    }
    this.floraCache = { flora: look.flora, parts };
    return parts;
  }

  /**
   * Grass tufts, ferns, bushes and flowers across the open ground, which is what breaks a tiled
   * floor up best: the eye stops reading the pattern once things stand on it. Kept off the square.
   */
  private plantGroundCover() {
    const rand = rng(11);
    // How many, and how big against the kit's own size: its tall grass is 1.9 m, made for a
    // stylised world, and at full size the meadow came up to the hunter's shoulders.
    const cover: Record<(typeof GROUND_COVER)[number], [number, number, number]> = {
      Grass_Common_Short: [1400, 0.35, 0.6],
      Grass_Common_Tall: [600, 0.25, 0.45],
      Grass_Wispy_Tall: [400, 0.25, 0.45],
      Fern_1: [200, 0.4, 0.7],
      Bush_Common: [110, 0.5, 0.9],
      Bush_Common_Flowers: [50, 0.5, 0.9],
      Flower_3_Group: [160, 0.3, 0.5],
    };
    for (const name of GROUND_COVER) {
      const parts = this.kit.parts(name);
      const [n, minS, maxS] = cover[name];
      const byCell = new Map<string, { x: number; z: number; base: THREE.Matrix4 }[]>();
      for (let i = 0; i < n; i++) {
        let x = 0;
        let z = 0;
        do {
          x = (rand() - 0.5) * COVER_HALF * 2;
          z = (rand() - 0.5) * COVER_HALF * 2;
        } while (Math.hypot(x, z) < 14);
        const s = minS + rand() * (maxS - minS);
        const base = new THREE.Matrix4().compose(
          new THREE.Vector3(x, 0, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
          new THREE.Vector3(s, s, s),
        );
        const key = cellKey(x, z);
        byCell.set(key, [...(byCell.get(key) ?? []), { x, z, base }]);
      }
      for (const tufts of byCell.values()) {
        const meshes = parts.map((part, j) => {
          const m = new THREE.InstancedMesh(part.geometry, part.material, tufts.length);
          m.receiveShadow = true;
          m.castShadow = name.startsWith('Bush');
          m.userData.shared = true;
          tufts.forEach((t, i) => m.setMatrixAt(i, t.base.clone().multiply(parts[j].matrix)));
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
          this.kitCover.add(m);
          this.cover.push({ mesh: m, n: tufts.length });
          return m;
        });
        this.coverCells.push(cellOf(meshes, tufts));
      }
    }
  }

  private buildVillage() {
    const wall = surfaceMat('plaster', 2, 1.2, { color: 0xf0e6d6 });
    const timber = surfaceMat('planks', 2, 0.3);
    const thatch = surfaceMat('thatch', 3, 2);
    this.stopgapWall = wall;
    this.stopgapRoof = thatch;
    for (const [x, z] of HOUSES) {
      // Every door faces the square.
      const rot = Math.atan2(-x, -z);
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
      this.stopgapHouses.push(house);
      const obstacle = { x, z, r: 4.3 };
      this.hubObstacles.push(obstacle);
      this.classicObstacles.push(obstacle);
      this.houseObstacles.push(obstacle);
      this.houseBase.push(obstacle.r);
    }

    this.buildWell(0, -3);
    this.planHub();

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
      this.fencePosts.push(p);
      this.classicOnly.push(p);
    }
  }

  private fencePosts: THREE.Mesh[] = [];
  private cover: { mesh: THREE.InstancedMesh; n: number }[] = [];
  /** The kit's meadow, only in the classic village: an invented world's grows its own (`setGroundCover`). */
  private kitCover = new THREE.Group();
  private ground!: THREE.Mesh;
  /** The Poly Haven scan the ground starts with, and goes back to without a world's own. */
  private groundScan!: THREE.Texture;
  /** The world's own ground from fal.ai, made to tile, while it is on the ground. */
  private groundOwn: THREE.Texture | null = null;
  private groundUrl: string | null = null;
  private stopgapWall!: THREE.MeshStandardMaterial;
  private stopgapRoof!: THREE.MeshStandardMaterial;

  // --- the world's look -------------------------------------------------------------------------

  /** The world being played (`utils/rpg/genesis.ts`); the classic one until a world is entered. */
  private look: WorldLook = CLASSIC_LOOK;
  private weather: Weather | null = null;
  private starDome: THREE.Points | null = null;
  private sky = new Sky();
  /** A flooded world: the sea that replaces the ground, and the land the village stands on. */
  private flood: { water: THREE.Mesh; land: THREE.Mesh } | null = null;

  private isClassic(): boolean {
    return this.look === CLASSIC_LOOK || JSON.stringify(this.look) === JSON.stringify(CLASSIC_LOOK);
  }

  /**
   * Draws the world from its look: sky, fog and light, the time of day, the weather, what grows and
   * how much of it, the colour of the ground, the leaves, the walls and the roofs, and water over
   * everything for a flooded one. The classic look is the scene exactly as it was before worlds.
   */
  applyWorld(look: WorldLook) {
    this.look = look;
    const classic = this.isClassic();
    const day = DAYLIGHT[look.time];
    this.scene.background = new THREE.Color(look.sky);
    const [near, far] = HAZE[look.haze];
    this.scene.fog = new THREE.Fog(look.fog, near, far);
    if (classic) {
      this.hemi.color.set(0xdfe9f3);
      this.hemi.groundColor.set(0x4a5a3a);
    } else {
      this.hemi.color.set(look.sky).lerp(new THREE.Color(0xffffff), 0.45);
      this.hemi.groundColor.set(look.ground);
    }
    this.hemi.intensity = day.sky;
    this.sunLight.color.set(look.sun);
    this.sunLight.intensity = day.sun;
    this.sunOffset.set(Math.cos(day.elevation) * 47, Math.sin(day.elevation) * 82, Math.cos(day.elevation) * 30);
    if (classic) this.sunOffset.set(40, 70, 25);
    this.sky.set(look, this.sunOffset);

    if (this.starDome) this.scene.remove(this.starDome);
    this.starDome = null;
    if (look.time === 'night' && !classic) {
      this.starDome = stars();
      this.scene.add(this.starDome);
    }
    if (this.weather) {
      this.scene.remove(this.weather.points);
      this.weather.dispose();
      this.weather = null;
    }
    if (look.weather !== 'none') {
      const color =
        look.weather === 'rain' ? 0xa9b9d6 : look.weather === 'snow' ? 0xffffff : look.weather === 'ash' ? 0x8f8a84 : look.accent;
      this.weather = new Weather(look.weather, color);
      this.scene.add(this.weather.points);
      this.weather.points.visible = this.quality.weather;
    }

    // A world's own ground is already its colour; the scan is grass until it is dyed.
    recolor(this.ground.material as THREE.Material, look.ground, classic || this.groundOwn ? 0 : 0.8);
    recolor(this.stopgapWall, look.wall, classic ? 0 : 0.65);
    recolor(this.stopgapRoof, look.roof, classic ? 0 : 0.7);
    this.leafMat.color.set(classic ? 0x7d9a6a : look.foliage);

    if (this.flood) {
      this.scene.remove(this.flood.water, this.flood.land);
      this.flood.water.geometry.dispose();
      this.flood.land.geometry.dispose();
      this.flood = null;
    }
    this.ground.visible = true;
    if (look.water === 'flooded' && !classic) {
      // The sea is the floor, and the village and every place are islands on it (`placeBuilder`'s
      // ground discs stand a little higher), joined by their paths.
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD_HALF * 2 + 40, WORLD_HALF * 2 + 40),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(look.sky).lerp(new THREE.Color(look.ground), 0.55).multiplyScalar(0.7),
          roughness: 0.12,
          metalness: 0.15,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.receiveShadow = true;
      const land = new THREE.Mesh(new THREE.CircleGeometry(34, 48), this.ground.material as THREE.Material);
      land.rotation.x = -Math.PI / 2;
      land.position.y = 0.012;
      land.receiveShadow = true;
      this.ground.visible = false;
      this.flood = { water, land };
      this.scene.add(water, land);
    }

    if (this.kit.loaded) this.dressWorld();
    else if (!classic && (look.flora === 'fungi' || look.flora === 'spires' || look.flora === 'none')) this.plantTrees();
    this.refreshCover();
  }

  /** What needs the kit: its leaves, walls and roofs recoloured, its trees replanted, its ground cover thinned. */
  private dressWorld() {
    const look = this.look;
    const classic = this.isClassic();
    for (const name of ['Leaves_Pine', 'Leaves_NormalTree', 'Leaves_TwistedTree', 'Leaves', 'Grass', 'Flowers']) {
      const m = this.kit.material(name);
      if (m) recolor(m, look.foliage, classic ? 0 : 0.7, 3.2);
    }
    for (const name of ['MI_Plaster', 'MI_Brick', 'MI_UnevenBrick']) {
      const m = this.kit.material(name);
      if (m) recolor(m, look.wall, classic ? 0 : 0.65);
    }
    for (const name of ['MI_RoundTiles', 'MI_WoodTrim']) {
      const m = this.kit.material(name);
      if (m) recolor(m, look.roof, classic ? 0 : name === 'MI_WoodTrim' ? 0.35 : 0.75);
    }
    this.plantTrees();
    this.refreshCover();
  }

  /**
   * How much grows: bare ground, a little, or all of it; under a flood the only cover is the reeds
   * of the places. The kit's meadow only in the classic village, the world's own under a layout.
   */
  private refreshCover() {
    const look = this.look;
    const classic = this.isClassic();
    const share = classic ? 1 : look.water === 'flooded' ? 0 : look.growth === 'barren' ? 0 : look.growth === 'sparse' ? 0.3 : 1;
    this.kitCover.visible = this.layout === null;
    this.ownCover.visible = this.layout !== null;
    for (const { mesh, n } of this.cover) mesh.count = Math.floor(n * share);
    for (const { mesh, n } of this.ownTufts) mesh.count = Math.floor(n * share);
  }

  // --- what grows on a world's own ground, from fal.ai (`utils/rpg/groundCover.ts`) ---------------

  private ownCover = new THREE.Group();
  private ownTufts: { mesh: THREE.InstancedMesh; n: number }[] = [];
  private ownCoverCells: Cell[] = [];
  private ownCoverWanted = '';
  private ownCoverToken = 0;
  /** Each kind's geometry, material and texture, to be given back when the world changes. */
  private ownCoverKinds: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] = [];

  /**
   * The world's own grass and plants across the open ground in place of the kit's meadow, each kind
   * a cut-out on crossed quads (`cutOut`), planted as it arrives where the kit's tufts would be. An
   * empty list (none made yet, a bare world) leaves the ground bare under a layout; the classic
   * village keeps the kit's either way.
   */
  async setGroundCover(urls: string[], onError: (url: string, e: unknown) => void = () => {}): Promise<void> {
    const key = urls.join(' ');
    if (key === this.ownCoverWanted) return;
    this.ownCoverWanted = key;
    const token = ++this.ownCoverToken;
    this.ownCover.clear();
    this.ownTufts = [];
    this.ownCoverCells = [];
    for (const k of this.ownCoverKinds) {
      k.geometry.dispose();
      k.material.map?.dispose();
      k.material.dispose();
    }
    this.ownCoverKinds = [];
    await Promise.all(
      urls.map(async (url, kind) => {
        let cut: ReturnType<typeof cutOut>;
        try {
          const bitmap = await createImageBitmap(new Blob([await loadLandmarkBytes(url)]));
          cut = token === this.ownCoverToken ? cutOut(bitmap) : null;
          bitmap.close();
          if (token === this.ownCoverToken && !cut) throw new Error('no clump left once the background was taken away');
        } catch (e) {
          onError(url, e);
          return;
        }
        if (!cut || token !== this.ownCoverToken) return;
        this.plantOwnCover(kind, cut.pixels, cut.aspect);
      }),
    );
  }

  /**
   * One kind of the world's own cover: how many and how tall in metres. Denser than the kit's meadow,
   * eight triangles a tuft being a fraction of one of its clumps.
   */
  private plantOwnCover(kind: number, pixels: ImageData, aspect: number) {
    const [count, minH, maxH] = ([[4000, 0.4, 0.8], [1500, 0.7, 1.3], [700, 0.4, 0.75]] as const)[kind] ?? [700, 0.4, 0.75];
    const tex = new THREE.DataTexture(pixels.data, pixels.width, pixels.height, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1 });
    // Two quads crossed, each face both ways round rather than double-sided: their normals point up,
    // lit like the ground they grow from, and a double-sided back face would turn its normal down.
    const quads: THREE.BufferGeometry[] = [];
    for (const turn of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      const q = new THREE.PlaneGeometry(aspect, 1);
      q.translate(0, 0.5, 0);
      q.rotateY(turn);
      quads.push(q);
    }
    const geometry = mergeGeometries(quads)!;
    for (const q of quads) q.dispose();
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
    this.ownCoverKinds.push({ geometry, material });

    const rand = rng(31 + kind);
    const byCell = new Map<string, { x: number; z: number; base: THREE.Matrix4; shade: number }[]>();
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      do {
        x = (rand() - 0.5) * COVER_HALF * 2;
        z = (rand() - 0.5) * COVER_HALF * 2;
      } while (Math.hypot(x, z) < 14);
      const s = minH + rand() * (maxH - minH);
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2),
        new THREE.Vector3(s, s, s),
      );
      const key = cellKey(x, z);
      byCell.set(key, [...(byCell.get(key) ?? []), { x, z, base, shade: 0.8 + rand() * 0.3 }]);
    }
    const color = new THREE.Color();
    for (const tufts of byCell.values()) {
      const m = new THREE.InstancedMesh(geometry, material, tufts.length);
      m.receiveShadow = true;
      tufts.forEach((t, i) => {
        m.setMatrixAt(i, t.base);
        m.setColorAt(i, color.setScalar(t.shade));
      });
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.ownCover.add(m);
      this.ownTufts.push({ mesh: m, n: tufts.length });
      this.ownCoverCells.push(cellOf([m], tufts));
    }
    this.refreshCover();
  }

  /**
   * The well in the square: a stone ring with a wall to it, inside and out, water a little down,
   * and a timber frame with a windlass and a small roof. The first one was a single open-ended
   * cylinder, so its far side was culled and it looked broken (owner, Oct 2026).
   */
  private buildWell(x: number, z: number) {
    const well = new THREE.Group();
    const stone = surfaceMat('stone', 4, 0.6);
    const inner = surfaceMat('stone', 3, 0.6, { color: 0x8a8a8a, side: THREE.BackSide });
    const timber = surfaceMat('planks', 0.3, 1.5);
    const outside = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.38, 0.95, 24, 1, true), stone);
    outside.position.y = 0.475;
    const inside = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.95, 24, 1, true), inner);
    inside.position.y = 0.475;
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.32, 24, 1), surfaceMat('stone', 1, 0.3));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.95;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.02, 24),
      new THREE.MeshStandardMaterial({ color: 0x1b2f3a, roughness: 0.1, metalness: 0.2 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    well.add(outside, inside, rim, water);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), timber);
      post.position.set(side * 1.18, 1.2, 0);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.05, 1.05), surfaceMat('planks', 1.5, 0.5));
      plank.position.set(0, 2.62, side * 0.42);
      plank.rotation.x = side * 0.55;
      well.add(post, plank);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 10), timber);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = 1.95;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), new THREE.MeshStandardMaterial({ color: 0x8a7350 }));
    rope.position.y = 1.5;
    well.add(axle, rope);
    well.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    water.castShadow = false;
    well.position.set(x, 0, z);
    this.scene.add(well);
    this.well = well;
    this.wellObstacle = { x, z, r: 1.6 };
    this.hubObstacles.push(this.wellObstacle);
    this.classicObstacles.push(this.wellObstacle);
  }

  private well: THREE.Group | null = null;
  private wellObstacle: Obstacle | null = null;

  // --- the world's own hub, from fal.ai (`hubModels.ts`, `utils/rpg/landmark3d.ts`) ---------------

  /** Where each of the hub's models stands: one spot per copy, facing the square. */
  private hubSpots = {} as Record<HubSlot, { x: number; z: number; rot: number; obstacle: Obstacle }[]>;
  /** What each model replaces until it comes: stopgaps first, then the kit's pieces. */
  private kitPieces: Partial<Record<HubSlot, THREE.Object3D[]>> = {};
  /** The houses' obstacles without a model: the stopgap's, then the kit house's. */
  private houseBase: number[] = [];
  private hubModels = new Map<HubSlot, { url: string; group: THREE.Group; template: THREE.Group; radius: number }>();
  private hubTokens: Partial<Record<HubSlot, number>> = {};
  /** The url and size each slot was last asked for, loaded or still loading. */
  private hubWanted: Partial<Record<HubSlot, string | null>> = {};

  /**
   * The spots, once: the landmark on the well, a house on each small plot and a hall on each large
   * one, the stall and the cart where the kit's stand, the goods where its barrels and crates are,
   * four lamps around the square between the paths in, and trees inside the fence wherever the
   * houses leave room. Spots that are new to the village block nothing until their model stands.
   */
  private planHub() {
    const facing = (x: number, z: number) => Math.atan2(-x, -z);
    const spot = (x: number, z: number, obstacle?: Obstacle) => {
      const o = obstacle ?? { x, z, r: 0, off: true };
      if (!obstacle) this.hubObstacles.push(o);
      return { x, z, rot: facing(x, z), obstacle: o };
    };
    const houses = (kind: HouseKind) =>
      this.stopgapHouses.flatMap((h, i) => (HOUSE_KINDS[i] === kind ? [{ ...spot(h.position.x, h.position.z, this.houseObstacles[i]), rot: h.rotation.y }] : []));
    const ring = (r: number, offset: number, n: number) =>
      Array.from({ length: n }, (_, k) => [Math.sin(offset + (k * Math.PI * 2) / n) * r, Math.cos(offset + (k * Math.PI * 2) / n) * r]);
    const lamps = ring(10.8, Math.PI / 8, 4);
    // Between the paths in, and clear of the houses, the cart and the stall by a few metres.
    const taken = [...HOUSES.map(([x, z]) => [x, z, 7.5]), [-18, -2, 4.5], [9.5, 4.2, 4]];
    const trees = ring(22, Math.PI / 8, 8).filter(([x, z]) => taken.every(([tx, tz, r]) => Math.hypot(x - tx, z - tz) > r));
    const well = this.well!.position;
    this.hubSpots = {
      landmark: [spot(well.x, well.z, this.wellObstacle!)].map((s) => ({ ...s, rot: 0 })),
      house: houses('small'),
      hall: houses('large'),
      tree: trees.map(([x, z]) => spot(x, z)),
      stall: [spot(9.5, 4.2)],
      cart: [spot(-18, -2)],
      lamp: lamps.map(([x, z]) => spot(x, z)),
      goods: [spot(-7.8, -6.6), spot(11, -9.7), spot(-10.2, 6.8)],
      // The forest's other trees stand nowhere in the hub (`setForest`).
      tree2: [],
      tree3: [],
    };
    this.classicSpots = this.hubSpots;
    this.kitPieces.landmark = [this.well!];
    this.kitPieces.house = this.stopgapHouses.filter((_, i) => HOUSE_KINDS[i] === 'small');
    this.kitPieces.hall = this.stopgapHouses.filter((_, i) => HOUSE_KINDS[i] === 'large');
  }

  /**
   * Each model shown, or what it replaces, and the obstacles to match. Under a world's own layout
   * nothing of the kit's village stands at all: a spot is empty ground until its model arrives.
   */
  private refreshHub() {
    const generated = this.layout !== null;
    for (const o of this.classicOnly) o.visible = !generated;
    if (generated) for (const list of Object.values(this.classicSpots)) for (const s of list) s.obstacle.off = true;
    for (const o of this.classicObstacles) o.off = generated;
    for (const slot of HUB_SLOTS) {
      const model = this.hubModels.get(slot);
      for (const o of this.kitPieces[slot] ?? []) o.visible = !model && !generated;
      for (const s of this.hubSpots[slot] ?? []) {
        const i = this.houseObstacles.indexOf(s.obstacle);
        if (model) {
          s.obstacle.r = model.radius;
          s.obstacle.off = false;
        } else if (i >= 0) s.obstacle.r = this.houseBase[i];
        else if (s.obstacle === this.wellObstacle) s.obstacle.r = 1.6;
        else s.obstacle.off = true;
      }
    }
  }

  // --- where the village stands (`utils/rpg/hubLayout.ts`) ---------------------------------------

  /** An invented world's own layout, or null for the classic village (the kit's, where it always stood). */
  private layout: HubLayout | null = null;
  /** The classic village's spots, planned once; `hubSpots` is these again when the layout is null. */
  private classicSpots = {} as Record<HubSlot, { x: number; z: number; rot: number; obstacle: Obstacle }[]>;
  /** Every obstacle of the village: kept apart from `obstacles`, which `clearNpcs` thins out. */
  private hubObstacles: Obstacle[] = [];
  /** What blocks walking only in the classic village: its houses, the well, the stall and the wagon. */
  private classicObstacles: Obstacle[] = [];
  /** The kit's pieces no model replaces (the fence, the bench), shown only in the classic village. */
  private classicOnly: THREE.Object3D[] = [];

  /**
   * Where the village and the forest stand (owner, 27 Oct 2026: "an empty board, not placeholders,
   * things appear as they become available, and where they stand generated"). A layout puts the
   * hub's models on its spots and the world's trees on its forest, and nothing else: no kit house,
   * well, fence or tree stands in for what has not come yet. Null is the classic village, the kit's,
   * for the classic world and a world that will never have models of its own. The same layout
   * again does nothing.
   */
  setLayout(layout: HubLayout | null) {
    if ((layout?.key ?? null) === (this.layout?.key ?? null)) return;
    const wasBare = this.layout !== null;
    this.layout = layout;
    if (wasBare !== (layout !== null)) this.rebuildPlaces();
    const generatedSpots = new Set(
      Object.values(this.hubSpots)
        .flat()
        .map((s) => s.obstacle)
        .filter((o) => !Object.values(this.classicSpots).some((list) => list.some((s) => s.obstacle === o))),
    );
    this.hubObstacles = this.hubObstacles.filter((o) => !generatedSpots.has(o));
    if (layout) {
      const spots = {} as typeof this.hubSpots;
      for (const slot of HUB_SLOTS) {
        spots[slot] = (layout.spots[slot] ?? []).map(({ x, z, rot }) => {
          const obstacle: Obstacle = { x, z, r: 0, off: true };
          this.hubObstacles.push(obstacle);
          return { x, z, rot, obstacle };
        });
      }
      this.hubSpots = spots;
    } else {
      this.hubSpots = this.classicSpots;
    }
    for (const slot of this.hubModels.keys()) this.placeCopies(slot);
    this.layTrees();
    this.refreshHub();
    this.refreshCover();
  }

  /** A model's copies on its slot's spots, again: the clones share the template's geometry and materials. */
  private placeCopies(slot: HubSlot) {
    const model = this.hubModels.get(slot);
    if (!model) return;
    model.group.clear();
    for (const s of this.hubSpots[slot] ?? []) {
      const copy = model.template.clone();
      copy.position.set(s.x, 0, s.z);
      copy.rotation.y = s.rot;
      model.group.add(copy);
    }
  }

  /**
   * The world's own hub in place of the kit's, a model per slot, or the kit back for a slot with
   * no url. What a model replaces stays until it has arrived; one that fails to load leaves it
   * there, and the others still come.
   */
  async setHubModels(
    urls: Partial<Record<HubSlot, string>>,
    sizes: HubSizes | undefined,
    onError: (slot: HubSlot, e: unknown) => void = () => {},
  ): Promise<void> {
    await Promise.all(
      HUB_SLOTS.filter((slot) => !isForestVariant(slot)).map((slot) => this.setHubModel(slot, urls[slot] ?? null, hubFit(slot, sizes)).catch((e) => onError(slot, e))),
    );
  }

  private async setHubModel(slot: HubSlot, url: string | null, fit: { height: number; width: number }): Promise<void> {
    // The world changes with every model that arrives, and asks for all of them again each time: a
    // load already on its way to the same url and size is left to finish, not started over. Sizes
    // that arrive after the model load it again, from the cache.
    const wanted = url && `${url} ${fit.height}×${fit.width}`;
    if ((this.hubWanted[slot] ?? null) === wanted) return;
    this.hubWanted[slot] = wanted;
    const token = (this.hubTokens[slot] = (this.hubTokens[slot] ?? 0) + 1);
    const clear = () => {
      const now = this.hubModels.get(slot);
      if (!now) return;
      this.scene.remove(now.group);
      disposeHubModel(now.template);
      this.hubModels.delete(slot);
    };
    if (!url) {
      clear();
      this.refreshHub();
      return;
    }
    let built;
    try {
      built = await loadHubModel(url, fit);
    } catch (e) {
      // Not wanted any more, so a later call may try the same url again.
      if (token === this.hubTokens[slot]) delete this.hubWanted[slot];
      throw e;
    }
    if (token !== this.hubTokens[slot]) {
      disposeHubModel(built.group);
      return;
    }
    clear();
    const group = new THREE.Group();
    group.name = `hub-${slot}`;
    this.scene.add(group);
    // The clones share the template's geometry and materials, so a house is drawn five times from
    // one upload.
    this.hubModels.set(slot, { url, group, template: built.group, radius: built.radius });
    this.placeCopies(slot);
    this.refreshHub();
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
    this.trees.push({ meshes: [trunk, crown], obstacle, r: obstacle.r });
  }

  private trunkMat = surfaceMat('bark', 1, 2, { roughness: 1 });
  private leafMat = surfaceMat('leaves', 2, 2, { color: 0x7d9a6a, roughness: 1 });

  /** Trees across the whole map, kept off the village. A place clears its own patch of them. */
  private buildTrees() {
    const rand = rng(42);
    for (let i = 0; i < 420; i++) {
      const x = (rand() - 0.5) * WORLD_HALF * 2;
      const z = (rand() - 0.5) * WORLD_HALF * 2;
      if (Math.hypot(x, z) < 32) continue;
      this.tree(x, z, 0.7 + rand() * 0.9);
    }
  }

  /**
   * The scattered trees where the layout has them, or where the classic world always had them: the
   * old ones taken up, with their obstacles, and the new ones planted and cleared for the places
   * that stand. Under a layout a tree is only a spot until the world's own tree model has come.
   */
  private layTrees() {
    for (const tree of this.trees) {
      for (const m of tree.meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const old = new Set(this.trees.map((t) => t.obstacle));
    this.obstacles = this.obstacles.filter((o) => !old.has(o));
    this.trees = [];
    if (this.layout) {
      for (const { x, z, scale } of this.layout.forest) {
        const obstacle = { x, z, r: 0.5 * scale };
        this.obstacles.push(obstacle);
        this.trees.push({ meshes: [], obstacle, r: obstacle.r });
      }
    } else {
      this.buildTrees();
    }
    for (const place of this.places.values()) this.clearTrees(place.center.x, place.center.z, place.road);
    this.plantTrees();
  }

  /** Takes away the scattered trees that stand on a place or its road. */
  private clearTrees(x: number, z: number, road: Ground[]) {
    for (const tree of this.trees) {
      const { x: tx, z: tz } = tree.obstacle;
      const inPlace = Math.hypot(tx - x, tz - z) < PLACE_RADIUS + 3;
      if (inPlace || nearestOnLine(tx, tz, road).d < 4) {
        tree.obstacle.off = true;
        showTree(tree, false);
      }
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
    const road = roadPoints(x, z, hashString(spec.name), PLACE_RADIUS);
    this.clearTrees(x, z, road);

    const bare = this.layout !== null;
    const built = buildPlace(spec, this.kit.loaded ? this.kit : null, this.look, this.isClassic() ? [] : this.forest, bare);
    built.group.position.copy(center);
    this.scene.add(built.group);
    const obstacles = built.obstacles.map((o) => ({ ...o, x: o.x + x, z: o.z + z }));
    let bareParts: Place['bare'];
    if (bare) {
      const trees = new THREE.Group();
      built.group.add(trees);
      const pieces: NonNullable<Place['bare']>['pieces'] = new Map();
      for (const { index, spots } of built.assetSpots ?? []) {
        // Nothing to walk into until the piece stands.
        const blocks = spots.map((s) => ({ x: s.x + x, z: s.z + z, r: 0, off: true }));
        obstacles.push(...blocks);
        pieces.set(index, { spots, obstacles: blocks });
      }
      bareParts = { treeSpots: built.treeSpots ?? [], trees, treeObstacles: [], pieces };
    }

    // Winding, not ruled (owner, 26 Oct 2026): the same bends for the same place every time.
    const path = new THREE.Mesh(ribbon(road, 3), surfaceMat('dirt', 1, 1, { roughness: 1 }));
    path.position.y = 0.01;
    path.receiveShadow = true;
    this.scene.add(path);

    const keepOut = built.keepOut ? { x: built.keepOut.x + x, z: built.keepOut.z + z, r: built.keepOut.r } : null;
    const place: Place = { spec, group: built.group, path, road, obstacles, center, arrived: false, spinners: built.spinners, keepOut, bare: bareParts };
    this.places.set(spec.name, place);
    if (bareParts) {
      this.plantPlaceTrees(place);
      for (const [index, piece] of this.placeModels.get(spec.name) ?? []) void this.putUpPiece(place, index, piece.url, piece.fit);
    }
  }

  /** The fal.ai pieces each place has been given (`setPlaceModel`), kept so a place built again gets them back. */
  private placeModels = new Map<string, Map<number, { url: string; fit: { height: number; width: number } }>>();

  /**
   * One of a place's fal.ai pieces (`spec.assets[index]`), sized to the beat's own size for it: put
   * up on its spots the moment it has loaded, in a bare place. The same url again does nothing.
   */
  async setPlaceModel(name: string, index: number, url: string, fit: { height: number; width: number }): Promise<void> {
    const known = this.placeModels.get(name) ?? new Map();
    if (known.get(index)?.url === url) return;
    known.set(index, { url, fit });
    this.placeModels.set(name, known);
    const place = this.places.get(name);
    if (place?.bare) await this.putUpPiece(place, index, url, fit);
  }

  private async putUpPiece(place: Place, index: number, url: string, fit: { height: number; width: number }) {
    const piece = place.bare?.pieces.get(index);
    if (!piece || !piece.spots.length) return;
    const model = await loadHubModel(url, fit);
    // Taken down, or built again, while it loaded.
    if (this.places.get(place.spec.name) !== place) {
      disposeHubModel(model.group);
      return;
    }
    const group = new THREE.Group();
    group.name = `place-piece-${index}`;
    piece.spots.forEach((s, i) => {
      const copy = model.group.clone();
      copy.position.set(s.x, 0, s.z);
      copy.rotation.y = s.rot;
      group.add(copy);
      const o = piece.obstacles[i];
      o.r = model.radius;
      // A thing smaller than a step is walked past, not into.
      o.off = model.radius < 0.6;
    });
    place.group.add(group);
  }

  /**
   * A bare place's trees: the world's own, on the spots its features gave, as soon as there are any
   * (`setForest` calls this again when they come); none before.
   */
  private plantPlaceTrees(place: Place) {
    const bare = place.bare;
    if (!bare) return;
    bare.trees.clear();
    place.obstacles = place.obstacles.filter((o) => !bare.treeObstacles.includes(o));
    bare.treeObstacles = [];
    if (!this.forest.length || this.isClassic()) return;
    const rand = rng(hashString(place.spec.name));
    for (const t of bare.treeSpots) {
      bare.trees.add(forestTree(this.forest[Math.floor(rand() * this.forest.length)], t.x, t.z, t.s, rand));
      bare.treeObstacles.push({ x: t.x + place.center.x, z: t.z + place.center.z, r: t.r });
    }
    place.obstacles.push(...bare.treeObstacles);
  }

  /** A place out of the scene, and what was its own freed; kit pieces and the forest's trees share theirs. */
  private takeDown(place: Place) {
    this.scene.remove(place.group, place.path);
    place.group.traverse((o) => {
      // Kit pieces share their geometry and materials with every other copy.
      if (o.userData.shared) return;
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
  }

  /** Every place built again, as it was: after the village went from the kit's to a world's own, or back. */
  private rebuildPlaces() {
    const standing = [...this.places.values()];
    for (const place of standing) this.takeDown(place);
    this.places.clear();
    for (const place of standing) {
      this.addPlace(place.spec);
      const again = this.places.get(place.spec.name);
      if (again) again.arrived = place.arrived;
    }
  }

  /** Takes down every place, for a new quest; the trees they cleared grow back. */
  clearPlaces() {
    for (const place of this.places.values()) this.takeDown(place);
    this.places.clear();
    for (const tree of this.trees) {
      tree.obstacle.off = false;
      showTree(tree, true);
    }
  }

  // --- the quest's characters -------------------------------------------------------------------

  /**
   * Puts a character at a place (by name) or, with null, on a free spot in the village square;
   * one already standing somewhere walks over. Their clothes are `color`; `about` is how the quest
   * describes them, which their trade, and so what they busy themselves with, is read from.
   */
  placeNpc(name: string, color: string, at: string | null, nth = 0, gender: 'male' | 'female' = 'male', body: PersonBody = {}, about = '') {
    let npc = this.npcs.get(name);
    if (!npc) {
      const group = new THREE.Group();
      const obstacle: Obstacle = { x: 0, z: 0, r: 0.6 };
      this.obstacles.push(obstacle);
      this.scene.add(group);
      const routine = new Routine(name, about, { x: 0, z: 0 });
      const created: Npc = { group, rig: null, color: new THREE.Color(color).getHex(), css: color, gender, want: 'none', token: 0, obstacle, spot: null, routine };
      npc = created;
      this.npcs.set(name, created);
    }
    // A failure has already put the kit's look up; the caller hears of it through `setNpcBody`.
    this.setNpcBody(name, body).catch(() => {});
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
        let free = 0;
        while (used.has(free)) free++;
        npc.spot = free;
      }
      pos = villageSpot(npc.spot);
    }
    npc.group.position.copy(pos);
    npc.obstacle.x = pos.x;
    npc.obstacle.z = pos.z;
    npc.routine.setHome(pos);
  }

  /** Who the hero is talking to, so that one alone talks while the dialogue holds the world. */
  private talking: string | null = null;

  /** Everything within `reach` of `home` a character could work at, by what it is. */
  private spotsNear(home: Ground, reach: number): Spot[] {
    const spots: Spot[] = [];
    const add = (x: number, z: number, r: number, kind: SpotKind) => {
      // Standing beside it may take them a little past their reach (`Routine.job` allows that much).
      if (Math.hypot(x - home.x, z - home.z) <= reach + r + 2) spots.push({ x, z, r, kind });
    };
    for (const slot of HUB_SLOTS) {
      const kind: SpotKind = slot === 'landmark' || slot === 'house' || slot === 'hall' || slot === 'goods' || slot === 'stall' || slot === 'cart' || slot === 'lamp' ? slot : 'tree';
      // An empty spot (a world's model not come yet) is bare ground: nothing to work at. The classic
      // village's barrels, stall and cart block nothing as spots, but they stand there all the same.
      const kit = this.layout === null && (this.kitPieces[slot] ?? []).some((o) => o.visible);
      for (const s of this.hubSpots[slot] ?? []) {
        if (s.obstacle.off && !kit) continue;
        add(s.obstacle.x, s.obstacle.z, Math.max(s.obstacle.r, SPOT_SIZE[kind] ?? 0.5), kind);
      }
    }
    for (const tree of this.trees) if (!tree.obstacle.off && !tree.hidden) add(tree.obstacle.x, tree.obstacle.z, tree.obstacle.r, 'tree');
    for (const place of this.places.values()) {
      if (place.keepOut) add(place.keepOut.x, place.keepOut.z, place.keepOut.r, 'landmark');
      const trees = new Set(place.bare?.treeObstacles ?? []);
      for (const o of place.obstacles) if (!o.off) add(o.x, o.z, o.r, trees.has(o) ? 'tree' : 'thing');
    }
    return spots;
  }

  /**
   * Whether a character can walk straight from one point to the other: no wall, tree or rock across
   * the way. The other people do not count (they step round each other), nor whatever the walker is
   * already in or is walking up to.
   */
  private clearWay(from: Ground, to: Ground): boolean {
    const people = new Set([...this.npcs.values()].map((n) => n.obstacle));
    const all = [this.obstacles, this.hubObstacles, ...[...this.places.values()].map((p) => p.obstacles)];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len2 = dx * dx + dz * dz || 1;
    for (const o of all.flat()) {
      if (o.off || people.has(o)) continue;
      const r = o.r + 0.35;
      if (Math.hypot(from.x - o.x, from.z - o.z) < r || Math.hypot(to.x - o.x, to.z - o.z) < r + 0.4) continue;
      const t = Math.max(0, Math.min(1, ((o.x - from.x) * dx + (o.z - from.z) * dz) / len2));
      if (Math.hypot(from.x + dx * t - o.x, from.z + dz * t - o.z) < r) return false;
    }
    return Math.abs(to.x) < WORLD_HALF && Math.abs(to.z) < WORLD_HALF;
  }

  private surroundings = {
    spots: (home: Ground, reach: number) => this.spotsNear(home, reach),
    clear: (from: Ground, to: Ground) => this.clearWay(from, to),
  };

  /**
   * Everyone about their day: walking, working, standing. A walker the hero comes up to stops and
   * faces them, so whoever they came to talk to is not walking off; a worker carries on, on the spot.
   */
  private updateNpcs(dt: number) {
    const hero = this.player.position;
    for (const npc of this.npcs.values()) {
      const r = npc.routine;
      const g = npc.group;
      const d = Math.hypot(hero.x - r.x, hero.z - r.z);
      let face = r.facing;
      if (d < HALT && !r.working) {
        npc.rig?.play('Idle_Loop', { fade: 0.4 });
        face = Math.atan2(hero.x - r.x, hero.z - r.z);
      } else {
        const act = r.tick(dt, this.surroundings);
        npc.rig?.play(act.clip, { speed: act.speed ?? 1, fade: 0.35 });
        if (act.strike) npc.rig?.once(act.strike.clip, act.strike.seconds, { fade: 0.2 });
        face = r.facing;
        g.position.set(r.x, 0, r.z);
        npc.obstacle.x = r.x;
        npc.obstacle.z = r.z;
      }
      const turn = Math.atan2(Math.sin(face - g.rotation.y), Math.cos(face - g.rotation.y));
      g.rotation.y += turn * Math.min(1, dt * 6);
    }
    // The beam stays over the one it marks, wherever they have walked to.
    const marked = this.markerNpc ? this.npcs.get(this.markerNpc) : undefined;
    if (marked && this.markerTarget) {
      this.markerTarget.copy(marked.group.position);
      this.marker.position.set(this.markerTarget.x, 30, this.markerTarget.z);
    }
  }

  /**
   * What a character is drawn as (`PersonBody`); the same body again changes nothing. Rejects when a
   * model would not load or rig, after putting the kit's look up in its place.
   */
  async setNpcBody(name: string, body: PersonBody): Promise<void> {
    const npc = this.npcs.get(name);
    if (!npc) return;
    const want = wanted(body);
    if (want === npc.want) return;
    // One model for another (the console's remake): the old one stands until the new one is rigged.
    const swap = isModel(npc.want) && isModel(want);
    npc.want = want;
    const token = ++npc.token;
    const current = () => this.npcs.get(name) === npc && npc.token === token;
    if (!swap) {
      npc.group.clear();
      npc.rig = null;
    }
    if (want === 'wait') return;
    if (want !== 'kit') {
      try {
        const template = await this.people.template(want, npc.gender, HEIGHT[npc.gender], 'person');
        if (current()) {
          npc.group.clear();
          npc.rig = this.people.dress(npc.group, template);
        }
        return;
      } catch (err) {
        if (!current()) return;
        npc.want = 'kit';
        npc.group.clear();
        npc.rig = null;
        this.dressKitNpc(name, npc, token);
        throw err;
      }
    }
    this.dressKitNpc(name, npc, token);
  }

  private dressKitNpc(name: string, npc: Npc, token: number) {
    const current = () => this.npcs.get(name) === npc && npc.token === token;
    this.chars.ready.then(
      () => {
        if (current()) npc.rig = this.chars.dress(npc.group, lookFor(name, npc.css, npc.gender));
      },
      () => {
        if (current()) npc.group.add(humanoid(npc.color, 0xd9b38c, 1.75));
      },
    );
  }

  private heroWant = 'none';
  private heroToken = 0;
  private heroDescription = '';

  /**
   * Who rigs the generated people (`Rigger`, the settings' switch), and the fal key Meshy is paid
   * with. A change re-rigs everyone already standing, so the two can be compared on the spot.
   */
  setRigger(rigger: Rigger, falKey: string | null) {
    const was = this.people.rigger === 'meshy' && !!this.people.falKey;
    this.people.rigger = rigger;
    this.people.falKey = falKey;
    if (was === (rigger === 'meshy' && !!falKey)) return;
    for (const [name, npc] of this.npcs) {
      if (!isModel(npc.want)) continue;
      const url = npc.want;
      npc.want = 'none';
      this.setNpcBody(name, { url }).catch(() => {});
    }
    if (isModel(this.heroWant)) {
      const url = this.heroWant;
      this.heroWant = 'none';
      void this.setHero({ url }, this.heroDescription).catch(() => {});
    }
    if (isModel(this.enemyWant)) {
      const url = this.enemyWant;
      this.enemyWant = 'none';
      void this.setEnemyBody({ url }).catch(() => {});
    }
  }

  /**
   * Who stands here as a generated model, for the console's remake: the people (nearest first), and
   * whether the hero and the job's enemies are.
   */
  generatedPeople(): { people: string[]; hero: boolean; enemy: boolean } {
    const at = this.player.position;
    const people = [...this.npcs]
      .filter(([, npc]) => isModel(npc.want))
      .sort(([, a], [, b]) => a.group.position.distanceTo(at) - b.group.position.distanceTo(at))
      .map(([name]) => name);
    return { people, hero: isModel(this.heroWant), enemy: isModel(this.enemyWant) && this.enemyLook?.shape === 'humanoid' };
  }

  /**
   * Who the hunter is drawn as (`PersonBody`): the world's generated hero, nobody while it is made, or
   * the kit's bearded ranger. Rejects when a model would not load or rig, after putting the ranger up.
   */
  async setHero(body: PersonBody, description = ''): Promise<void> {
    this.heroDescription = description;
    const want = wanted(body);
    if (want === this.heroWant) return;
    const swap = isModel(this.heroWant) && isModel(want);
    this.heroWant = want;
    const token = ++this.heroToken;
    if (!swap) {
      this.player.clear();
      this.playerRig = null;
    }
    if (want === 'wait') return;
    if (want !== 'kit') {
      try {
        const template = await this.people.template(want, heroBody(description), HEIGHT.hero, 'hero');
        if (token !== this.heroToken) return;
        this.player.clear();
        this.playerRig = this.people.dress(this.player, template);
        this.gripSword(this.playerRig);
        return;
      } catch (err) {
        if (token !== this.heroToken) return;
        this.heroWant = 'kit';
        this.player.clear();
        this.playerRig = null;
        this.dressKitHero(token);
        throw err;
      }
    }
    this.dressKitHero(token);
  }

  private dressKitHero(token: number) {
    this.chars.ready.then(
      () => {
        if (token !== this.heroToken) return;
        this.playerRig = this.chars.dress(this.player, {
          outfit: 'male_ranger',
          head: 'head_male',
          hair: ['hair_beard'],
          hairColor: HAIR_COLORS[4],
          height: 1.85,
        });
        this.gripSword(this.playerRig);
      },
      () => {
        // No models (offline, a failed fetch): the game still plays, with the old shapes.
        if (token !== this.heroToken) return;
        this.player.add(humanoid(0x3b3b46, 0xe0c2a2));
        this.sword.position.set(0.45, 1.05, 0.45);
        this.player.add(this.sword);
      },
    );
  }

  /**
   * The sword in a generated person's hand (`people.ts`), which has a wrist and no fingers: from the
   * hand's rest pose, the blade points where the body faces, and the fist is a few centimetres past
   * the wrist along the hand.
   */
  private gripGenerated(rig: Rig, hand: THREE.Object3D) {
    let mesh: THREE.SkinnedMesh | null = null;
    rig.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh;
    });
    const skinned = mesh as THREE.SkinnedMesh | null;
    const i = skinned ? skinned.skeleton.bones.findIndex((b) => b.name === hand.name) : -1;
    const rest = new THREE.Quaternion();
    if (skinned && i >= 0) new THREE.Matrix4().copy(skinned.skeleton.boneInverses[i]).invert().decompose(new THREE.Vector3(), rest, new THREE.Vector3());
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(rest.invert()).normalize();
    const grip = new THREE.Vector3(0, 0.08, 0);
    hand.add(this.sword);
    this.sword.scale.setScalar(1);
    this.sword.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    this.sword.position.copy(grip).addScaledVector(along, 0.42);
    this.kit.ready.then(
      () => {
        if (this.playerRig !== rig) return;
        const blade = this.kit.piece('Sword_Bronze');
        const box = new THREE.Box3().setFromObject(blade);
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
        blade.position.copy(grip).addScaledVector(along, -(box.min.y + 0.12));
        hand.remove(this.sword);
        hand.add(blade);
      },
      () => {},
    );
  }

  /**
   * Puts the sword in the hunter's right hand, worked out from the hand's own bones rather than
   * tuned by eye: the grip is between the wrist and the knuckles, and the blade leaves the fist
   * on the thumb side, along the line from the little finger's knuckle to the index finger's.
   */
  private gripSword(rig: Rig) {
    const hand = rig.hand;
    const index = rig.model.getObjectByName('index_01_r');
    const pinky = rig.model.getObjectByName('pinky_01_r');
    const middle = rig.model.getObjectByName('middle_01_r');
    if (hand && hand.name === 'RightHand') {
      this.gripGenerated(rig, hand);
      return;
    }
    if (!hand || !index || !pinky || !middle) {
      this.sword.position.set(0.45, 1.05, 0.45);
      this.player.add(this.sword);
      return;
    }
    rig.model.updateMatrixWorld(true);
    const local = (o: THREE.Object3D) => hand.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const along = local(index).sub(local(pinky)).normalize();
    const grip = local(middle).multiplyScalar(0.55);
    // The rig is in centimetres under a 0.01 armature; the sword is in metres.
    const s = hand.getWorldScale(new THREE.Vector3()).x;
    hand.add(this.sword);
    this.sword.scale.setScalar(1 / s);
    this.sword.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    // The box is centred; most of its 1.1 m is blade, beyond the fist.
    this.sword.position.copy(grip).addScaledVector(along, 0.42 / s);

    // The kit's bronze sword, when it comes: its blade is +y, the pommel at the bottom.
    this.kit.ready.then(
      () => {
        const blade = this.kit.piece('Sword_Bronze');
        const box = new THREE.Box3().setFromObject(blade);
        blade.scale.setScalar(1 / s);
        blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
        // The fist closes round the grip a hand's width above the pommel.
        blade.position.copy(grip).addScaledVector(along, -(box.min.y + 0.12) / s);
        hand.remove(this.sword);
        hand.add(blade);
      },
      () => {},
    );
  }

  /** Takes one character out of the world for good: they are dead. */
  removeNpc(name: string) {
    const npc = this.npcs.get(name);
    if (!npc) return;
    this.scene.remove(npc.group);
    npc.obstacle.off = true;
    this.obstacles = this.obstacles.filter((o) => o !== npc.obstacle);
    this.npcs.delete(name);
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

  /**
   * A clue's own model from fal.ai (`landmark3d.ts`, `ensureClueModel`) in place of its block, where
   * the block lay, on the ground and still: a real thing lying there does not turn. A clue gone by
   * the time it has loaded (the next beat) is left gone.
   */
  async setClueModel(id: string, url: string): Promise<void> {
    const before = this.clues.get(id);
    if (!before || before.userData.model === url) return;
    const model = await loadHubModel(url, CLUE_FIT);
    const now = this.clues.get(id);
    if (!now || now !== before) {
      disposeHubModel(model.group);
      return;
    }
    model.group.position.set(now.position.x, 0, now.position.z);
    model.group.rotation.y = rng(hashString(id))() * Math.PI * 2;
    model.group.userData.model = url;
    model.group.userData.still = true;
    this.scene.remove(now);
    this.scene.add(model.group);
    this.clues.set(id, model.group);
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
      if (!p.mesh.visible) continue;
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
      // Nobody to talk to until they are there to be seen.
      if (npc.group.children.length === 0) continue;
      const d = npc.group.position.distanceTo(this.player.position);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  // --- the quest's things -----------------------------------------------------------------------

  /**
   * Puts a beat's things in the middle of its place, replacing any left from before. A thing to
   * gather is its fal.ai model when `item` names one (`setItemModel`); with `item.wait` it is nothing
   * at all until that model comes, in an invented world, where no block stands in for anything.
   * For enemies that walk on two legs `item` is their generated body the same way (`setEnemyBody`).
   */
  spawnObjective(kind: ObjectiveKind, count: number, look: TargetLook, at: string | null, item: { url?: string; wait?: boolean } = {}) {
    this.clearObjective();
    if (kind === 'slay') {
      this.enemyLook = look;
      this.enemyWant = wanted(item);
      this.enemyToken++;
    }
    this.itemLook = look;
    this.itemWait = !!item.wait;
    if (this.itemModel?.url !== item.url) {
      if (this.itemModel) disposeHubModel(this.itemModel.template);
      this.itemModel = null;
      this.itemToken++;
    }
    if (kind === 'collect' && item.url) void this.setItemModel(item.url).catch(() => this.setItemModel(null));
    const place = at ? this.places.get(at) : undefined;
    const center = place?.center ?? SPAWN;
    const rand = rng(Math.floor(Math.random() * 1e6) + 1);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand();
      const d = 3 + rand() * 6;
      const pos = new THREE.Vector3(center.x + Math.sin(a) * d, 0, center.z + Math.cos(a) * d);
      const keep = place?.keepOut;
      if (keep && Math.hypot(pos.x - keep.x, pos.z - keep.z) < keep.r + 1.5) {
        // Not inside the landmark's walls: out to its edge, on the side of the place's middle.
        const away = new THREE.Vector3(pos.x - keep.x, 0, pos.z - keep.z);
        if (away.lengthSq() < 0.01) away.set(center.x - keep.x, 0, center.z - keep.z);
        away.setLength(keep.r + 1.5);
        pos.set(keep.x + away.x, 0, keep.z + away.z);
      }
      if (kind === 'collect') {
        const mesh = new THREE.Group();
        mesh.position.copy(pos).setY(0.8);
        this.scene.add(mesh);
        this.pickups.push({ mesh, phase: rand() * 6 });
        this.dressPickup(mesh);
      } else {
        const enemy: Enemy = { mesh: new THREE.Group(), rig: null, size: look.size, hp: 3, home: pos.clone(), hitCooldown: 1, flash: 0 };
        enemy.mesh.position.copy(pos);
        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);
        if (look.shape !== 'humanoid') {
          enemy.mesh.add(buildEnemy({ ...look, size: 1 }));
          continue;
        }
        void this.dressEnemy(enemy, this.enemyToken).catch(() => {});
      }
    }
  }

  /** What the humanoid enemies are drawn as (`PersonBody`), and a count that makes an older load stale. */
  private enemyWant = 'kit';
  private enemyToken = 0;
  private enemyLook: TargetLook | null = null;

  /**
   * The job's enemies as their generated body, once made (`ensurePersonModel`, the beat's English
   * `prop`); null for the kit's bare body washed in their colour (no key, a failed model).
   */
  async setEnemyBody(body: PersonBody): Promise<void> {
    const want = wanted(body);
    if (want === this.enemyWant) return;
    this.enemyWant = want;
    const token = ++this.enemyToken;
    if (this.enemyLook?.shape !== 'humanoid') return;
    await Promise.all(this.enemies.map((e) => this.dressEnemy(e, token)));
  }

  private async dressEnemy(enemy: Enemy, token: number): Promise<void> {
    const look = this.enemyLook;
    if (!look) return;
    const want = this.enemyWant;
    enemy.mesh.clear();
    enemy.rig = null;
    if (want === 'wait') return;
    if (want !== 'kit') {
      try {
        const template = await this.people.template(want, 'male', HEIGHT.enemy, 'enemy');
        if (token === this.enemyToken && enemy.hp > 0) enemy.rig = this.people.dress(enemy.mesh, template);
        return;
      } catch (err) {
        if (token !== this.enemyToken) return;
        this.enemyWant = 'kit';
        this.dressKitEnemy(enemy, look, token);
        throw err;
      }
    }
    this.dressKitEnemy(enemy, look, token);
  }

  /** Something that was a man once: the bare base body, washed in the target's colour. */
  private dressKitEnemy(enemy: Enemy, look: TargetLook, token: number) {
    this.chars.ready.then(
      () => {
        if (token === this.enemyToken && enemy.hp > 0)
          enemy.rig = this.chars.dress(enemy.mesh, { outfit: 'body_male', head: undefined, tint: new THREE.Color(look.color).getHex(), tintAmount: 0.8, height: 1.8 });
      },
      () => {
        if (token === this.enemyToken) enemy.mesh.add(buildEnemy({ ...look, size: 1 }));
      },
    );
  }

  /** What a thing to gather looks like: the model, the block, or nothing yet. */
  private itemLook: TargetLook | null = null;
  private itemWait = false;
  private itemModel: { url: string; template: THREE.Group; height: number } | null = null;
  private itemToken = 0;

  private dressPickup(mesh: THREE.Group) {
    mesh.clear();
    if (this.itemModel) {
      const copy = this.itemModel.template.clone();
      // Floating about its own middle, as the block did.
      copy.position.y = -this.itemModel.height / 2;
      mesh.add(copy);
    } else if (!this.itemWait && this.itemLook) {
      mesh.add(buildItem(this.itemLook));
    }
    mesh.visible = mesh.children.length > 0;
  }

  /**
   * The things to gather as their own model from fal.ai (`ensureClueModel`, the beat's English
   * `prop`), in place of the block or of nothing; null puts the block back (no key, a failed model).
   * Made for the beat's things, so a new `spawnObjective` keeps it only when handed the same url.
   */
  async setItemModel(url: string | null): Promise<void> {
    const token = ++this.itemToken;
    if (!url) {
      this.itemModel = null;
      this.itemWait = false;
      for (const p of this.pickups) this.dressPickup(p.mesh as THREE.Group);
      return;
    }
    if (this.itemModel?.url !== url) {
      const size = this.itemLook?.size ?? 1;
      const fit = { height: Math.min(1.4, ITEM_FIT.height * size), width: Math.min(1.6, ITEM_FIT.width * size) };
      const model = await loadHubModel(url, fit);
      if (token !== this.itemToken) {
        disposeHubModel(model.group);
        return;
      }
      if (this.itemModel) disposeHubModel(this.itemModel.template);
      const height = new THREE.Box3().setFromObject(model.group).getSize(new THREE.Vector3()).y;
      this.itemModel = { url, template: model.group, height };
    }
    for (const p of this.pickups) this.dressPickup(p.mesh as THREE.Group);
  }

  clearObjective() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    for (const e of [...this.enemies, ...this.dying]) this.scene.remove(e.mesh);
    this.pickups = [];
    this.enemies = [];
    this.dying = [];
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

  /**
   * The witcher's senses (`senses.ts`): on for `SENSES_SECONDS`, or off again early. Lights the
   * clues and the job's targets and lays the trail to the marker.
   */
  toggleSenses(on = this.sensesLeft <= 0) {
    if (on && this.paused) return;
    this.sensesLeft = on ? SENSES_SECONDS : 0;
    this.trailTimer = 0;
    this.senses.setActive(on, this.clock.elapsedTime);
    this.cb.onSenses?.(on);
  }

  sensesOn(): boolean {
    return this.sensesLeft > 0;
  }

  /** The way to the marker, along the road that leads there if there is one (`trail.ts`). */
  private layTrail() {
    if (!this.markerTarget) {
      this.senses.setTrail([]);
      return;
    }
    const to = this.markerTarget;
    let road: Ground[] | null = null;
    for (const place of this.places.values()) {
      if (Math.hypot(place.center.x - to.x, place.center.z - to.z) < PLACE_RADIUS + 5) road = place.road;
    }
    const from = { x: this.player.position.x, z: this.player.position.z };
    const points = trailPoints(from, { x: to.x, z: to.z }, road, hashString(`${Math.round(to.x)},${Math.round(to.z)}`));
    // The first step is the hunter's own; start the prints a stride ahead of his feet.
    this.senses.setTrail(footprints(points).filter((p) => p.along > 1.2));
  }

  private updateSenses(dt: number) {
    const t = this.clock.elapsedTime;
    if (this.sensesLeft > 0) {
      this.sensesLeft -= dt;
      if (this.sensesLeft <= 0) this.toggleSenses(false);
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.5;
        this.layTrail();
      }
    }
    const targets = this.senseTargets;
    targets.length = 0;
    if (this.senses.active || this.sensesLeft > 0) {
      for (const mesh of this.clues.values()) targets.push({ position: mesh.position, clue: true });
      for (const p of this.pickups) targets.push({ position: p.mesh.position, clue: false });
      for (const e of this.enemies) targets.push({ position: e.mesh.position, clue: false });
    }
    this.senses.update(dt, t, targets);
  }

  /** While a dialogue or a menu is open the world stands still and the mouse is the reader's. */
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused && this.sensesLeft > 0) this.toggleSenses(false);
    // Nobody walks on the spot while the world holds; the one talked to lingers a little after.
    for (const [name, npc] of this.npcs) {
      if (paused && name !== this.talking) npc.rig?.play('Idle_Loop', { fade: 0.4 });
      if (!paused && name === this.talking) npc.routine.linger(3 + Math.random() * 3);
    }
    if (!paused) this.talking = null;
    this.keys.clear();
    this.stick = { x: 0, y: 0 };
    this.lookTouch = null;
    if (paused && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** The touch stick: walks toward where it points, camera-relative like WASD; runs near its rim. */
  setStick(x: number, y: number) {
    this.stick = this.paused ? { x: 0, y: 0 } : { x, y };
  }

  requestLock() {
    if (this.paused || this.lookTouch || matchMedia('(pointer: coarse)').matches) return;
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
    this.playerRig?.once('Sword_Attack', ATTACK_COOLDOWN);
    const forward = new THREE.Vector3(Math.sin(this.player.rotation.y), 0, Math.cos(this.player.rotation.y));
    for (const enemy of [...this.enemies]) {
      // Not there yet: its body is still being made.
      if (enemy.mesh.children.length === 0) continue;
      const to = enemy.mesh.position.clone().sub(this.player.position);
      const dist = to.length();
      if (dist > ATTACK_RANGE) continue;
      // A wide arc in front, so a swing does not need perfect aim with a mouse.
      if (dist > 0.8 && to.normalize().dot(forward) < 0.2) continue;
      enemy.hp -= 1;
      enemy.flash = 0.15;
      enemy.mesh.position.add(to.multiplyScalar(1.2));
      if (enemy.hp <= 0) {
        this.enemies = this.enemies.filter((e) => e !== enemy);
        if (enemy.rig) {
          // It falls before it goes; it stops being a target at once.
          enemy.rig.once('Death01', 1.4, { final: true });
          this.dying.push({ mesh: enemy.mesh, rig: enemy.rig, left: 2.2 });
        } else {
          this.scene.remove(enemy.mesh);
        }
        this.cb.onProgress();
      } else {
        enemy.rig?.once('Hit_Chest', 0.3);
      }
    }
  }

  interact() {
    if (this.paused) return;
    const thing = this.nearestThing();
    if (!thing) return;
    if ('talk' in thing) {
      const npc = this.npcs.get(thing.talk);
      if (npc) {
        this.talking = thing.talk;
        npc.group.rotation.y = Math.atan2(this.player.position.x - npc.routine.x, this.player.position.z - npc.routine.z);
        npc.rig?.play('Idle_Talking_Loop', { fade: 0.4 });
      }
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
    if (code === 'KeyQ' && !e.repeat) this.toggleSenses();
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

  /*
   * A finger on the canvas turns the camera, as the mouse does under pointer lock. One finger at a
   * time: the other thumb is on the stick, which is an element of its own and never reaches here.
   * `touch-action: none` on the canvas keeps the page from scrolling under the drag.
   */
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || this.paused || this.lookTouch) return;
    e.preventDefault();
    this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    const touch = this.lookTouch;
    if (!touch || e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    touch.x = e.clientX;
    touch.y = e.clientY;
    this.yaw -= dx * 0.008;
    this.pitch = Math.min(1.1, Math.max(-0.35, this.pitch + dy * 0.006));
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.lookTouch?.id === e.pointerId) this.lookTouch = null;
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
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  // --- the loop ---------------------------------------------------------------------------------

  start() {
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      const started = this.frames.begin();
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (!this.paused) this.update(dt);
      // The people move even while a dialogue holds the world: whoever is talking talks.
      this.animate(dt);
      this.updateSenses(dt);
      this.updateCamera();
      this.updateNameTag();
      this.sky.update(dt, this.camera.position);
      this.cullFar();
      this.renderer.render(this.scene, this.camera);
      this.frames.end(started, this.renderer.info.render, !this.paused);
    };
    this.clock.start();
    tick();
  }

  private animate(dt: number) {
    this.weather?.update(dt, this.player.position);
    this.playerRig?.update(dt);
    for (const npc of this.npcs.values()) npc.rig?.update(dt);
    for (const enemy of this.enemies) enemy.rig?.update(dt);
    for (const d of this.dying) {
      d.rig.update(dt);
      d.left -= dt;
      if (d.left <= 0) this.scene.remove(d.mesh);
    }
    this.dying = this.dying.filter((d) => d.left > 0);
  }

  private collide(pos: THREE.Vector3, radius = 0.45) {
    const all = [this.obstacles, this.hubObstacles, ...[...this.places.values()].map((p) => p.obstacles)];
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
    const stick = Math.hypot(this.stick.x, this.stick.y);
    const onStick = stick > 0.18;
    const fwd = onStick
      ? -this.stick.y
      : (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = onStick
      ? this.stick.x
      : (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const moving = fwd !== 0 || side !== 0;
    // The stick pushed to its rim is Shift: there is no third thumb for a run button.
    const running = k.has('ShiftLeft') || k.has('ShiftRight') || stick > 0.85;
    if (moving) {
      const speed = running ? RUN : WALK;
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
    const t = this.clock.elapsedTime;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.swing = Math.max(0, this.swing - dt * 4);
    if (this.playerRig) {
      // The hunter covers ground faster than anyone walks, so both paces are the jog, sped up.
      if (moving) this.playerRig.play('Jog_Fwd_Loop', { speed: running ? 2.1 : 1.4 });
      else this.playerRig.play('Sword_Idle');
    } else {
      // The capsule: a little bob while walking, and the sword's quick arc on a swing.
      this.player.children[0].position.y = 0.725 + (moving ? Math.abs(Math.sin(t * 10)) * 0.06 : 0);
      this.sword.rotation.y = this.swing > 0 ? Math.sin(this.swing * Math.PI) * 1.8 - 0.6 : 0;
    }

    for (const mesh of this.clues.values()) if (!mesh.userData.still) mesh.rotation.y += dt * 0.8;
    for (const p of this.pickups) {
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.8 + Math.sin(t * 2 + p.phase) * 0.15;
    }

    this.updateEnemies(dt);
    this.updateNpcs(dt);

    for (const place of this.places.values()) {
      for (const s of place.spinners) s.object.rotation[s.axis] += s.speed * dt;
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

    this.sunLight.position.copy(this.player.position).add(this.sunOffset);
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
      // An enemy with no body yet stands still and harms nobody until it has one.
      if (enemy.mesh.children.length === 0) continue;
      const pos = enemy.mesh.position;
      const toPlayer = this.player.position.clone().sub(pos).setY(0);
      const dist = toPlayer.length();
      enemy.hitCooldown = Math.max(0, enemy.hitCooldown - dt);
      let gait: 'Idle_Loop' | 'Walk_Loop' | 'Jog_Fwd_Loop' = 'Idle_Loop';
      if (dist < 14 && dist > 1.2) {
        pos.addScaledVector(toPlayer.normalize(), 3.2 * dt);
        gait = 'Jog_Fwd_Loop';
      } else if (dist >= 14) {
        const home = enemy.home.clone().sub(pos).setY(0);
        if (home.length() > 0.5) {
          pos.addScaledVector(home.normalize(), 2 * dt);
          gait = 'Walk_Loop';
        }
      }
      enemy.rig?.play(gait);
      this.collide(pos, 0.4);
      enemy.mesh.lookAt(this.player.position.x, 0, this.player.position.z);
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.mesh.scale.setScalar(enemy.size * (enemy.flash > 0 ? 1.12 : 1));
      if (dist <= 1.5 && enemy.hitCooldown === 0) {
        enemy.hitCooldown = 1.2;
        enemy.rig?.once('Punch_Jab', 0.5);
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

  /** The nearest character within `NAME_RANGE`, named over their head; nobody while the world is held. */
  private updateNameTag() {
    let who: string | null = null;
    let npc: Npc | null = null;
    let bestD = NAME_RANGE;
    if (!this.paused) {
      for (const [name, n] of this.npcs) {
        if (n.group.children.length === 0) continue;
        const d = n.group.position.distanceTo(this.player.position);
        if (d < bestD) {
          bestD = d;
          who = name;
          npc = n;
        }
      }
    }
    const head = npc && npc.group.position.clone().setY(npc.group.position.y + HEIGHT[npc.gender] + 0.2).project(this.camera);
    // Behind the camera, or off the edge of the view, there is no head to name.
    if (!npc || !head || head.z > 1 || Math.abs(head.x) > 1.1 || Math.abs(head.y) > 1.1) {
      if (!this.nameTag.hidden) this.nameTag.hidden = true;
      return;
    }
    if (who !== this.nameTagFor) {
      this.nameTagFor = who;
      this.nameTag.textContent = who;
    }
    this.nameTag.hidden = false;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const x = (head.x + 1) * 0.5 * w;
    const y = (1 - head.y) * 0.5 * h;
    this.nameTag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    // Fades in over the last two metres of the approach.
    this.nameTag.style.opacity = String(Math.min(1, (NAME_RANGE - bestD) / 2));
  }

  /**
   * Past the fog nothing can be seen, but three still draws it: the squares of trees and cover and
   * the places of earlier quests that stand beyond it are switched off until the camera nears.
   */
  private cullFar() {
    const fog = this.scene.fog as THREE.Fog | null;
    if (!fog) return;
    const far = fog.far;
    const { x, z } = this.camera.position;
    const set = (cell: Cell) => {
      const on = Math.hypot(cell.x - x, cell.z - z) - cell.r < far;
      if (cell.meshes[0]?.visible !== on) for (const m of cell.meshes) m.visible = on;
    };
    for (const cell of this.treeCells) set(cell);
    for (const cell of this.coverCells) set(cell);
    for (const cell of this.ownCoverCells) set(cell);
    for (const place of this.places.values()) {
      place.group.visible = Math.hypot(place.center.x - x, place.center.z - z) - PLACE_RADIUS - LANDMARK_REACH < far;
    }
  }

  /** The last two seconds of frames (`frames.ts`). */
  frameStats(): FrameStats {
    return this.frames.stats(this.canvas, this.renderer.getPixelRatio());
  }

  /** The play since the last call, for the minute's record. */
  takeFrameWindow(): FrameWindow | null {
    return this.frames.takeWindow();
  }

  /** How many places stand in the scene: a world keeps every place of every quest. */
  placeCount(): number {
    return this.places.size;
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** The console's switches, to find out on the phone itself what a frame is spending. */
  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(size.x, size.y, false);
    // The light's switch rather than the renderer's: three rebuilds the programs that read it.
    this.sunLight.castShadow = q.shadows;
    if (this.weather) this.weather.points.visible = q.weather;
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.senses.dispose();
    this.nameTag.remove();
    // A forest tree still loading is not planted in a scene that is gone.
    this.forestToken++;
    this.ownCoverToken++;
    this.groundUrl = null;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
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
