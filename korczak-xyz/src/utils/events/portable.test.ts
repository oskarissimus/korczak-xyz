import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * This directory is compiled twice: once by Astro for the browser, and once by `tsc` into the
 * Cloud Functions bundle (see functions/tsconfig.json, which includes it by path rather than
 * keeping a copy). That is what guarantees the feed and the collector answer "does this event
 * match this interest?" identically — a copy would only be identical until the first bug fix.
 *
 * The price is that nothing here may reach for anything the other runtime lacks. A single
 * `import { getDb } from '../../lib/firebase'` breaks the functions build, and it breaks it at
 * deploy time, in a place that does not obviously point back here. So the rule is checked rather
 * than remembered — the same reason tiers.test.ts reads two scripts as text.
 *
 * Test files are exempt: they run only under vitest, and functions/tsconfig.json excludes them.
 * So is the `browser/` subdirectory, which exists precisely to hold the modules that cannot obey
 * this rule — localStorage, the logger, the Firestore client. `readdirSync` does not recurse, and
 * functions/tsconfig.json includes `events/*.ts` rather than `**`, so the two agree by
 * construction rather than by a list somebody has to maintain.
 */
const DIR = new URL('.', import.meta.url).pathname;

const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('src/utils/events stays portable', () => {
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

  it.each(sources)('%s imports nothing outside this directory', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');
    const specifiers = [...text.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/gm)].map(
      (m) => m[1],
    );
    for (const spec of specifiers) {
      expect(
        spec.startsWith('./'),
        `${file} imports '${spec}'. Everything in src/utils/events must be reachable from the ` +
          `Cloud Functions build, so it may only import './siblings' — no firebase, no React, ` +
          `no node builtins, no cross-directory relative paths.`,
      ).toBe(true);
    }
  });

  it.each(sources)('%s does not reach for a browser or Node global', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8')
      // Strip comments: these names are discussed in prose all over this directory.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['window', 'document', 'localStorage', 'process', 'import.meta']) {
      expect(text.includes(banned), `${file} references \`${banned}\``).toBe(false);
    }
  });
});
