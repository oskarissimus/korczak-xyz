/*
 * Service worker body. Not shipped as-is: scripts/generate-sw.mjs prepends BUILD_ID and the
 * precache lists (which name content-hashed chunks that only exist after a build), inlines
 * routing.js, and writes the result to dist/sw.js.
 *
 * There is exactly one worker for every installable app on the origin, because iOS shares a
 * single registration and one CacheStorage across Safari and every home screen icon. That is
 * also why everything past the essentials is an opt-in tier: a visitor who merely opens
 * korczak.xyz in Safari must not be made to download the whole songbook, and an installed
 * songbook must not be made to download the other apps.
 */

const RUNTIME_CACHE = cacheName('runtime', BUILD_ID);

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
 * no business surviving either. Both Cloudflare and `astro preview` compress, so this is not a
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

/**
 * Fills a tier, skipping the work if a previous launch already did it for this build.
 *
 * `TIER_URLS` is written by the generator: `essential`, `shell`, and one named after each
 * installable app. Only `essential` runs unprompted; the rest are requested by register-sw.js
 * once it knows the page is running as an installed app, and which one. The reason is the
 * navbar's auth island, which drags in the whole Firebase SDK — over half a megabyte, on every
 * page. That is a fair price for an app someone deliberately installed and expects to work on
 * a dead network, and an unreasonable one to charge a visitor who opened korczak.xyz once in
 * Safari. The worker cannot tell those two apart, because iOS gives them the same
 * registration; the page can.
 *
 * Each tier gets a cache of its own named after it, which is what keeps the apps separable —
 * see cacheVersion in routing.js for what a hyphen in one of those names costs.
 */
async function precacheTier(name) {
  const urls = TIER_URLS[name];
  // A page from a previous build can name a tier this worker no longer has. Nothing to do.
  if (!urls) return;
  const cache = await caches.open(cacheName(name, BUILD_ID));
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
      // Sequential, not parallel, and register-sw.js lists the shell first: the songs tier is
      // 82 requests and must not race the shell the app needs to render at all.
      for (const tier of data.tiers) await precacheTier(tier);
    })(),
  );
});

/** The cache key for a page: normalized, and without the fragment. */
function documentKey(url) {
  return new URL(normalizePathname(url.pathname) + url.search, self.location.origin).href;
}

/**
 * Reads a page out of the caches, this build's first.
 *
 * Not `caches.match(key)`: that searches in creation order, so the previous build retained by
 * `activate` answers before the current one. Harmless for hashed assets, wrong for a document.
 */
async function matchDocument(key) {
  for (const name of documentCacheOrder(await caches.keys(), BUILD_ID)) {
    const cache = await caches.open(name);
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  return undefined;
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
    // Falls back through the previous build's caches too, which is what makes the retention
    // grace window useful rather than just harmless — but only after this build's.
    const cached = await matchDocument(key);
    if (cached) return cached;
    const offline = await matchDocument(OFFLINE_URL);
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
    // HTML is never stored here, whatever the request called itself. Cache-first is safe only
    // for a URL whose bytes cannot change under it, and a page is the opposite of that: stored
    // once, it is served past every deploy until its cache is swept. Misrouting a page should
    // cost one stale render, not a permanently wrong entry.
    const isPage = (response.headers.get('content-type') || '').startsWith('text/html');
    if (response.ok && !isPage) {
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

/**
 * Push.
 *
 * Exactly one shape, with no early return and no branch that can skip showNotification: **iOS
 * unsubscribes the app if a push event completes without showing a notification**, and it does so
 * silently — the next thing anyone notices is that notifications stopped working a month ago. So
 * `parsePushPayload` is total (see push.js) and this handler never asks whether the payload was
 * any good.
 *
 * The tag is the notice id, which also makes this idempotent against Declarative Web Push: on
 * Safari 18.4+ the OS renders the payload's own `notification` object before this runs, and a
 * showNotification with the same tag replaces that banner instead of adding a second one.
 */
self.addEventListener('push', (event) => {
  let text = '';
  try {
    text = event.data ? event.data.text() : '';
  } catch {
    // Not decodable as text. The defaults stand; showing something generic beats showing nothing.
  }
  const payload = parsePushPayload(text);
  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions(payload)),
  );
});

/**
 * Opening what the notification was about.
 *
 * One worker serves every installed app on this origin, so `matchAll` hands back the songbook's
 * window as readily as this app's — `pickClientToFocus` is what keeps a tap from focusing the
 * wrong app. The payload carries a path rather than a URL, and `sameOriginPath` has already
 * reduced it to one, so nothing here can navigate off-origin.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = sameOriginPath(data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const index = pickClientToFocus(
        windows.map((client) => client.url),
        path,
      );
      if (index === null) {
        await self.clients.openWindow(path);
        return;
      }
      const client = windows[index];
      await client.focus();
      try {
        await client.navigate(path);
      } catch {
        // navigate() is not implemented everywhere and rejects across a scope boundary. A focused
        // window on the right app's wrong tab beats an exception that leaves the tap looking dead.
      }
    })(),
  );
});

/*
 * There is deliberately NO `pushsubscriptionchange` handler.
 *
 * iOS never fires it, which is the platform this app exists for; and on the platforms that do, the
 * worker could not act on it anyway — it has no auth, no Firestore SDK, and possibly no client to
 * postMessage. A handler here would be code that looks like a safety net and is not. The real
 * mitigation is re-verifying the subscription on every launch, in `useWebPush`, which covers every
 * platform including the one that would never have called this.
 */
