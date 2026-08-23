import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PWA_APPS } from './apps';
import { appForPath, type PwaApp } from './scope';

/**
 * The precache tiers are described in three places that cannot import each other:
 *
 * - `scope.ts` — which app a path belongs to, for the manifest and for ClientRouter
 * - `scripts/generate-sw.mjs` — which routes go into which tier, at build time
 * - `src/scripts/register-sw.js` — which tier a launching page asks for; inlined into <head>
 *   as a classic script, so it can import neither of the others
 *
 * Disagreement between them is silent and one-sided. A tier the page asks for but the
 * generator never wrote is a no-op, so an installed app quietly has no offline pages at all;
 * a tier written but never asked for is dead weight in every build. Neither shows up until
 * someone puts a phone in aeroplane mode.
 *
 * So they are read here as text and compared on behaviour rather than on spelling.
 */
const registerSw = readFileSync(new URL('../../scripts/register-sw.js', import.meta.url), 'utf8');
const generateSw = readFileSync(new URL('../../../scripts/generate-sw.mjs', import.meta.url), 'utf8');

function registerTiers(): Array<{ tier: string; pattern: RegExp }> {
  const block = registerSw.match(/var APP_TIERS = \[([\s\S]*?)\];/);
  expect(block, 'APP_TIERS not found in register-sw.js').toBeTruthy();
  return [...block![1].matchAll(/\{ tier: '([^']+)', pattern: (\/.+?\/) \}/g)].map(([, tier, src]) => ({
    tier,
    pattern: new RegExp(src.slice(1, -1)),
  }));
}

function generatorTiers(): Array<{ tier: string; pattern: RegExp }> {
  const block = generateSw.match(/const APP_TIERS = \{([\s\S]*?)\n\};/);
  expect(block, 'APP_TIERS not found in generate-sw.mjs').toBeTruthy();
  return [...block![1].matchAll(/^\s*'?([a-z-]+)'?: (\/.+?\/),$/gm)].map(([, tier, src]) => ({
    tier,
    pattern: new RegExp(src.slice(1, -1)),
  }));
}

describe('precache tiers', () => {
  it('finds the tier lists in both scripts', () => {
    expect(registerTiers().length).toBeGreaterThan(0);
    expect(generatorTiers().length).toBeGreaterThan(0);
  });

  it('names the same tiers on both sides', () => {
    const asked = registerTiers().map((t) => t.tier);
    const written = generatorTiers().map((t) => t.tier);
    expect(asked.slice().sort()).toEqual(written.slice().sort());
  });

  it('names only real apps, so a tier can never outlive the app it caches', () => {
    for (const { tier } of registerTiers()) {
      expect(Object.keys(PWA_APPS)).toContain(tier);
    }
  });

  it('asks for the tier of whichever app the launching page belongs to', () => {
    // The page can only route by path — it has no access to scope.ts — so this is the one
    // thing that has to agree exactly: same answer as appForPath, for every app with a tier.
    const tiers = registerTiers();
    const withTier = new Set(tiers.map((t) => t.tier));
    const paths = [
      '/', '/pl', '/about', '/apps', '/apps/tuner', '/pl/apps/tuner', '/songsheets',
      '/songs', '/songs/warszawa', '/pl/songs', '/pl/songs/arahja/',
      '/apps/flashcards', '/apps/flashcards/neck', '/pl/apps/flashcards/chords',
      // The routes the merged app replaced belong to no app and must ask for no tier.
      '/apps/fretboard', '/apps/transpose',
      '/apps/baby-sleep', '/apps/baby-sleep/share', '/pl/apps/baby-sleep/stats',
      '/apps/events', '/apps/events/interests', '/pl/apps/events/alerts',
    ];
    for (const path of paths) {
      const asked = tiers.filter((t) => t.pattern.test(path)).map((t) => t.tier);
      const app: PwaApp = appForPath(path);
      expect(asked, `tier asked for by ${path}`).toEqual(withTier.has(app) ? [app] : []);
    }
  });

  it('has the generator claim each app subtree, bar the songbook index', () => {
    // Everything else caches its own landing page; /songs is already in the shell, so the
    // songs tier is the 82 song pages alone. If that ever changes, the index is cached twice.
    const byTier = new Map(generatorTiers().map((t) => [t.tier, t.pattern]));
    expect(byTier.get('songs')!.test('/songs')).toBe(false);
    expect(byTier.get('songs')!.test('/songs/warszawa')).toBe(true);
    expect(byTier.get('flashcards')!.test('/apps/flashcards')).toBe(true);
    expect(byTier.get('flashcards')!.test('/pl/apps/flashcards/neck')).toBe(true);
    expect(byTier.get('baby-sleep')!.test('/apps/baby-sleep')).toBe(true);
    expect(byTier.get('baby-sleep')!.test('/pl/apps/baby-sleep/share')).toBe(true);
    expect(byTier.get('events')!.test('/apps/events')).toBe(true);
    expect(byTier.get('events')!.test('/pl/apps/events/alerts')).toBe(true);
  });
});
