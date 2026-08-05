#!/usr/bin/env node
/**
 * Writes dist/sw.js. Runs automatically as npm's `postbuild` hook.
 *
 * This cannot be a static file in public/: the precache list has to name the content-hashed
 * `_astro/*` chunks, and those only exist once Astro has built. It also cannot precache all of
 * them — that would be the whole site — so the shell list is discovered by walking the actual
 * module graph out from the handful of pages the installed apps open at.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(siteDir, 'dist');
const swDir = join(siteDir, 'src', 'sw');

/**
 * The routes the three apps open at. Everything reachable from these is the shell — the tier
 * every visitor gets, so it has to stay small.
 */
const SHELL_ROUTES = ['/', '/pl', '/games/tuner', '/pl/games/tuner', '/songs', '/pl/songs', '/offline'];

/**
 * Precached wholesale. Not the icons: the OS copies those at install time and never asks the
 * page for them again, so caching 100kB of PNGs would buy nothing.
 */
const SHELL_DIRS = ['manifests'];
const SHELL_FILES = ['favicon-32x32.png'];

/**
 * The only tier every visitor gets, so it is deliberately tiny — the fonts, which every page
 * needs anyway, and the page shown when a navigation can be neither reached nor found.
 */
const ESSENTIAL_ROUTES = ['/offline'];
const ESSENTIAL_DIRS = ['fonts'];

async function walk(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

const toUrl = (file) => '/' + relative(distDir, file).split('\\').join('/');

/** `dist/songs/warszawa/index.html` -> `/songs/warszawa`, matching the worker's cache key. */
function routeFor(file) {
  const url = toUrl(file).replace(/\/index\.html$/, '').replace(/\.html$/, '');
  return url === '' ? '/' : url;
}

const ASSET_DIR = '/_astro/';

/**
 * Code, not content. Raster images are deliberately excluded: they are the bulk of the build
 * and neither app needs one to work, so they are left to runtime caching.
 */
const ASSET_EXT = String.raw`(?:js|css|woff2?|svg)`;

/**
 * Follows chunk references out of a file, recursively.
 *
 * The HTML names only the entry points — an island's real dependencies are reached by chunks
 * importing each other, and Vite writes those imports **relative** (`from"./react.CYP4SagT.js"`),
 * so matching only absolute `/_astro/` paths silently misses React itself. An island whose
 * chunk is missing renders nothing at all, and the tuner is `client:only="react"`: for it that
 * is the difference between an app and a permanently blank screen.
 */
async function collectAssets(file, seen, resolveRelative = false) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return;
  }

  const found = new Set();
  for (const [url] of source.matchAll(new RegExp(`${ASSET_DIR}[A-Za-z0-9._-]+\\.${ASSET_EXT}`, 'g'))) {
    found.add(url);
  }
  if (resolveRelative) {
    const relative = new RegExp(`["'(]\\./([A-Za-z0-9._-]+\\.${ASSET_EXT})["')]`, 'g');
    for (const [, name] of source.matchAll(relative)) found.add(ASSET_DIR + name);
  }

  for (const url of found) {
    if (seen.has(url)) continue;
    seen.add(url);
    // Only JS and CSS can pull in further chunks, and only they carry relative imports.
    if (/\.(js|css)$/.test(url)) await collectAssets(join(distDir, url.slice(1)), seen, true);
  }
}

const htmlFiles = (await walk(distDir)).filter((file) => file.endsWith('.html'));
const routeToFile = new Map(htmlFiles.map((file) => [routeFor(file), file]));

// --- shell tier ---------------------------------------------------------------------------
const shellAssets = new Set();
const shellRoutes = [];
for (const route of SHELL_ROUTES) {
  const file = routeToFile.get(route);
  if (!file) {
    console.warn(`  ! no build output for shell route ${route}`);
    continue;
  }
  shellRoutes.push(route);
  await collectAssets(file, shellAssets);
}

const shellStatic = [];
for (const dir of SHELL_DIRS) {
  const files = (await walk(join(distDir, dir))).map(toUrl);
  // These directories are hand-curated, so anything that isn't an asset (the fonts README)
  // is documentation that has no business in a precache.
  shellStatic.push(...files.filter((url) => /\.(woff2?|png|svg|webmanifest)$/.test(url)));
}
for (const name of SHELL_FILES) {
  try {
    await stat(join(distDir, name));
    shellStatic.push('/' + name);
  } catch {
    console.warn(`  ! missing ${name}`);
  }
}

const shellUrls = [...shellRoutes, ...[...shellAssets].sort(), ...shellStatic.sort()];

// --- essential tier -----------------------------------------------------------------------
const essentialUrls = [...ESSENTIAL_ROUTES.filter((route) => routeToFile.has(route))];
for (const dir of ESSENTIAL_DIRS) {
  const files = (await walk(join(distDir, dir))).map(toUrl);
  essentialUrls.push(...files.filter((url) => /\.(woff2?)$/.test(url)).sort());
}

// --- songs tier ---------------------------------------------------------------------------
// The 41 songs in each locale. Their chunks are largely shared with the songs index already in
// the shell; whatever is not gets added here so an offline song page is never half-rendered.
const songAssets = new Set();
const songRoutes = [...routeToFile.keys()]
  .filter((route) => /^(\/pl)?\/songs\/.+/.test(route))
  .sort();
for (const route of songRoutes) await collectAssets(routeToFile.get(route), songAssets);

const songsUrls = [...songRoutes, ...[...songAssets].filter((url) => !shellAssets.has(url)).sort()];

// --- assemble -----------------------------------------------------------------------------
// Leading timestamp so build ids sort chronologically, which is how the worker decides which
// caches are the previous build and worth keeping; the digest makes it specific to this
// content rather than just this moment.
const digest = createHash('sha256')
  .update(JSON.stringify([essentialUrls, shellUrls, songsUrls]))
  .digest('hex')
  .slice(0, 8);
const buildId = `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}-${digest}`;

// `export` is stripped rather than imported: dist/sw.js stays a classic script, which is the
// safest kind to hand to iOS.
const routing = (await readFile(join(swDir, 'routing.js'), 'utf8')).replace(/^export /gm, '');
const body = await readFile(join(swDir, 'sw.template.js'), 'utf8');

const output = `// Generated by scripts/generate-sw.mjs. Edit src/sw/ instead.
const BUILD_ID = ${JSON.stringify(buildId)};
const ESSENTIAL_URLS = ${JSON.stringify(essentialUrls, null, 2)};
const SHELL_URLS = ${JSON.stringify(shellUrls, null, 2)};
const SONGS_URLS = ${JSON.stringify(songsUrls, null, 2)};

${routing}
${body}`;

await writeFile(join(distDir, 'sw.js'), output);

console.log(`sw.js  build ${buildId}`);
console.log(`  essential: ${essentialUrls.length} files`);
console.log(`  shell:     ${shellRoutes.length} routes, ${shellAssets.size} chunks, ${shellStatic.length} static files`);
console.log(`  songs:     ${songRoutes.length} routes, ${songsUrls.length - songRoutes.length} extra chunks`);
