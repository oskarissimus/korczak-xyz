/*
 * Service worker body. Not shipped as-is: scripts/generate-sw.mjs prepends BUILD_ID and the
 * precache lists (which name content-hashed chunks that only exist after a build), inlines
 * routing.js, and writes the result to dist/sw.js.
 *
 * There is exactly one worker for all three installable apps, because iOS shares a single
 * registration and one CacheStorage across Safari and every home screen icon on the origin.
 * That is also why the song corpus is a separate, opt-in tier: a visitor who merely opens
 * korczak.xyz in Safari must not be made to download the whole songbook.
 */

const ESSENTIAL_CACHE = cacheName('essential', BUILD_ID);
const SHELL_CACHE = cacheName('shell', BUILD_ID);
const SONGS_CACHE = cacheName('songs', BUILD_ID);
const RUNTIME_CACHE = cacheName('runtime', BUILD_ID);

/**
 * Precache tiers, cheapest first. Only the essential tier runs unprompted; the other two are
 * requested by register-sw.js once it knows the page is running as an installed app.
 *
 * The reason is the navbar's auth island, which drags in the whole Firebase SDK — over half a
 * megabyte, on every page. That is a fair price for an app someone deliberately installed and
 * expects to work on a dead network, and an unreasonable one to charge a visitor who opened
 * korczak.xyz once in Safari. The worker cannot tell those two apart, because iOS gives them
 * the same registration; the page can.
 */
const TIERS = {
  essential: { cache: () => ESSENTIAL_CACHE, urls: () => ESSENTIAL_URLS },
  shell: { cache: () => SHELL_CACHE, urls: () => SHELL_URLS },
  songs: { cache: () => SONGS_CACHE, urls: () => SONGS_URLS },
};

const OFFLINE_URL = '/offline';

/**
 * How long a document waits for the network before falling back to cache. Long enough to win
 * on a normal connection, short enough that a dead one does not hold a launching app on a
 * blank screen.
 */
const DOCUMENT_TIMEOUT_MS = 2500;

/**
 * Stores a response with the transport headers stripped.
 *
 * `fetch` hands back a *decoded* body but keeps the headers that described the bytes on the
 * wire. Put that straight into a cache and what comes out later is a body of plain JavaScript
 * wearing `content-encoding: gzip` — and the browser dutifully tries to gunzip it and fails,
 * so every module script and font on the page dies with a decoding error while the cache
 * looks perfectly healthy from the outside. `transfer-encoding: chunked` is hop-by-hop and has
 * no business surviving either. Both Netlify and `astro preview` compress, so this is not a
 * dev-only concern.
 */
async function cachePut(cache, key, response) {
  const headers = new Headers();
  const type = response.headers.get('content-type');
  if (type) headers.set('content-type', type);
  const body = await response.blob();
  await cache.put(key, new Response(body, { status: 200, statusText: 'OK', headers }));
}

/**
 * Fills a cache without letting one bad response fail the rest. `cache.addAll` is atomic, so
 * a single 404 or a flaky hop would abort the whole precache and the worker would never
 * activate; a partial shell that runtime caching tops up later is the better failure.
 */
async function precache(cache, urls) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      await cachePut(cache, url, response);
    }),
  );
  return results.filter((result) => result.status === 'rejected').length;
}

/** Fills a tier, skipping the work if a previous launch already did it for this build. */
async function precacheTier(name) {
  const tier = TIERS[name];
  if (!tier) return;
  const urls = tier.urls();
  const cache = await caches.open(tier.cache());
  const already = await cache.keys();
  if (already.length >= urls.length) return;
  await precache(cache, urls);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precacheTier('essential');
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(cachesToDelete(names, BUILD_ID).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/**
 * register-sw.js names the tiers it wants once it has established that this page is an
 * installed app, and which one.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PRECACHE' || !Array.isArray(data.tiers)) return;
  event.waitUntil(
    (async () => {
      // Sequential, not parallel: the songs tier is 82 requests and must not race the shell
      // the app needs to render at all.
      for (const tier of data.tiers) await precacheTier(tier);
    })(),
  );
});

/** The cache key for a page: normalized, and without the fragment. */
function documentKey(url) {
  return new URL(normalizePathname(url.pathname) + url.search, self.location.origin).href;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Network-first. The alternative — serving one app shell for every navigation — breaks
 * ClientRouter, which fetches the next page's real markup and swaps it in. Going to the
 * network first also guarantees that an online visitor's HTML matches the chunk hashes of
 * whatever was deployed most recently.
 */
async function handleDocument(request, url) {
  const key = documentKey(url);
  try {
    const response = await withTimeout(fetch(request), DOCUMENT_TIMEOUT_MS);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cachePut(cache, key, response.clone());
      return response;
    }
    // A real 404 is an answer. Don't mask it with a stale copy.
    return response;
  } catch {
    // caches.match searches every cache, including the previous build's, which is what makes
    // the retention grace window useful rather than just harmless.
    const cached = await caches.match(key);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return Response.error();
  }
}

/** Cache-first. Everything here is either content-hashed or versioned by the cache name. */
async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cachePut(cache, request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const kind = classifyRequest({
    method: request.method,
    mode: request.mode,
    destination: request.destination,
    cache: request.cache,
    sameOrigin: url.origin === self.location.origin,
    pathname: url.pathname,
  });

  if (kind === 'bypass') return;
  event.respondWith(kind === 'document' ? handleDocument(request, url) : handleAsset(request));
});
