#!/usr/bin/env node
/**
 * Fetches the RPG's surface textures from Poly Haven (CC0, scanned) into
 * `src/assets/rpg/textures/*.webp`. Run from korczak-xyz/:
 *
 *   npm i --no-save sharp
 *   node scripts/rpg-textures.mjs
 *
 * Colour maps only, 512 px WebP: the scene sees them from a third-person camera a few metres up,
 * tiled, and under a tint (`placeBuilder.ts` multiplies a biome's ground colour into its ground),
 * so a normal map or a bigger size would be bytes nobody sees. The output is committed; this is
 * here to make it reproducible and to say where each one came from.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Our name → Poly Haven's asset id. */
const TEXTURES = {
  grass: 'aerial_grass_rock',
  ground: 'forrest_ground_01',
  dirt: 'grass_path_2',
  plaster: 'rough_plasterbrick_05',
  thatch: 'thatch_roof_angled',
  planks: 'brown_planks_03',
  bark: 'bark_brown_02',
  leaves: 'forest_leaves_02',
  rock: 'rock_wall_08',
  stone: 'castle_wall_slates',
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'rpg', 'textures');
await mkdir(out, { recursive: true });

for (const [name, id] of Object.entries(TEXTURES)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const url = files.Diffuse['1k'].jpg.url;
  const jpg = Buffer.from(await (await fetch(url)).arrayBuffer());
  const webp = await sharp(jpg).resize(512, 512).webp({ quality: 78 }).toBuffer();
  await writeFile(join(out, `${name}.webp`), webp);
  console.log(`  ${name}.webp  ${id}  ${(webp.length / 1024).toFixed(0)} kB`);
}
