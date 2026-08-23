import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * dist/sw.js is three files concatenated into one classic script (see scripts/generate-sw.mjs).
 * They share one top-level scope, so a name declared in two of them is a SyntaxError — and there
 * is exactly one service worker for every installed app on this origin, so that failure takes the
 * songbook, the tuner and the sleep log offline along with the events app, until the next deploy.
 *
 * Nothing else in the build catches it: the generator concatenates text, and the worker is never
 * parsed until a browser fetches it. So it is parsed here.
 */
const DIR = new URL('.', import.meta.url).pathname;
const read = (name) => readFileSync(`${DIR}${name}`, 'utf8');

/** What the generator does: strip a leading `export `, join in order. */
const PURE = ['routing.js', 'push.js'];
const stripped = PURE.map((name) => read(name).replace(/^export /gm, ''));
const bundle = `${stripped.join('\n')}\n${read('sw.template.js')}`;

describe('the generated service worker', () => {
  it('parses as one classic script', () => {
    // `new Function` parses without executing, so this never touches self, caches or clients.
    expect(() => new Function(bundle)).not.toThrow();
  });

  it('has no import statement left in the inlined halves', () => {
    // Only `export ` is stripped. A surviving `import` is the same SyntaxError by another route,
    // and would mean somebody added a dependency to a file that cannot have one.
    for (const [i, text] of stripped.entries()) {
      expect(text, `${PURE[i]} still imports something`).not.toMatch(/^\s*import\s/m);
    }
  });

  it('declares no name twice across the inlined halves', () => {
    // The check above would already fail on a collision, but this names the culprit instead of
    // reporting "Identifier 'x' has already been declared" with no file attached.
    const namesIn = (text) =>
      [...text.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(
        (m) => m[1],
      );
    const seen = new Map();
    for (const [i, text] of stripped.entries()) {
      for (const name of namesIn(text)) {
        expect(seen.has(name), `${name} is declared in both ${seen.get(name)} and ${PURE[i]}`).toBe(
          false,
        );
        seen.set(name, PURE[i]);
      }
    }
  });

  it('uses the push helpers the template calls', () => {
    // The template calls these by bare name because they are inlined. If push.js stopped exporting
    // one, the worker would throw at push time — the one moment nobody is watching.
    for (const name of ['parsePushPayload', 'notificationOptions', 'pickClientToFocus', 'sameOriginPath']) {
      expect(read('push.js')).toMatch(new RegExp(`export function ${name}\\b`));
      expect(read('sw.template.js')).toContain(name);
    }
  });
});
