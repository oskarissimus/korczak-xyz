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

/**
 * Hides a tiled ground's repeat: the map is sampled twice, at its own scale and at a third of it
 * turned and offset, and a very large, slow sample of the same map decides which shows where and
 * how light the patch is. Seventy tiles of one 512 px scan read as a chessboard from a hill
 * (owner, Oct 2026: "the grass makes a strange effect, you can see how repetitive it is").
 */
export function breakTiling(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 uvA = vMapUv;
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + vec2(0.31, 0.77);
        float macro = texture2D(map, vMapUv * 0.031).g;
        float macro2 = texture2D(map, vMapUv * 0.0071 + vec2(0.5)).r;
        vec4 a = texture2D(map, uvA);
        vec4 b = texture2D(map, uvB);
        float k = smoothstep(0.35, 0.65, macro * 0.6 + macro2 * 0.8 - 0.2);
        vec4 sampledDiffuseColor = mix(a, b, k);
        sampledDiffuseColor.rgb *= 0.82 + 0.36 * macro2;
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'break-tiling';
  return material;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Makes a picture tile: each edge is crossfaded into the picture rolled by half, whose edges are
 * the picture's own middle and so meet across the wrap; across, then down, so the second pass
 * keeps the first's seam closed. `band` is how much of each half fades, from the edge in. FLUX
 * asked for a seamless ground draws one that nearly is, and its cracks stopping dead at every edge
 * drew a grid over the map (Oct 2026).
 */
export function seamless(source: CanvasImageSource, size = 1024, band = 0.35): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const half = size >> 1;
  const weight = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const d = Math.abs((i + 0.5) / size - 0.5) * 2;
    weight[i] = smooth(Math.min(1, Math.max(0, (d - (1 - band)) / band)));
  }
  for (const across of [true, false]) {
    const a = img.data.slice();
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const w = across ? weight[x] : weight[y];
        if (w === 0) continue;
        const sx = across ? (x + half) % size : x;
        const sy = across ? y : (y + half) % size;
        const o = (y * size + x) * 4;
        const s = (sy * size + sx) * 4;
        for (let c = 0; c < 3; c++) img.data[o + c] = a[o + c] * (1 - w) + a[s + c] * w;
      }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
