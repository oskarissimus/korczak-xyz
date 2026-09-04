import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * This directory is compiled twice, exactly as `src/utils/events/` is: by Astro for the browser and
 * by `tsc` into the Cloud Functions bundle. That is what guarantees the collector and the app answer
 * "does this communiqué touch my route?" identically — a copy would be identical only until the
 * first bug fix.
 *
 * One allowance the events directory does not make: these modules may import from `../events/`.
 * That is not a loophole, it is the same rule applied twice — everything in that directory is
 * proven portable by its own copy of this test, so importing from it cannot smuggle in a DOM global
 * or a Firestore client. It is how `foldText` and `slugKey` are shared rather than written a second
 * time, which this repo's own reasoning says would only stay identical until the first bug fix.
 *
 * `functions/tsconfig.json` includes both directories by path with a single `*`, and `readdirSync`
 * does not recurse, so `browser/` is out of both by construction rather than by a list.
 */
const DIR = new URL('.', import.meta.url).pathname;

const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('src/utils/transit stays portable', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  /*
   * The other half of being portable, and the half a runner discovers rather than a reader: Vite
   * resolves a tsconfig by walking UP from the file it transforms, so without one of our own that
   * walk reaches korczak-xyz/tsconfig.json and its `extends: "astro/tsconfigs/strict"` — which
   * resolves only where the site's node_modules are installed, and on the functions' CI runner
   * they are not. The transit directory shipped without this file and took a whole deploy down
   * with `Failed to load tsconfig 'astro/tsconfigs/strict': Tsconfig not found`, so it is asserted
   * here rather than remembered.
   */
  it('carries a tsconfig that stops the resolver walking out of the directory', () => {
    const text = readFileSync(join(DIR, 'tsconfig.json'), 'utf8');
    expect(
      /"extends"\s*:/.test(text),
      'tsconfig.json here must extend nothing: whatever it reached for would have to be ' +
        'installed wherever these modules are compiled, and the runner that builds the Cloud ' +
        'Functions installs only functions/package.json.',
    ).toBe(false);
  });

  it.each(sources)('%s imports only siblings or the events directory', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');
    const specifiers = [...text.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/gm)].map(
      (m) => m[1],
    );
    for (const spec of specifiers) {
      expect(
        spec.startsWith('./') || spec.startsWith('../events/'),
        `${file} imports '${spec}'. Everything in src/utils/transit must be reachable from the ` +
          `Cloud Functions build, so it may only import './siblings' or '../events/…', which is ` +
          `itself portable — no firebase, no React, no node builtins.`,
      ).toBe(true);
    }
  });

  it.each(sources)('%s does not reach for a browser or Node global', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'localStorage', 'process', 'import.meta']) {
      expect(text.includes(banned), `${file} references \`${banned}\``).toBe(false);
    }
  });
});
