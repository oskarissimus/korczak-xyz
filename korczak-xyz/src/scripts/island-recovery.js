/*
 * Recovers pages whose interactive islands failed to hydrate.
 *
 * Astro retries a failed chunk import once, then dispatches `astro:hydration-error`
 * and gives up, which leaves `client:only` islands showing their skeleton fallback
 * forever - the state a browser autolaunched before the network is up ends in.
 * This retries with backoff, reloads once when connectivity returns, and finally
 * shows a dismissible dialog instead of a page that pretends to still be loading.
 *
 * Inlined into every page (see Layout.astro): a bundled script would fail to load
 * in exactly the situation it exists to fix, so it also cannot rely on the site
 * stylesheet having loaded and styles the dialog inline.
 */
(function () {
  var MAX_RETRIES = 3;
  var BACKOFF_MS = [2000, 4000, 8000];
  // Evaluated per call, not once: with client-side routing this script runs a single time
  // for the whole visit, and a key captured at startup would keep charging every later
  // page's reload budget to the one the user happened to enter on.
  function reloadKey() {
    return 'island-recovery-reloaded:' + location.pathname;
  }

  var t = window.__islandRecoveryI18n || {};
  var attempts = new WeakMap();
  var pending = [];
  var dialog = null;

  function isStuck(el) {
    return el.isConnected && el.hasAttribute('ssr');
  }

  function stuckIslands() {
    return pending.filter(isStuck);
  }

  function session(fn) {
    try {
      return fn(window.sessionStorage);
    } catch (e) {
      return null;
    }
  }

  function claimReload() {
    return session(function (s) {
      var key = reloadKey();
      if (s.getItem(key)) return false;
      s.setItem(key, '1');
      return true;
    });
  }

  function releaseReload() {
    session(function (s) {
      s.removeItem(reloadKey());
    });
  }

  function track(el) {
    if (pending.indexOf(el) !== -1) return;
    pending.push(el);
    el.addEventListener('astro:hydrate', onHydrated, { once: true });
  }

  function onHydrated(ev) {
    var el = ev.currentTarget;
    el.removeAttribute('data-island-failed');
    var i = pending.indexOf(el);
    if (i !== -1) pending.splice(i, 1);
    if (!stuckIslands().length) {
      closeDialog();
      releaseReload();
    }
  }

  function onHydrationError(ev) {
    var el = ev.target;
    if (!el || typeof el.start !== 'function') return;
    track(el);
    scheduleRetry(el);
  }

  function scheduleRetry(el) {
    if (!isStuck(el)) return;

    // Offline: retrying would only burn attempts against a network that is known
    // to be down. Say so instead; `onOnline` takes over when it comes back.
    if (navigator.onLine === false) {
      openDialog();
      return;
    }

    var used = attempts.get(el) || 0;
    if (used >= MAX_RETRIES) {
      openDialog();
      return;
    }
    attempts.set(el, used + 1);
    setTimeout(function () {
      if (!isStuck(el)) return;
      try {
        el.start();
      } catch (e) {
        openDialog();
      }
    }, BACKOFF_MS[used]);
  }

  function onOnline() {
    var stuck = stuckIslands();
    if (!stuck.length) return;

    // A reload also recovers assets other than islands (stylesheets, fonts) and
    // picks up fresh HTML, but only once per page - never loop.
    if (claimReload()) {
      fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(
        function (res) {
          if (res.ok) location.reload();
          else retryAll(stuck);
        },
        function () {
          // `online` fired but the server is unreachable (captive portal, still
          // connecting). Don't reload into a browser error page.
          releaseReload();
          retryAll(stuck);
        }
      );
    } else {
      retryAll(stuck);
    }
  }

  function retryAll(islands) {
    for (var i = 0; i < islands.length; i++) {
      attempts.set(islands[i], 0);
      scheduleRetry(islands[i]);
    }
  }

  function style(el, css) {
    for (var k in css) el.style[k] = css[k];
    return el;
  }

  // The island host is `display: contents`, so its own opacity would do nothing;
  // dim and freeze the skeleton subtree instead. Hydration replaces the children,
  // and onHydrated drops the attribute, so this needs no other undo.
  function markFailedStyles() {
    if (document.getElementById('island-failed-styles')) return;
    var css = document.createElement('style');
    css.id = 'island-failed-styles';
    css.textContent =
      '[data-island-failed] > * { opacity: .35; }' +
      '[data-island-failed] * { animation: none !important; }';
    document.head.appendChild(css);
  }

  function openDialog() {
    // Stop the leftover skeletons from claiming the page is still loading. Islands
    // fail one by one, so re-mark on every call, not just when building the dialog.
    var stuck = stuckIslands();
    for (var i = 0; i < stuck.length; i++) stuck[i].setAttribute('data-island-failed', '');
    markFailedStyles();

    if (dialog) return;

    dialog = style(document.createElement('div'), {
      position: 'fixed',
      zIndex: '2147483647',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(420px, calc(100vw - 32px))',
      background: '#c0c0c0',
      border: '3px outset #ffffff',
      boxShadow: '4px 4px 0 rgba(0, 0, 0, 0.4)',
      color: '#000000',
      fontFamily: "'VT323', monospace",
      textAlign: 'left'
    });
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'false');

    var bar = style(document.createElement('div'), {
      background: 'linear-gradient(90deg, #000080, #1084d0)',
      color: '#ffffff',
      padding: '4px 8px',
      fontFamily: "'Press Start 2P', 'VT323', monospace",
      fontSize: '10px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    });
    bar.appendChild(document.createTextNode(t.title || 'Loading Error'));

    var close = style(document.createElement('button'), {
      width: '16px',
      height: '14px',
      padding: '0',
      background: '#c0c0c0',
      border: '2px outset #ffffff',
      color: '#000000',
      fontFamily: "'VT323', monospace",
      fontSize: '12px',
      lineHeight: '1',
      cursor: 'pointer'
    });
    close.type = 'button';
    close.textContent = 'X';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeDialog);
    bar.appendChild(close);

    var body = style(document.createElement('div'), {
      padding: '16px',
      fontSize: '1.2rem',
      lineHeight: '1.4'
    });
    body.appendChild(
      document.createTextNode(
        t.message || 'Parts of this page could not be loaded. Check your internet connection and try again.'
      )
    );

    var reload = style(document.createElement('button'), {
      display: 'block',
      margin: '16px auto 0',
      background: '#c0c0c0',
      border: '3px outset #ffffff',
      padding: '8px 20px',
      fontFamily: "'VT323', monospace",
      fontSize: '1.2rem',
      color: '#000000',
      cursor: 'pointer'
    });
    reload.type = 'button';
    reload.textContent = t.reload || 'Reload';
    reload.addEventListener('click', function () {
      releaseReload();
      location.reload();
    });
    body.appendChild(reload);

    dialog.appendChild(bar);
    dialog.appendChild(body);
    document.body.appendChild(dialog);
    reload.focus();
  }

  function closeDialog() {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
  }

  document.addEventListener('astro:hydration-error', onHydrationError);
  window.addEventListener('online', onOnline);

  // A page that ended up healthy must not leave the one-reload budget spent. `load` only
  // ever fires for the page the visit started on, so later pages are covered by
  // `astro:page-load` - which also fires for that first one, hence no `load` listener.
  document.addEventListener('astro:page-load', function () {
    // Islands belonging to a page that has since been swapped out are detached and can
    // never recover; drop them rather than let the list grow for the whole visit.
    pending = pending.filter(function (el) {
      return el.isConnected;
    });
    setTimeout(function () {
      if (!stuckIslands().length) releaseReload();
    }, 5000);
  });
})();
