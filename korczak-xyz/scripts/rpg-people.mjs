#!/usr/bin/env node
/**
 * Builds the RPG's generated people's shared files (`src/assets/rpg/people/`) from Meshy rigs:
 *
 *   donor_male.bin, donor_female.bin   a rigged body each: bones, and ~3,000 skinned points
 *   people_clips.json                  the clips every generated person plays, by the game's names
 *
 * `utils/rpg/selfRig.ts` warps a donor onto each TRELLIS person and copies its skin weights, so
 * every person has the donor's 24 bones and rest rotations and the one clip library fits them all.
 *
 * The inputs are Meshy's (fal-ai/meshy/v5/rigging and its animation library, ~$1 once, Oct 2026) and
 * are not committed. Put them in one folder:
 *
 *   lib/rigged.glb        the male donor, the rig the clips were made on (a TRELLIS town guard)
 *   lib/a0.glb, a313, walk, run, a89, a219, a192, a178, a189   one clip each, see CLIPS below
 *   wanderer_meshy.glb    the female donor (a TRELLIS wanderer, Meshy-rigged)
 *
 * and run, from korczak-xyz/:
 *
 *   npm i --no-save playwright
 *   node scripts/rpg-people.mjs /path/to/that/folder
 *
 * It runs in Chromium (Playwright) because three's GLTFLoader and `applyBoneTransform` are the
 * reference for where a skinned vertex is; points closer than 6 mm are merged.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const input = resolve(process.argv[2] ?? '');
const out = resolve('src/assets/rpg/people');
const three = resolve('node_modules/three');

const PAGE = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
// Builds the RPG's people assets from Meshy rigs: two donor bodies and one clip library.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const L = new GLTFLoader(), g = (u) => L.loadAsync(u);

function donor(gltf, voxel) {
  gltf.scene.updateMatrixWorld(true);
  let mesh = null; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const p = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const seen = new Set(), keep = [];
  const v = new THREE.Vector3();
  const pos = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
    const k = \`\${Math.floor(v.x / voxel)},\${Math.floor(v.y / voxel)},\${Math.floor(v.z / voxel)}\`;
    if (seen.has(k)) continue;
    seen.add(k); keep.push(i); pos.push(v.x, v.y, v.z);
  }
  const n = keep.length;
  const idx = new Uint8Array(n * 4), wt = new Uint8Array(n * 4);
  keep.forEach((i, j) => {
    const w = [0, 1, 2, 3].map((a) => sw.getComponent(i, a));
    const sum = w.reduce((s, x) => s + x, 0) || 1;
    let q = w.map((x) => Math.round((x / sum) * 255));
    q[0] += 255 - q.reduce((s, x) => s + x, 0);
    for (let a = 0; a < 4; a++) { idx[j * 4 + a] = si.getComponent(i, a); wt[j * 4 + a] = q[a]; }
  });
  const toMetres = 1 / 100; // Meshy's armature is centimetres under a 0.01 scale
  const json = {
    count: n,
    bones: bones.map((b) => ({
      name: b.name,
      parent: bones.indexOf(b.parent),
      position: b.position.toArray().map((x) => +(x * toMetres).toFixed(5)),
      quaternion: b.quaternion.toArray().map((x) => +x.toFixed(6)),
      world: new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).toArray().map((x) => +x.toFixed(5)),
    })),
  };
  const head = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - ((4 + head.length) % 4)) % 4;
  const buf = new Uint8Array(4 + head.length + pad + n * 12 + n * 8);
  new DataView(buf.buffer).setUint32(0, head.length + pad, true);
  buf.set(head, 4); buf.fill(32, 4 + head.length, 4 + head.length + pad);
  let o = 4 + head.length + pad;
  buf.set(new Uint8Array(new Float32Array(pos).buffer), o); o += n * 12;
  buf.set(idx, o); o += n * 4;
  buf.set(wt, o);
  let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return { b64: btoa(s), n, bytes: buf.length };
}

const CLIPS = { Idle_Loop: 'a0', Idle_Talking_Loop: 'a313', Walk_Loop: 'walk', Jog_Fwd_Loop: 'run', Sword_Idle: 'a89', Sword_Attack: 'a219', Punch_Jab: 'a192', Hit_Chest: 'a178', Death01: 'a189' };
const lib = await g('/in/lib/rigged.glb');
let hipsY = 0; lib.scene.traverse((o) => { if (o.isBone && o.name === 'Hips') hipsY = o.position.y; });
const clips = [];
for (const [name, file] of Object.entries(CLIPS)) {
  const clip = (await g(\`/in/lib/\${file}.glb\`)).animations[0];
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.name.endsWith('.quaternion')) {
      tracks.push({ name: t.name, type: 'quaternion', times: Array.from(t.times, (x) => +x.toFixed(4)), values: Array.from(t.values, (x) => +x.toFixed(4)) });
    } else if (t.name === 'Hips.position') {
      // The hips' height as a share of the rig's own; the clips walk on the spot.
      const values = [];
      for (let i = 0; i < t.values.length; i += 3) values.push(0, +(t.values[i + 1] / hipsY).toFixed(4), 0);
      tracks.push({ name: t.name, type: 'vector', times: Array.from(t.times, (x) => +x.toFixed(4)), values });
    }
  }
  clips.push({ name, duration: +clip.duration.toFixed(4), tracks });
}
window.out = {
  male: donor(lib, 0.006),
  female: donor(await g('/in/wanderer_meshy.glb'), 0.006),
  clips: JSON.stringify(clips),
};
</script></body></html>
`;

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const root = url.startsWith('/three/') ? three : url.startsWith('/in/') ? input : null;
  if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  if (!root) return res.writeHead(404).end();
  try {
    const file = join(root, normalize(url.replace(/^\/(three|in)\//, '')));
    const type = extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction('window.out', null, { timeout: 240000 });
const built = await page.evaluate('window.out');
await writeFile(join(out, 'donor_male.bin'), Buffer.from(built.male.b64, 'base64'));
await writeFile(join(out, 'donor_female.bin'), Buffer.from(built.female.b64, 'base64'));
await writeFile(join(out, 'people_clips.json'), built.clips);
console.log(`male ${built.male.n} points, female ${built.female.n} points, clips ${built.clips.length} bytes`);
await browser.close();
server.close();
