import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Icon URLs carrying a content hash, so replacing the artwork replaces the URL.
 *
 * `public/_headers` serves `/icons/*` with `max-age=604800`, and that TTL is honoured by
 * Cloudflare's edge as much as by the browser. The filenames are not content-hashed the way
 * `_astro/*` chunks are, so before this the same URL meant different bytes on either side of a
 * deploy - and the edge went on answering with the copy it took first, for up to a week. Purging
 * Safari's own cache does nothing about it: the request is answered before it reaches Netlify.
 * That is how a home screen icon survived new artwork, a redeploy and a full browsing-data wipe.
 *
 * Appending `?v=<hash>` is enough because a query string is part of Cloudflare's cache key (and
 * of the service worker's, and of the browser's), so new artwork simply misses everywhere and
 * the week-long TTL stays worth having on the bytes that really have not changed.
 *
 * Node-only, and imported only from build-time code (`PwaHead.astro` frontmatter and the
 * manifest route). It must never reach the browser - see the note in apps.ts about scope.ts.
 */

/** Resolved once per file: `astro build` renders every page and asks for the same few icons. */
const hashes = new Map<string, string>();

const ICONS_DIR = new URL('../../../public/icons/', import.meta.url);

/**
 * `/icons/<name>?v=<hash>` for a file in `public/icons/`.
 *
 * Throws rather than falling back to an unversioned URL: a missing icon means the artwork was
 * edited without running `npm run icons`, and the whole point here is that a stale URL is not
 * something you find out about later.
 */
export function iconUrl(name: string): string {
  let hash = hashes.get(name);
  if (hash === undefined) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(new URL(name, ICONS_DIR));
    } catch (cause) {
      throw new Error(
        `public/icons/${name} is missing. Run \`npm run icons\` to regenerate it from src/assets/icons/.`,
        { cause },
      );
    }
    hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    hashes.set(name, hash);
  }
  return `/icons/${name}?v=${hash}`;
}
