#!/usr/bin/env node
/**
 * Rasterises the home screen icons for the three installable web apps.
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
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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
 * everything that matters has to survive inside the middle 80%. We shrink the artwork and let
 * navy fill the margin rather than redrawing it.
 */
const MASKABLE_SIZE = 512;
const MASKABLE_SAFE = 0.8;

const sources = {
  site: join(siteDir, 'public', 'logo.png'),
  tuner: join(siteDir, 'src', 'assets', 'icons', 'tuner.svg'),
  songs: join(siteDir, 'src', 'assets', 'icons', 'songs.svg'),
};

/**
 * SVGs are rasterised at the target size rather than scaled from one render, so the pixel-grid
 * edges stay crisp at every size instead of being resampled from 512.
 */
function render(source, size) {
  return sharp(source, { density: 384 }).resize(size, size, { fit: 'contain', background: NAVY });
}

async function maskable(source) {
  const inner = Math.round(MASKABLE_SIZE * MASKABLE_SAFE);
  const artwork = await render(source, inner).png().toBuffer();
  return sharp({
    create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 4, background: NAVY },
  })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png();
}

await mkdir(outDir, { recursive: true });

for (const [app, source] of Object.entries(sources)) {
  for (const size of SIZES) {
    const target = join(outDir, `${app}-${size}.png`);
    await render(source, size).png().toFile(target);
    console.log(`  ${app}-${size}.png`);
  }
  await writeFile(join(outDir, `${app}-maskable.png`), await (await maskable(source)).toBuffer());
  console.log(`  ${app}-maskable.png`);
}

console.log(`\nWrote ${Object.keys(sources).length * (SIZES.length + 1)} icons to ${outDir}`);
