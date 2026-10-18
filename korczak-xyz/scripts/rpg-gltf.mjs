/**
 * What `rpg-characters.mjs` and `rpg-world.mjs` share: reading Quaternius's .gltf files, whose
 * image names are sometimes wrong, and dropping the attributes three never reads.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Reads a .gltf whose images may be named wrong: the base characters point at
 * `T_Eye_Normal_png.png` and `T_Hair_1_Normal_png.png`, which the pack ships without the `_png`
 * or not at all. A misnamed one is renamed, a missing one is dropped (a normal map, so the
 * material only loses its bumps).
 */
export async function read(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const dir = dirname(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const exists = (uri) => access(join(dir, uri)).then(() => true, () => false);
  const resources = {};
  for (const buffer of json.buffers) resources[buffer.uri] = new Uint8Array(await readFile(join(dir, buffer.uri)));
  const dropped = new Set();
  for (const [i, image] of (json.images ?? []).entries()) {
    if (!(await exists(image.uri)) && (await exists(image.uri.replace('_png.png', '.png')))) {
      image.uri = image.uri.replace('_png.png', '.png');
    }
    if (await exists(image.uri)) resources[image.uri] = new Uint8Array(await readFile(join(dir, image.uri)));
    else dropped.add(i);
  }
  if (dropped.size) {
    const deadTextures = new Set((json.textures ?? []).flatMap((t, i) => (dropped.has(t.source) ? [i] : [])));
    for (const m of json.materials ?? []) {
      if (m.normalTexture && deadTextures.has(m.normalTexture.index)) delete m.normalTexture;
      if (m.occlusionTexture && deadTextures.has(m.occlusionTexture.index)) delete m.occlusionTexture;
    }
  }
  return io.readJSON({ json, resources });
}

/** Drops what three never reads: UV sets past the first, and vertex colours. */
export function stripAttributes(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const name of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1']) {
        if (prim.getAttribute(name)) prim.setAttribute(name, null);
      }
    }
  }
}

