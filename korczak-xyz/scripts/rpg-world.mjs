#!/usr/bin/env node
/**
 * Builds the RPG's world kits (`src/assets/rpg/village.glb`, `nature.glb`, `props.glb`) from
 * three free Quaternius packs (CC0):
 *
 *   Medieval Village MegaKit   https://quaternius.itch.io/medieval-village-megakit
 *   Stylized Nature MegaKit    https://quaternius.itch.io/stylized-nature-megakit
 *   Fantasy Props MegaKit      https://quaternius.itch.io/fantasy-props-megakit
 *
 * Unzip the three "[Standard]" downloads into one folder and run, from korczak-xyz/:
 *
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 sharp
 *   node scripts/rpg-world.mjs /path/to/that/folder
 *
 * Each kit is one file holding many pieces, so the pieces share their textures (a whole village is
 * five materials). Every piece is a top-level node named after its source file, which is the
 * name `world.ts` asks for; the scene builds houses out of the village's walls, roofs and gables
 * the way the kit is meant to be used. Textures go to 512 px WebP — 1024 for the trees' leaves
 * and bark, which fill most of the screen — and the extra UV sets and vertex colours are dropped.
 */
import { Document } from '@gltf-transform/core';
import { dedup, mergeDocuments, prune, quantize, textureCompress, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, read, stripAttributes } from './rpg-gltf.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/rpg-world.mjs <folder with the three unzipped packs>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'rpg');
await mkdir(out, { recursive: true });

const KITS = {
  village: {
    dir: 'Medieval Village MegaKit[Standard]/glTF',
    big: [],
    pieces: [
      'Wall_Plaster_Straight',
      'Wall_Plaster_WoodGrid',
      'Wall_Plaster_Door_Flat',
      'Wall_Plaster_Window_Wide_Flat',
      'Wall_UnevenBrick_Straight',
      'Wall_UnevenBrick_Window_Wide_Flat',
      'Corner_Exterior_Wood',
      'Corner_Exterior_Brick',
      'Roof_RoundTiles_4x6',
      'Roof_RoundTiles_6x8',
      'Roof_Front_Brick4',
      'Roof_Front_Brick6',
      'Door_1_Flat',
      'Window_Wide_Flat1',
      'WindowShutters_Wide_Flat_Open',
      'Prop_Chimney',
      'Prop_WoodenFence_Single',
      'Prop_Wagon',
      'Floor_UnevenBrick',
    ],
  },
  nature: {
    dir: 'glTF',
    big: ['Pine', 'CommonTree', 'DeadTree'],
    pieces: [
      'Pine_1',
      'Pine_2',
      'Pine_3',
      'CommonTree_1',
      'CommonTree_2',
      'CommonTree_3',
      'DeadTree_1',
      'DeadTree_2',
      'DeadTree_3',
      'Bush_Common',
      'Bush_Common_Flowers',
      'Fern_1',
      'Grass_Common_Short',
      'Grass_Common_Tall',
      'Grass_Wispy_Tall',
      'Flower_3_Group',
      'Rock_Medium_1',
      'Rock_Medium_2',
      'Rock_Medium_3',
      'Mushroom_Common',
    ],
  },
  props: {
    dir: 'Exports/glTF',
    big: [],
    pieces: [
      'Barrel',
      'Crate_Wooden',
      'Bucket_Wooden_1',
      'Bench',
      'Stall_Cart_Empty',
      'Sword_Bronze',
      'Rope_1',
      'Chest_Wood',
    ],
  },
};

for (const [kit, { dir, big, pieces }] of Object.entries(KITS)) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(kit);
  for (const piece of pieces) {
    const part = await read(join(src, dir, `${piece}.gltf`));
    stripAttributes(part);
    const map = mergeDocuments(doc, part);
    // The merged piece arrives as its own scene; gather its roots under one node named for it.
    const holder = doc.createNode(piece);
    for (const s of part.getRoot().listScenes()) {
      const merged = map.get(s);
      for (const child of merged.listChildren()) holder.addChild(child);
      merged.dispose();
    }
    scene.addChild(holder);
  }
  for (const b of doc.getRoot().listBuffers()) if (b !== buffer) b.dispose();
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(buffer);
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      quality: 80,
      resize: big.length ? [1024, 1024] : [512, 512],
      slots: big.length ? /baseColor/ : undefined,
    }),
    ...(big.length ? [textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [512, 512], slots: /^(?!baseColor)/ })] : []),
    quantize(),
    dedup(),
    unpartition(),
    prune(),
  );
  await io.write(join(out, `${kit}.glb`), doc);
  console.log(`  ${kit}.glb`);
}
