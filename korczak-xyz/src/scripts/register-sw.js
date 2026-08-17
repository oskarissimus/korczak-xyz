/**
 * Registers the service worker.
 *
 * Inlined into <head> the same way island-recovery.js is, so it runs before anything else has
 * a chance to fail. Registration is deferred to `load` so it never competes with first paint,
 * and `register()` is idempotent for a given URL and scope, so ClientRouter's soft navigations
 * need no guard of their own.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;

  /**
   * iOS launched from the home screen. `display-mode: standalone` is the standard signal;
   * `navigator.standalone` is Apple's older one and still the only one some iOS versions set.
   */
  function isInstalledApp() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch {
      /* matchMedia can throw in odd embedding contexts; fall through. */
    }
    return navigator.standalone === true;
  }

  /**
   * The subtree each app-specific tier covers. These have to agree with APP_TIERS in
   * scripts/generate-sw.mjs, and with SCOPED in src/utils/pwa/scope.ts — the three are the
   * same fact stated for three different consumers, and this one cannot import either of the
   * others: it is inlined into <head> as a classic script.
   *
   * The songbook is the odd one: its index is part of the shell, so its tier is the song
   * pages alone — but the pattern still has to match the index, or launching the installed app
   * at /songs would never ask for the corpus.
   */
  var APP_TIERS = [
    { tier: 'songs', pattern: /^(\/pl)?\/songs(\/|$)/ },
    { tier: 'flashcards', pattern: /^(\/pl)?\/games\/flashcards(\/|$)/ },
    { tier: 'baby-sleep', pattern: /^(\/pl)?\/games\/baby-sleep(\/|$)/ },
  ];

  /**
   * Which precache tiers this page is entitled to ask for.
   *
   * Nothing beyond the essentials is fetched for an ordinary browser tab. The shell carries
   * the navbar's auth island and with it the whole Firebase SDK — worth having on a dead
   * network if you installed the app, not worth pushing at someone who opened korczak.xyz
   * once. On iOS every app shares a single worker and CacheStorage, so this distinction can
   * only be drawn here, in the page.
   *
   * At most one app tier is added, because a page belongs to one app: an installed songbook
   * has no use for the sleep log's chunks, and charging every app for every other app is how
   * the shell would grow without limit as apps are added.
   */
  function tiersToPrecache() {
    if (!isInstalledApp()) return [];
    // Shell first: `message` fills tiers in the order given, and nothing else renders without
    // it. See the note there.
    var tiers = ['shell'];
    for (var i = 0; i < APP_TIERS.length; i++) {
      if (APP_TIERS[i].pattern.test(location.pathname)) {
        tiers.push(APP_TIERS[i].tier);
        break;
      }
    }
    return tiers;
  }

  window.addEventListener('load', function () {
    // `updateViaCache: 'none'` keeps the worker script out of the HTTP cache on every update
    // check. public/_headers asks for the same thing and does not get it: korczak.xyz sits
    // behind Cloudflare, whose 4-hour Browser Cache TTL raises any shorter origin max-age on a
    // .js response, so /sw.js is served `max-age=14400` however it leaves Netlify. This says it
    // in a place no CDN is between us and.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(function () {
      /* An unregisterable worker costs the site nothing: every page still works online. */
    });

    var tiers = tiersToPrecache();
    if (tiers.length === 0) return;
    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.active) registration.active.postMessage({ type: 'PRECACHE', tiers: tiers });
    });
  });
})();
