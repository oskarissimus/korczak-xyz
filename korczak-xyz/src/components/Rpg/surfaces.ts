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

/**
 * Frays a ground disc into what lies around it: the disc (a `CircleGeometry`, laid flat, a good
 * deal wider than `outer`) is itself inside `inner` metres and the land around it beyond `outer`,
 * and between them noise over the ground decides, so the edge wanders by several metres, throws
 * tongues and islands outwards and leaves patches of the neighbour inside. A place stood on the
 * world as a perfect disc of one texture, a coin dropped on a tablecloth (owner, 28 Oct 2026: "it
 * has to pass smoothly and irregularly into the surroundings"). `seed` moves the noise, so no two places fray alike; `sharp`
 * keeps the edge as ragged but hard, for an island whose surroundings are water.
 */
export function frayEdge(
  material: THREE.MeshStandardMaterial,
  { inner, outer, seed, sharp = false }: { inner: number; outer: number; seed: number; sharp?: boolean },
): THREE.MeshStandardMaterial {
  material.transparent = true;
  material.depthWrite = false;
  const uniforms = {
    frayInner: { value: inner },
    frayOuter: { value: outer },
    fraySeed: { value: new THREE.Vector2((seed % 997) * 1.37, (seed % 991) * 0.71) },
    fraySoft: { value: sharp ? 0.02 : 0.1 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFrayXY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFrayXY = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vFrayXY;
        uniform float frayInner;
        uniform float frayOuter;
        uniform vec2 fraySeed;
        uniform float fraySoft;
        float frayHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float frayNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(frayHash(i), frayHash(i + vec2(1.0, 0.0)), u.x), mix(frayHash(i + vec2(0.0, 1.0)), frayHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float frayFbm(vec2 p) {
          float s = 0.0;
          float a = 0.5;
          for (int k = 0; k < 4; k++) {
            s += a * frayNoise(p);
            p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03;
            a *= 0.5;
          }
          return s / 0.9375;
        }`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
        {
          // How far across the band, pushed in and out by lobes several metres across and broken up
          // by a finer mottle, so the band is patches of both grounds rather than a gradient.
          float across = (length(vFrayXY) - frayInner) / (frayOuter - frayInner);
          float lobes = frayFbm(vFrayXY * 0.06 + fraySeed) - 0.5;
          float mottle = frayFbm(vFrayXY * 0.32 + fraySeed.yx) - 0.5;
          float v = across + lobes * 1.6 + mottle * 0.55;
          diffuseColor.a *= 1.0 - smoothstep(0.5 - fraySoft, 0.5 + fraySoft, v);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'fray-edge';
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

/**
 * A clump fal.ai drew alone on white (`utils/rpg/groundCover.ts`) as a cut-out: the background
 * taken away where it touches the edge, and where the stems close it in only where it is nearly
 * pure white — so a shaded white flower inside the clump stays — its fringe
 * unblended from the white, and the picture cropped to the clump, so its base is the quad's bottom. A picture whose edge is not mostly that white (a sky,
 * a scene) is refused rather than cut into a card. The see-through pixels take the clump's average colour,
 * or the smaller mipmaps would bleed a white halo around it at a distance — which is why it comes
 * back as pixels, rows bottom first for a `DataTexture`, and not as a canvas: a canvas keeps colour
 * premultiplied and forgets it where alpha is 0. Null if almost nothing
 * is left: a picture that filled its frame or came back empty is no tuft.
 */
export function cutOut(source: CanvasImageSource & { width: number; height: number }): { pixels: ImageData; aspect: number } | null {
  const w = source.width;
  const h = source.height;
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // The background is what the corners are.
  const bg = [0, 0, 0];
  for (const [x, y] of [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ])
    for (let c = 0; c < 3; c++) bg[c] += d[(y * w + x) * 4 + c] / 4;
  const dist = (i: number) => Math.max(Math.abs(d[i * 4] - bg[0]), Math.abs(d[i * 4 + 1] - bg[1]), Math.abs(d[i * 4 + 2] - bg[2]));
  const gone = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (i: number, within: number) => {
    if (!gone[i] && dist(i) < within) {
      gone[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x, 64);
    visit((h - 1) * w + x, 64);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w, 64);
    visit(y * w + w - 1, 64);
  }
  // A picture with a sky or a scene behind its clump has no one background to take away.
  if (stack.length < (w + h) * 2 * 0.6) return null;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) visit(i - 1, 64);
    if (x < w - 1) visit(i + 1, 64);
    if (i >= w) visit(i - w, 64);
    if (i < w * (h - 1)) visit(i + w, 64);
  }
  // And the white the stems close in, which no path from the edge reaches: only the nearly pure
  // white of it, so a shaded white petal keeps its shading.
  for (let i = 0; i < w * h; i++) if (!gone[i] && dist(i) < 24) gone[i] = 1;
  // The fringe, two pixels deep, is clump and white blended: a thin stem is nothing else, and kept
  // as it is a black weed came out silver. So it is unblended against the background — how far
  // from white says how much of the pixel is clump, and the white is taken back out of its colour.
  const touches = (i: number, set: Uint8Array) => {
    const x = i % w;
    return (x > 0 && set[i - 1]) || (x < w - 1 && set[i + 1]) || (i >= w && set[i - w]) || (i < w * (h - 1) && set[i + w]);
  };
  const near = new Uint8Array(gone);
  for (let pass = 0; pass < 2; pass++) {
    const ring: number[] = [];
    for (let i = 0; i < w * h; i++) if (!near[i] && touches(i, near)) ring.push(i);
    for (const i of ring) near[i] = 1;
  }
  const alpha = new Uint8Array(w * h).fill(255);
  for (let i = 0; i < w * h; i++) {
    if (gone[i] || !near[i]) continue;
    const a = Math.min(1, dist(i) / 200);
    if (a < 0.5) {
      gone[i] = 1;
      continue;
    }
    alpha[i] = Math.round(a * 255);
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.max(0, Math.min(255, (d[i * 4 + c] - bg[c] * (1 - a)) / a));
  }
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let kept = 0;
  const avg = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    if (gone[i]) continue;
    kept++;
    for (let c = 0; c < 3; c++) avg[c] += d[i * 4 + c];
    const x = i % w;
    const y = (i / w) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (kept < w * h * 0.02 || kept > w * h * 0.9) return null;
  for (let c = 0; c < 3; c++) avg[c] /= kept;
  for (let i = 0; i < w * h; i++) {
    if (!gone[i]) continue;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = avg[c];
    d[i * 4 + 3] = 0;
  }
  for (let i = 0; i < w * h; i++) if (!gone[i]) d[i * 4 + 3] = alpha[i];
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const pixels = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const from = ((y0 + y) * w + x0) * 4;
    pixels.data.set(d.subarray(from, from + cw * 4), (ch - 1 - y) * cw * 4);
  }
  return { pixels, aspect: cw / ch };
}
