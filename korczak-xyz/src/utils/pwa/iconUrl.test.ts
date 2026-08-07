import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconUrl } from './iconUrl';

/** What the browser, the CDN and the service worker all key their caches on. */
const VERSIONED = /^\/icons\/[a-z0-9-]+\.png\?v=[0-9a-f]{8}$/;

describe('iconUrl', () => {
  it('versions every icon the manifest and the touch icon ask for', () => {
    for (const app of ['site', 'tuner', 'songs']) {
      for (const size of ['180', '192', '512', 'maskable']) {
        expect(iconUrl(`${app}-${size}.png`)).toMatch(VERSIONED);
      }
    }
  });

  it('takes the version from the artwork, not from the name', () => {
    // The whole mechanism rests on this: resolve the wrong directory and the URL would still
    // look versioned while being frozen at whatever it hashed instead.
    const bytes = readFileSync(new URL('../../../public/icons/tuner-180.png', import.meta.url));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    expect(iconUrl('tuner-180.png')).toBe(`/icons/tuner-180.png?v=${hash}`);
  });

  it('gives the two apps distinct versions', () => {
    expect(iconUrl('tuner-180.png')).not.toBe(iconUrl('songs-180.png'));
  });

  it('is stable across calls, since every page asks for the same icon', () => {
    expect(iconUrl('songs-512.png')).toBe(iconUrl('songs-512.png'));
  });

  it('fails the build rather than emitting an unversioned URL', () => {
    expect(() => iconUrl('nope-180.png')).toThrow(/npm run icons/);
  });
});
