import { describe, expect, it } from 'vitest';
import {
  cacheName,
  cacheVersion,
  cachesToDelete,
  classifyRequest,
  documentCacheOrder,
  looksLikeDocumentPath,
  normalizePathname,
} from './routing.js';

const get = (overrides) => ({
  method: 'GET',
  mode: 'no-cors',
  destination: 'script',
  cache: 'default',
  sameOrigin: true,
  pathname: '/_astro/chunk.abc123.js',
  ...overrides,
});

describe('normalizePathname', () => {
  it('strips the trailing slash so both spellings of a route share one cache entry', () => {
    expect(normalizePathname('/songs/warszawa/')).toBe('/songs/warszawa');
    expect(normalizePathname('/songs/warszawa')).toBe('/songs/warszawa');
  });

  it('leaves the root as a single slash rather than an empty string', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
  });

  it('collapses repeated trailing slashes', () => {
    expect(normalizePathname('/pl/songs///')).toBe('/pl/songs');
  });
});

describe('classifyRequest', () => {
  it('never touches cross-origin requests', () => {
    // Firestore's streaming connections and YouTube's embeds both land here.
    expect(classifyRequest(get({ sameOrigin: false, pathname: '/v1/projects' }))).toBe('bypass');
  });

  it('never touches non-GET requests', () => {
    expect(classifyRequest(get({ method: 'POST' }))).toBe('bypass');
    expect(classifyRequest(get({ method: 'HEAD' }))).toBe('bypass');
  });

  it("bypasses island-recovery's no-store probe", () => {
    expect(classifyRequest(get({ cache: 'no-store', mode: 'navigate' }))).toBe('bypass');
    expect(classifyRequest(get({ cache: 'reload', mode: 'navigate' }))).toBe('bypass');
  });

  it('bypasses the worker script, so a new version can always land', () => {
    expect(classifyRequest(get({ pathname: '/sw.js' }))).toBe('bypass');
  });

  it('treats navigations as documents however they are labelled', () => {
    expect(classifyRequest(get({ mode: 'navigate', pathname: '/songs' }))).toBe('document');
    expect(classifyRequest(get({ destination: 'document', pathname: '/games/tuner' }))).toBe('document');
  });

  // The soft-navigation case. ClientRouter fetches the next page's markup with a bare fetch(),
  // so nothing about the request says "page" except the path. Served cache-first, an installed
  // songbook went on showing the previous build's lyrics under an unchanged URL.
  it("treats ClientRouter's fetch for a page as a document", () => {
    const softNav = { mode: 'cors', destination: '', cache: 'default' };
    expect(classifyRequest(get({ ...softNav, pathname: '/songs/barka/' }))).toBe('document');
    expect(classifyRequest(get({ ...softNav, pathname: '/pl/songs/barka' }))).toBe('document');
  });

  it("treats Astro's prefetch of a page as a document", () => {
    const prefetch = { mode: 'no-cors', destination: '', cache: 'default' };
    expect(classifyRequest(get({ ...prefetch, pathname: '/songs/barka' }))).toBe('document');
    expect(classifyRequest(get({ ...prefetch, pathname: '/' }))).toBe('document');
  });

  it('treats everything else same-origin as a cache-first asset', () => {
    expect(classifyRequest(get())).toBe('asset');
    expect(classifyRequest(get({ pathname: '/fonts/vt323-v18-latin.woff2' }))).toBe('asset');
    expect(classifyRequest(get({ pathname: '/icons/tuner-180.png' }))).toBe('asset');
    expect(classifyRequest(get({ pathname: '/manifests/songs-pl.webmanifest' }))).toBe('asset');
    expect(classifyRequest(get({ pathname: '/logo.png' }))).toBe('asset');
  });
});

describe('looksLikeDocumentPath', () => {
  it('accepts the routes, which are all extensionless', () => {
    expect(looksLikeDocumentPath('/')).toBe(true);
    expect(looksLikeDocumentPath('/songs')).toBe(true);
    expect(looksLikeDocumentPath('/songs/barka/')).toBe(true);
    expect(looksLikeDocumentPath('/pl/games/tuner')).toBe(true);
    expect(looksLikeDocumentPath('/offline')).toBe(true);
    // A slug may carry a dash; only a dot in the final segment means a file.
    expect(looksLikeDocumentPath('/songs/spider-man')).toBe(true);
  });

  it('rejects anything with a file extension', () => {
    expect(looksLikeDocumentPath('/_astro/chunk.abc123.js')).toBe(false);
    expect(looksLikeDocumentPath('/fonts/vt323-v18-latin.woff2')).toBe(false);
    expect(looksLikeDocumentPath('/manifests/songs-pl.webmanifest')).toBe(false);
    expect(looksLikeDocumentPath('/sw.js')).toBe(false);
  });

  it('is not fooled by a dot in an earlier segment', () => {
    expect(looksLikeDocumentPath('/_astro/chunk.abc123.js/preview')).toBe(true);
  });
});

describe('cacheVersion', () => {
  it('reads the version back out of a name', () => {
    expect(cacheVersion(cacheName('shell', '20260805160245-a1b2c3d4'))).toBe('20260805160245-a1b2c3d4');
  });

  it('returns null for caches that are not ours', () => {
    expect(cacheVersion('workbox-precache-v2')).toBeNull();
    expect(cacheVersion('k95-shell')).toBeNull();
  });
});

describe('documentCacheOrder', () => {
  const names = (version) => ['shell', 'songs', 'runtime'].map((kind) => cacheName(kind, version));
  const older = '20260801090000-aaaaaaaa';
  const previous = '20260803120000-bbbbbbbb';
  const current = '20260805160245-cccccccc';

  it('searches this build before the ones activate retained', () => {
    // caches.match() would do the opposite: creation order, so `older` answers first.
    const order = documentCacheOrder([...names(older), ...names(previous), ...names(current)], current);
    expect(order.slice(0, 3).sort()).toEqual(names(current).sort());
    expect(order.slice(3, 6).sort()).toEqual(names(previous).sort());
    expect(order.slice(6).sort()).toEqual(names(older).sort());
  });

  it('leaves caches belonging to anything else on the origin out entirely', () => {
    expect(documentCacheOrder([...names(current), 'some-other-app-v1'], current)).not.toContain(
      'some-other-app-v1',
    );
  });

  it('still offers the older builds when this one has no cache on disk yet', () => {
    expect(documentCacheOrder(names(previous), current).sort()).toEqual(names(previous).sort());
  });
});

describe('cachesToDelete', () => {
  const names = (version) => ['shell', 'songs', 'runtime'].map((kind) => cacheName(kind, version));
  const older = '20260801090000-aaaaaaaa';
  const previous = '20260803120000-bbbbbbbb';
  const current = '20260805160245-cccccccc';

  it('keeps the current build and the one before it', () => {
    const doomed = cachesToDelete([...names(older), ...names(previous), ...names(current)], current);
    // The grace window: a tab still on the previous build can still resolve its island chunks.
    expect(doomed.sort()).toEqual(names(older).sort());
  });

  it('deletes nothing when only the current build is present', () => {
    expect(cachesToDelete(names(current), current)).toEqual([]);
  });

  it('leaves caches belonging to anything else on the origin alone', () => {
    const doomed = cachesToDelete([...names(older), 'some-other-app-v1'], current);
    expect(doomed).not.toContain('some-other-app-v1');
  });

  it('retains the current build even when it has no cache on disk yet', () => {
    // First activate after a deploy: install may still be filling the shell.
    expect(cachesToDelete(names(previous), current).sort()).toEqual([]);
  });

  it('honours a wider retention window', () => {
    const doomed = cachesToDelete([...names(older), ...names(previous), ...names(current)], current, 3);
    expect(doomed).toEqual([]);
  });
});
