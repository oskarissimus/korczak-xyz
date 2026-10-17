/*
 * Builds a quest's place, and the things in it, from the closed vocabulary in `utils/rpg/place.ts`.
 *
 * Every feature is a small function of a seeded random, so one quest's place looks the same every
 * time it is built and two quests' places do not. Everything stays inside `PLACE_RADIUS` of the
 * centre, and the middle `CLEAR_RADIUS` is left open, because that is where the targets are put
 * and a target inside a pillar cannot be reached.
 */

import * as THREE from 'three';

import type { Feature, PlaceSpec, TargetLook } from '../../utils/rpg/place';

export const PLACE_RADIUS = 24;
const CLEAR_RADIUS = 10;

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** Set on a tree that a place has cleared away; `collide` skips it. */
  off?: boolean;
}

export interface BuiltPlace {
  group: THREE.Group;
  obstacles: Obstacle[];
}

/** A tiny seeded random, so a place is the same place every time it is built. */
export function rng(seed: number) {
  let s = Math.max(1, Math.floor(seed) % 2147483646);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.abs(h) || 1;
}

const mat = (color: number | string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    c.castShadow = true;
    c.receiveShadow = true;
  });
  return o;
}

/** A spot in the ring between the clear middle and the edge. */
function ringSpot(rand: () => number, inner = CLEAR_RADIUS + 1, outer = PLACE_RADIUS - 1) {
  const a = rand() * Math.PI * 2;
  const d = inner + rand() * (outer - inner);
  return { x: Math.sin(a) * d, z: Math.cos(a) * d, a };
}

type Builder = (g: THREE.Group, obstacles: Obstacle[], rand: () => number) => void;

const FEATURE_BUILDERS: Record<Feature, Builder> = {
  pines(g, obstacles, rand) {
    const trunk = mat(0x4d3420);
    const leaf = mat(0x2f4f2a);
    for (let i = 0; i < 28; i++) {
      const { x, z } = ringSpot(rand);
      const s = 0.8 + rand() * 0.8;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2 * s, 6), trunk);
      t.position.set(x, s, z);
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.8 * s, 5 * s, 7), leaf);
      c.position.set(x, 4.2 * s, z);
      g.add(t, c);
      obstacles.push({ x, z, r: 0.5 * s });
    }
  },
  dead_trees(g, obstacles, rand) {
    const bark = mat(0x3b3229);
    for (let i = 0; i < 12; i++) {
      const { x, z } = ringSpot(rand);
      const h = 3 + rand() * 3;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, h, 5), bark);
      trunk.position.y = h / 2;
      tree.add(trunk);
      for (let b = 0; b < 3; b++) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 1.6, 4), bark);
        branch.position.y = h * (0.55 + b * 0.13);
        branch.rotation.z = (rand() - 0.5) * 2;
        branch.rotation.y = rand() * Math.PI * 2;
        branch.position.x = Math.sin(branch.rotation.z) * -0.6;
        tree.add(branch);
      }
      tree.position.set(x, 0, z);
      tree.rotation.z = (rand() - 0.5) * 0.25;
      g.add(tree);
      obstacles.push({ x, z, r: 0.4 });
    }
  },
  rocks(g, obstacles, rand) {
    const stone = mat(0x8c8a84);
    for (let i = 0; i < 14; i++) {
      const { x, z } = ringSpot(rand, 4);
      const s = 0.3 + rand() * 1.2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s), stone);
      rock.position.set(x, s * 0.5, z);
      rock.rotation.set(rand(), rand(), rand());
      g.add(rock);
      if (s > 0.8) obstacles.push({ x, z, r: s * 0.8 });
    }
  },
  pillars(g, obstacles, rand) {
    const stone = mat(0x9a968c);
    const n = 8 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = 2 + rand() * 6;
      const x = Math.sin(a) * (CLEAR_RADIUS + 2);
      const z = Math.cos(a) * (CLEAR_RADIUS + 2);
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.4), stone);
      p.position.set(x, h / 2, z);
      p.rotation.set(0, rand(), (rand() - 0.5) * 0.15);
      g.add(p);
      obstacles.push({ x, z, r: 1.1 });
    }
  },
  graves(g, obstacles, rand) {
    const stone = mat(0x7a7a74);
    for (let i = 0; i < 18; i++) {
      const { x, z, a } = ringSpot(rand, CLEAR_RADIUS - 2);
      const cross = rand() < 0.4;
      const grave = new THREE.Group();
      if (cross) {
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.3, 0.15), mat(0x4d3a28));
        v.position.y = 0.65;
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.15), mat(0x4d3a28));
        h.position.y = 0.95;
        grave.add(v, h);
      } else {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1 + rand() * 0.4, 0.2), stone);
        slab.position.y = 0.5;
        grave.add(slab);
      }
      const mound = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 1.6), mat(0x4a3d2c));
      mound.position.set(0, 0.1, 0.9);
      grave.add(mound);
      grave.position.set(x, 0, z);
      grave.rotation.y = a + (rand() - 0.5) * 0.3;
      grave.rotation.z = (rand() - 0.5) * 0.12;
      g.add(grave);
    }
  },
  water(g, _obstacles, rand) {
    const a = rand() * Math.PI * 2;
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(8 + rand() * 4, 36),
      mat(0x3d6b80, { roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.88 }),
    );
    pond.rotation.x = -Math.PI / 2;
    // Off to one side, so the middle where the targets stand is dry land you can see them on.
    pond.position.set(Math.sin(a) * 14, 0.04, Math.cos(a) * 14);
    pond.receiveShadow = true;
    g.add(pond);
    const reed = mat(0x6b7a3a);
    for (let i = 0; i < 30; i++) {
      const ra = rand() * Math.PI * 2;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.2 + rand(), 4), reed);
      r.position.set(pond.position.x + Math.sin(ra) * 9, 0.6, pond.position.z + Math.cos(ra) * 9);
      g.add(r);
    }
  },
  campfire(g, obstacles, rand) {
    const a = rand() * Math.PI * 2;
    const x = Math.sin(a) * (CLEAR_RADIUS + 3);
    const z = Math.cos(a) * (CLEAR_RADIUS + 3);
    const fire = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), mat(0x6c6a64));
      s.position.set(Math.sin((i / 8) * Math.PI * 2) * 0.8, 0.15, Math.cos((i / 8) * Math.PI * 2) * 0.8);
      fire.add(s);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 1.1, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8a2a }),
    );
    flame.position.y = 0.55;
    fire.add(flame);
    const light = new THREE.PointLight(0xff9a40, 2.5, 14);
    light.position.y = 1.2;
    fire.add(light);
    fire.position.set(x, 0, z);
    g.add(fire);
    obstacles.push({ x, z, r: 1 });
  },
  huts(g, obstacles, rand) {
    const wall = mat(0x8b7355);
    const roof = mat(0x5e4a2a);
    for (let i = 0; i < 3; i++) {
      const { x, z, a } = ringSpot(rand, CLEAR_RADIUS + 4, PLACE_RADIUS - 3);
      const hut = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3.4), wall);
      base.position.y = 1.3;
      const top = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.4, 4), roof);
      top.position.y = 3.8;
      top.rotation.y = Math.PI / 4;
      hut.add(base, top);
      hut.position.set(x, 0, z);
      hut.rotation.y = a + Math.PI;
      // Collapsed a little: these are somebody's abandoned huts, not the village.
      hut.rotation.z = (rand() - 0.5) * 0.08;
      g.add(hut);
      obstacles.push({ x, z, r: 2.8 });
    }
  },
  mushrooms(g, _obstacles, rand) {
    for (let i = 0; i < 26; i++) {
      const { x, z } = ringSpot(rand, 3);
      const s = 0.2 + rand() * 0.5;
      const m = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s * 2, 0.1 * s * 2, s, 6), mat(0xe8dcc2));
      stem.position.y = s / 2;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.35 * s * 2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        mat(rand() < 0.5 ? 0xb3322a : 0x9a6b3a, { emissive: 0x220a04 }),
      );
      cap.position.y = s;
      m.add(stem, cap);
      m.position.set(x, 0, z);
      g.add(m);
    }
  },
  standing_stones(g, obstacles, rand) {
    const stone = mat(0x6e6d68);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.2;
      const x = Math.sin(a) * (CLEAR_RADIUS + 1);
      const z = Math.cos(a) * (CLEAR_RADIUS + 1);
      const h = 2.5 + rand() * 1.8;
      const s = new THREE.Mesh(new THREE.BoxGeometry(1, h, 0.6), stone);
      s.position.set(x, h / 2, z);
      s.rotation.y = a;
      g.add(s);
      obstacles.push({ x, z, r: 0.7 });
    }
  },
};

/** The place, centred on the origin of its group; the caller moves the group and its obstacles. */
export function buildPlace(spec: PlaceSpec): BuiltPlace {
  const rand = rng(hashString(spec.name + spec.biome));
  const group = new THREE.Group();
  const obstacles: Obstacle[] = [];

  const ground = new THREE.Mesh(new THREE.CircleGeometry(PLACE_RADIUS + 4, 40), mat(spec.groundColor));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.015;
  ground.receiveShadow = true;
  group.add(ground);

  for (const feature of spec.features) FEATURE_BUILDERS[feature](group, obstacles, rand);
  shadowed(group);
  ground.castShadow = false;
  return { group, obstacles };
}

/** One of the quest's monsters, standing on y = 0 and facing +z. */
export function buildEnemy(look: TargetLook): THREE.Group {
  const g = new THREE.Group();
  const body = mat(look.color, { roughness: 0.8 });
  const eyes = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  if (look.shape === 'beast') {
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.4), body);
    torso.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.5), body);
    head.position.set(0, 0.95, 0.85);
    for (const [x, z] of [
      [-0.25, -0.5],
      [0.25, -0.5],
      [-0.25, 0.5],
      [0.25, 0.5],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), body);
      leg.position.set(x, 0.25, z);
      g.add(leg);
    }
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), eyes);
    e.position.set(0, 1.02, 1.11);
    g.add(torso, head, e);
  } else if (look.shape === 'blob') {
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 16, 12),
      mat(look.color, { roughness: 0.3, transparent: true, opacity: 0.85 }),
    );
    blob.scale.y = 0.75;
    blob.position.y = 0.55;
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), eyes);
    e.position.set(0, 0.7, 0.62);
    g.add(blob, e);
  } else {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.45, 4, 10), body);
    torso.position.y = 0.575;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), body);
    head.position.y = 1.38;
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), eyes);
    e.position.set(0, 1.42, 0.2);
    g.add(torso, head, e);
  }
  g.scale.setScalar(look.size);
  return shadowed(g);
}

/** One of the quest's things to pick up, centred at its own origin (the caller floats it). */
export function buildItem(look: TargetLook): THREE.Object3D {
  const glow = { emissive: new THREE.Color(look.color).multiplyScalar(0.5), emissiveIntensity: 0.9 };
  let item: THREE.Object3D;
  if (look.shape === 'flower') {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), mat(0x3f6a2a));
    stem.position.y = -0.2;
    const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat(look.color, glow));
    bloom.position.y = 0.15;
    g.add(stem, bloom);
    item = g;
  } else if (look.shape === 'chest') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.45), mat(0x6b4423)));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.47), mat(look.color, { ...glow, metalness: 0.6 }));
    band.position.y = 0.12;
    g.add(band);
    item = g;
  } else if (look.shape === 'skull') {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), mat(0xe6e0cf, glow)));
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.18), mat(0xe6e0cf));
    jaw.position.set(0, -0.2, 0.08);
    g.add(jaw);
    item = g;
  } else if (look.shape === 'scroll') {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 10), mat(look.color, glow));
    s.rotation.z = Math.PI / 2;
    item = s;
  } else {
    item = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), mat(look.color, glow));
  }
  item.scale.setScalar(look.size);
  return shadowed(item);
}
