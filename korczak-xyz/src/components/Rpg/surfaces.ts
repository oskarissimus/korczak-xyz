/*
 * The scene's surfaces: scanned colour maps from Poly Haven (CC0), 512 px WebP, fetched by
 * `scripts/rpg-textures.mjs`. One image per surface, shared by every material that uses it; a
 * material that tiles it differently gets its own `Texture` over the same image.
 */

import * as THREE from 'three';
import barkUrl from '../../assets/rpg/textures/bark.webp?url';
import dirtUrl from '../../assets/rpg/textures/dirt.webp?url';
import grassUrl from '../../assets/rpg/textures/grass.webp?url';
import groundUrl from '../../assets/rpg/textures/ground.webp?url';
import leavesUrl from '../../assets/rpg/textures/leaves.webp?url';
import planksUrl from '../../assets/rpg/textures/planks.webp?url';
import plasterUrl from '../../assets/rpg/textures/plaster.webp?url';
import rockUrl from '../../assets/rpg/textures/rock.webp?url';
import stoneUrl from '../../assets/rpg/textures/stone.webp?url';
import thatchUrl from '../../assets/rpg/textures/thatch.webp?url';

const URLS = {
  bark: barkUrl,
  dirt: dirtUrl,
  grass: grassUrl,
  ground: groundUrl,
  leaves: leavesUrl,
  planks: planksUrl,
  plaster: plasterUrl,
  rock: rockUrl,
  stone: stoneUrl,
  thatch: thatchUrl,
};
export type Surface = keyof typeof URLS;

const loader = new THREE.TextureLoader();
const base = new Map<Surface, THREE.Texture>();
/** Every texture over a surface's image, to be re-uploaded when the image arrives. */
const copies = new Map<Surface, THREE.Texture[]>();
/**
 * Each tiling is its own GPU texture, so they are kept by tiling rather than made per mesh: a
 * place's twenty graves share one, and taking the place down disposes none of them.
 */
const tilings = new Map<string, THREE.Texture>();
const loaded = new Set<Surface>();

/** A tiling colour map; `repeat` times across a face's UVs in each direction. */
export function surface(name: Surface, repeatX = 1, repeatY = repeatX): THREE.Texture {
  let tex = base.get(name);
  if (!tex) {
    copies.set(name, []);
    tex = loader.load(URLS[name], () => {
      loaded.add(name);
      for (const t of copies.get(name)!) t.needsUpdate = true;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    base.set(name, tex);
  }
  if (repeatX === 1 && repeatY === 1) return tex;
  const key = `${name}:${repeatX.toFixed(2)}:${repeatY.toFixed(2)}`;
  const known = tilings.get(key);
  if (known) return known;
  // A clone shares the image and keeps its own repeat.
  const t = tex.clone();
  tilings.set(key, t);
  t.repeat.set(repeatX, repeatY);
  if (loaded.has(name)) t.needsUpdate = true;
  else copies.get(name)!.push(t);
  return t;
}

/** A rough surface material: the map, optionally tinted (the biome's ground colour, say). */
export function surfaceMat(
  name: Surface,
  repeatX = 1,
  repeatY = repeatX,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: surface(name, repeatX, repeatY), roughness: 0.95, ...extra });
}
