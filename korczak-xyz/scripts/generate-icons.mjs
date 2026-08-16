#!/usr/bin/env node
/**
 * Rasterises the home screen icons for the installable web apps.
 *
 *   npm run icons
 *
 * Lives here rather than in the repo-root scripts/ because it needs `sharp`, and ESM resolves
 * imports from the script's own directory - a root-level script cannot see this package's
 * node_modules.
 *
 * Output is committed to git rather than generated during the build: Netlify only runs
 * `astro build`, and making the deploy depend on sharp's native binaries to produce artwork
 * that changes once a year is a bad trade. Re-run this by hand after editing the SVGs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * libvips decides a file is an SVG by looking for `<svg` in its first 1024 bytes, so a header
 * comment long enough to push the tag past that makes the whole file stop being an image. sharp
 * then reports "Input file contains unsupported image format", which sounds like a broken
 * install rather than a comment three lines too long. Say what actually happened.
 */
const SNIFF_LIMIT = 1024;

async function checkSniffable(file) {
  if (!file.endsWith('.svg')) return;
  const head = (await readFile(file)).subarray(0, SNIFF_LIMIT);
  if (head.includes('<svg')) return;
  throw new Error(
    `${file}: the <svg> tag is past the first ${SNIFF_LIMIT} bytes, so libvips does not ` +
      `recognise the file as an SVG. Shorten the header comment.`,
  );
}

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(siteDir, 'public', 'icons');

/** The site's own background, so padding is invisible against the page behind it. */
const NAVY = { r: 0, g: 0, b: 128, alpha: 1 };

/**
 * 180 is the apple-touch-icon iOS actually reads; 192 and 512 are the manifest sizes, with 512
 * doubling as the source for the iOS splash screen.
 */
const SIZES = [180, 192, 512];

/**
 * A maskable icon may be cropped to any shape the platform likes - a circle, a squircle - so
 * everything that matters has to survive inside the middle 80%.
 *
 * There are two ways to satisfy that and the artwork decides which. `inset` shrinks the source
 * and lets navy fill the margin; that is for art with its own square edges, like the site logo,
 * which a circular mask would otherwise clip. `bleed` ships the source unchanged, which is
 * correct for art already drawn full bleed with its subject held away from the edges - shrinking
 * that would paint a navy border around a glossy icon designed to have none, which is the exact
 * square-inside-a-square look these icons were redrawn to escape.
 */
const MASKABLE_SIZE = 512;
const MASKABLE_SAFE = 0.8;

const iconsDir = join(siteDir, 'src', 'assets', 'icons');

const sources = {
  site: { file: join(siteDir, 'public', 'logo.png'), maskable: 'inset' },
  tuner: { file: join(iconsDir, 'tuner.svg'), maskable: 'bleed' },
  songs: { file: join(iconsDir, 'songs.svg'), maskable: 'bleed' },
  fretboard: { file: join(iconsDir, 'fretboard.svg'), maskable: 'bleed' },
  transpose: { file: join(iconsDir, 'transpose.svg'), maskable: 'bleed' },
  'baby-sleep': { file: join(iconsDir, 'baby-sleep.svg'), maskable: 'bleed' },
};

/**
 * SVGs are rasterised at the target size rather than scaled from one render, so the pixel-grid
 * edges stay crisp at every size instead of being resampled from 512.
 */
function render(source, size) {
  return sharp(source, { density: 384 }).resize(size, size, { fit: 'contain', background: NAVY });
}

async function maskable(source, mode) {
  if (mode === 'bleed') return render(source, MASKABLE_SIZE).png();

  const inner = Math.round(MASKABLE_SIZE * MASKABLE_SAFE);
  const artwork = await render(source, inner).png().toBuffer();
  return sharp({
    create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 4, background: NAVY },
  })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png();
}

await mkdir(outDir, { recursive: true });

for (const [app, { file, maskable: mode }] of Object.entries(sources)) {
  await checkSniffable(file);
  for (const size of SIZES) {
    const target = join(outDir, `${app}-${size}.png`);
    await render(file, size).png().toFile(target);
    console.log(`  ${app}-${size}.png`);
  }
  const mask = await maskable(file, mode);
  await writeFile(join(outDir, `${app}-maskable.png`), await mask.toBuffer());
  console.log(`  ${app}-maskable.png`);
}

console.log(`\nWrote ${Object.keys(sources).length * (SIZES.length + 1)} icons to ${outDir}`);
