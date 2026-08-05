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
   * Which precache tiers this page is entitled to ask for.
   *
   * Nothing beyond the essentials is fetched for an ordinary browser tab. The shell carries
   * the navbar's auth island and with it the whole Firebase SDK — worth having on a dead
   * network if you installed the app, not worth pushing at someone who opened korczak.xyz
   * once. On iOS both share a single worker and CacheStorage, so this distinction can only be
   * drawn here, in the page.
   */
  function tiersToPrecache() {
    if (!isInstalledApp()) return [];
    var tiers = ['shell'];
    if (/^(\/pl)?\/songs(\/|$)/.test(location.pathname)) tiers.push('songs');
    return tiers;
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      /* An unregisterable worker costs the site nothing: every page still works online. */
    });

    var tiers = tiersToPrecache();
    if (tiers.length === 0) return;
    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.active) registration.active.postMessage({ type: 'PRECACHE', tiers: tiers });
    });
  });
})();
