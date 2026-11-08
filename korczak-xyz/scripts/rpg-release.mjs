#!/usr/bin/env node
/**
 * Turns a `astro build --mode rpg` dist/ into what rpg.korczak.xyz serves.
 *
 * Run by .github/workflows/rpg-release.yml between the build and `wrangler deploy --env rpg`, never
 * on the main site's build. The one change is the front door: `/` on rpg.korczak.xyz is the game,
 * not the homepage, so two redirects go at the TOP of dist/_redirects (first match wins, and these
 * must not lose to anything below them).
 *
 * 302 rather than 301 on purpose. A browser keeps a 301 for ever, and where the front door points
 * is exactly the kind of thing a later release may want to change.
 *
 * The rest of the site is left in dist/ rather than stripped. The game links into it (sign-in, the
 * account page and its key store, the shared layout's assets), so cutting it down to /apps/rpg/
 * would be a list of exceptions that breaks quietly the first time the game links somewhere new.
 * Every page canonicalises to https://korczak.xyz (`site` in astro.config.mjs), so search engines
 * treat the copies here as the duplicates they are.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FRONT_DOOR = [
  '# rpg.korczak.xyz: the front door is the game. Added by scripts/rpg-release.mjs.',
  '/       /apps/rpg/     302',
  '/pl     /pl/apps/rpg/  302',
  '/pl/    /pl/apps/rpg/  302',
  '',
].join('\n');

export function withFrontDoor(redirects) {
  if (redirects.startsWith(FRONT_DOOR)) return redirects;
  return `${FRONT_DOOR}\n${redirects}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = process.argv[2] ?? 'dist';
  if (!existsSync(join(dist, 'apps', 'rpg', 'index.html'))) {
    console.error(`${dist}/apps/rpg/index.html is missing — is this a built dist/?`);
    process.exit(1);
  }
  const file = join(dist, '_redirects');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, withFrontDoor(before));
  console.log(`rpg-release: front door written to ${file}`);
}
