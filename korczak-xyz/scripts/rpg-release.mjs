#!/usr/bin/env node
/**
 * Finishes the dist/ of `astro build --config astro.config.rpg.mjs --mode rpg` (`npm run build:rpg`)
 * into what rpg.korczak.xyz serves, and refuses one that is not only the game.
 *
 * Two jobs:
 *
 * 1. The icons. The game's artwork lives in public/icons/ with every other app's, and iconUrl()
 *    hashes it from there; this site's public dir (`public-rpg/`) has none of it, so the `rpg-*`
 *    files are copied in rather than kept twice in git.
 *
 * 2. The page list. src-rpg/ shares its components with korczak.xyz, and the point of this site is
 *    that nothing else of korczak.xyz comes with them. So dist/ is checked against EXPECTED: a page
 *    that is not on it means the site leaked in, and one that is missing means the game links
 *    somewhere that 404s. Either fails the release before anything is deployed.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED = [
  '404.html',
  'index.html',
  'login/index.html',
  'account/index.html',
  'pl/index.html',
  'pl/login/index.html',
  'pl/account/index.html',
];

/** Every .html under `dir`, relative and with forward slashes. */
export function htmlPages(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** What is wrong with a page list, as sentences; empty when it is exactly the game's. */
export function pageProblems(pages) {
  const have = new Set(pages);
  return [
    ...pages.filter((p) => !EXPECTED.includes(p)).map((p) => `unexpected page ${p}: only the game ships here`),
    ...EXPECTED.filter((p) => !have.has(p)).map((p) => `missing page ${p}`),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? 'dist';
  const icons = new URL('../public/icons/', import.meta.url);
  mkdirSync(join(dist, 'icons'), { recursive: true });
  for (const name of readdirSync(icons)) {
    if (name.startsWith('rpg-')) copyFileSync(new URL(name, icons), join(dist, 'icons', name));
  }
  if (!existsSync(join(dist, 'icons', 'rpg-192.png'))) {
    console.error('rpg-release: public/icons/rpg-*.png are missing');
    process.exit(1);
  }
  const problems = pageProblems(htmlPages(dist));
  if (problems.length > 0) {
    for (const p of problems) console.error(`rpg-release: ${p}`);
    process.exit(1);
  }
  console.log(`rpg-release: ${dist}/ is the game and nothing else (${EXPECTED.length} pages)`);
}
