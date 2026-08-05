import { describe, expect, it } from 'vitest';
import { cacheName, cacheVersion, cachesToDelete, classifyRequest, normalizePathname } from './routing.js';

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

  it('treats everything else same-origin as a cache-first asset', () => {
    expect(classifyRequest(get())).toBe('asset');
    expect(classifyRequest(get({ pathname: '/fonts/vt323-v18-latin.woff2' }))).toBe('asset');
    expect(classifyRequest(get({ pathname: '/icons/tuner-180.png' }))).toBe('asset');
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
