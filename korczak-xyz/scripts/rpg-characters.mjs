#!/usr/bin/env node
/**
 * Builds the RPG's people (`src/assets/rpg/*.glb`) from three free Quaternius packs (CC0):
 *
 *   Modular Character Outfits - Fantasy   https://quaternius.itch.io/modular-character-outfits-fantasy
 *   Universal Base Characters             https://quaternius.itch.io/universal-base-characters
 *   Universal Animation Library           https://quaternius.itch.io/universal-animation-library
 *
 * Unzip the three "[Standard]" downloads into one folder and run, from korczak-xyz/:
 *
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 sharp
 *   node scripts/rpg-characters.mjs /path/to/that/folder
 *
 * Not a build step: the packs are ~500 MB of 4K PNGs and the output is committed. What this does
 * is make that output reproducible, and say what was cut to get it from 500 MB to a few:
 *
 * - textures to 1024 (colour) and 512 (normal, ORM, skin), WebP;
 * - the extra UV sets and vertex colours the packs carry for Unreal, which three never reads;
 * - the base characters' bodies cut down to head and neck (`head_*.glb`) — the outfits bring
 *   their own arms, hands and legs, and a whole body under them shows through at the seams.
 *   One full body is kept (`body_male.glb`) for the things that walk about with nothing on;
 * - from the animation library, the clips the game plays and nothing else, and of each clip
 *   only rotations plus the pelvis's translation: every other bone's translation is constant,
 *   and keeping 65 of them per clip was most of the file.
 *
 * Every file shares one skeleton (same 65 bone names), which is what lets `characters.ts` put
 * an outfit, a head and hair on one rig at run time.
 */
import { dedup, prune, quantize, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, read, stripAttributes } from './rpg-gltf.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/rpg-characters.mjs <folder with the three unzipped packs>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'rpg');
await mkdir(out, { recursive: true });

const OUTFITS = join(src, 'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits');
const BASE = join(src, 'Universal Base Characters[Standard]/Base Characters/Godot - UE');
const HAIR = join(src, 'Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)');
const ANIM = join(src, 'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb');

/** What the scene plays (`characters.ts` names them). */
const CLIPS = [
  'Idle_Loop',
  'Idle_Talking_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Sword_Idle',
  'Sword_Attack',
  'Punch_Jab',
  'Hit_Chest',
  'Death01',
  'Jump_Start',
  'Jump_Loop',
  'Jump_Land',
];

async function shrink(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512] }),
    quantize(),
    dedup(),
    prune(),
  );
}

/** Colour maps keep 1024: they are what reads at the distance a face is seen from. */
async function shrinkColour(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024], slots: /baseColor/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [512, 512], slots: /^(?!baseColor)/ }),
    quantize(),
    dedup(),
    prune(),
  );
}

/**
 * Keeps only the triangles skinned mostly to the neck and head, and the eyes and eyebrows: a
 * head to sit in an outfit's collar.
 */
function cutToHead(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints().map((j) => j.getName());
  const keep = new Set(['neck_01', 'Head'].map((n) => joints.indexOf(n)));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      const index = prim.getIndices();
      const dominant = (v) => {
        const j = J.getElement(v, []);
        const w = W.getElement(v, []);
        let best = 0;
        for (let i = 1; i < 4; i++) if (w[i] > w[best]) best = i;
        return j[best];
      };
      const kept = [];
      for (let t = 0; t < index.getCount(); t += 3) {
        const tri = [index.getScalar(t), index.getScalar(t + 1), index.getScalar(t + 2)];
        if (tri.every((v) => keep.has(dominant(v)))) kept.push(...tri);
      }
      index.setArray(new Uint32Array(kept));
    }
  }
}

async function part(file, name, { head = false } = {}) {
  const doc = await read(file);
  stripAttributes(doc);
  if (head) cutToHead(doc);
  await shrinkColour(doc);
  await io.write(join(out, `${name}.glb`), doc);
  console.log(`  ${name}.glb`);
}

for (const outfit of ['Male_Ranger', 'Male_Peasant', 'Female_Ranger', 'Female_Peasant']) {
  await part(join(OUTFITS, `${outfit}.gltf`), outfit.toLowerCase());
}
await part(join(BASE, 'Superhero_Male_FullBody.gltf'), 'head_male', { head: true });
await part(join(BASE, 'Superhero_Female_FullBody.gltf'), 'head_female', { head: true });
await part(join(BASE, 'Superhero_Male_FullBody.gltf'), 'body_male');
for (const hair of ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard', 'Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale']) {
  const doc = await read(join(HAIR, `${hair}.gltf`));
  stripAttributes(doc);
  await shrink(doc);
  await io.write(join(out, `${hair.toLowerCase()}.glb`), doc);
  console.log(`  ${hair.toLowerCase()}.glb`);
}

// The animations: the skeleton and the clips, no mesh.
{
  const doc = await io.read(ANIM);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (!CLIPS.includes(anim.getName())) {
      for (const sampler of anim.listSamplers()) sampler.dispose();
      anim.dispose();
      continue;
    }
    for (const channel of anim.listChannels()) {
      const path = channel.getTargetPath();
      const node = channel.getTargetNode()?.getName();
      if (path === 'scale' || (path === 'translation' && node !== 'pelvis')) {
        channel.getSampler()?.dispose();
        channel.dispose();
      }
    }
  }
  for (const node of root.listNodes()) node.setMesh(null);
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  await doc.transform(prune({ keepLeaves: true }), dedup());
  await io.write(join(out, 'animations.glb'), doc);
  console.log('  animations.glb');
}
