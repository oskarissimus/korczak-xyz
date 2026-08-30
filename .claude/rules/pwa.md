---
name: pwa
description: The six installable web apps - manifests per app per locale, the single service worker and its precache tiers, the safe area, and self-hosted fonts.
paths:
  - "**/utils/pwa/**"
  - "**/components/PwaHead.astro"
  - "**/layouts/Layout.astro"
  - "**/pages/manifests/**"
  - "**/sw/**"
  - "**/scripts/generate-sw.mjs"
  - "**/scripts/generate-icons.mjs"
  - "**/public/_headers"
  - "**/public/_redirects"
  - "**/public/icons/**"
  - "**/public/fonts/**"
  - "**/assets/icons/**"
  - "**/register-sw.js"
  - "**/components/Navbar/**"
---

## Installable web apps (PWA)

The site ships **six** installable apps from one origin: the whole site, the guitar tuner
(`/apps/tuner`), the songbook (`/songs`), the flashcards (`/apps/flashcards`), the baby sleep log
(`/apps/baby-sleep`) and Event Watch (`/apps/events`). What qualifies is a thing you reach for away
from a desk;
the games that are only fun on a keyboard stay part of `site`. Each has its own scope, so
opening a link outside it leaves the app — which is the point, since most of the site is not
built for a phone. `Layout.astro` takes a `pwa` prop (a `PwaApp`, default `'site'`) that picks
which manifest the page links; iOS reads the manifest of the page you install *from*, so that
prop is what decides which app "Add to Home Screen" produces. **Every page of a scoped app has
to set it** — the flashcards and sleep log are several documents each (their tabs), and a tab
that forgets installs the whole site under the app's own name.

It shipped six until the fretboard and transposition trainers became one, and the retiring cost is
worth knowing before doing it again: an installed app's `start_url` now 301s out of its own scope, so
iOS opens the target in Safari rather than the app. Deleting the old icon and installing the new one
is the only fix, and there is no way to hand an existing install a new identity.

Adding an app is: an entry in `PWA_APPS`, a pattern in `SCOPED`, two short names in the i18n
table, artwork, the `pwa` prop on its pages, and a precache tier. Everything else — both
manifests, the icon set, the head tags — follows.

- `src/utils/pwa/apps.ts` — the app registry: paths, scopes, translation keys
- `src/pages/manifests/[app].webmanifest.ts` — one manifest per app per locale, generated so
  the names come from the same i18n table as everything else. The route parameter is
  `<app>-<lang>` and is split at the **last** hyphen (`parseManifestParam`), because an app id
  may contain one and a locale never does; `split('-')` reads `baby-sleep-en` as the app
  `baby` and serves a manifest of undefined names under a perfectly valid URL.
- `src/components/PwaHead.astro` — manifest link, `apple-touch-icon`, and the Apple-only meta
  tags. `apple-mobile-web-app-title` is not optional: without it iOS labels the icon from
  `<title>`, which here is always `Something | korczak.xyz`, and shows `Songs|korcz...`.
- `src/assets/icons/*.svg` → `npm run icons` → `public/icons/`. Committed, not built: Netlify
  only runs `astro build`, and the deploy should not depend on sharp's native binaries.

The five drawn icons are **full bleed**: every platform masks a home screen icon to its own
shape, so the artwork runs to all four edges with nothing load-bearing within ~40px of them,
and the convex read comes from a bounce light, a gloss sweep and a perimeter vignette layered at
the end of each file. The square-on-navy art this replaced left a visible border on all four
sides once iOS rounded the corners off the navy. `generate-icons.mjs` therefore picks the
maskable treatment per source: `bleed` ships those five unscaled, `inset` keeps the old shrink-onto-navy
for `logo.png`, whose own square edges a circular mask would clip.

All five are the same Win95 device — navy body, raised bezel, sunken black glass — with only
what is *on* the glass telling them apart, because they sit side by side on one home screen:
the tuner's dial, the songbook's yellow chords over green lyrics, the flashcards' stack of cards, the
sleep log's crescent and Zs, Event Watch's yellow ticket over a green calendar bar. Green and yellow throughout, the site's own phosphor.
The flashcards icon draws **two** frets where the app draws five, on a card front rather than filling
the glass: an icon is read at 40px two rows down a home screen, where a finer grid stops being a neck
and becomes texture — and the fret count is not the question the icon is asking. The card behind the
front one is yellow, the songbook's chord colour, which is the only thing at that size that says the
deck holds chords too.

**Icon URLs carry a content hash** (`iconUrl.ts`, used by `PwaHead.astro` and the manifest
route). `_headers` gives `/icons/*` a week, and Cloudflare's edge honours it: the filenames are
not content-hashed the way `_astro/*` chunks are, so one URL meant different bytes either side of
a deploy and the edge kept answering with whichever copy it took first. Clearing Safari's data
does nothing — the request is answered before it reaches Netlify — which is how new artwork
survived a redeploy, a full browsing-data wipe and a reinstall. A query string is part of the
cache key everywhere (CDN, browser, service worker), so `?v=<hash>` misses on new art and the
week-long TTL stays worth having on the bytes that really did not change. Note that iOS copies
the touch icon at install and never re-fetches, so an icon already on a home screen only updates
when the app is deleted and re-added.

### The safe area

`viewport-fit=cover` is on the viewport meta because `env(safe-area-inset-*)` returns zero
without it. The status bar style is `black-translucent`, so in an installed app the clock and
battery are painted *over* the page and something has to reserve that strip.

The insets are named once in `:root` as `--safe-top/-right/-bottom/-left` and applied as
padding on **`<html>`**, unconditionally — not on `<body>`, and not behind
`@media (display-mode: standalone)`. Both of those were wrong for the same reason. On `body`
the safe area is part of the page's own layout, so any page may take it away — and below 600px
`Layout.astro` takes it away for *every* page, since the windows go full-bleed there. That used
to be the song page alone, via `body:has(.song-page:not(.song-closed))`: a (0,2,1) selector
beats a global `body` (0,0,1) whatever media query wraps it, which is how the
installed songbook came to draw its title bar under the Dynamic Island. On `<html>` a page can
still go edge to edge, but only within the safe area. And the gate bought nothing: `env()` is
already zero wherever browser chrome reserves the space, while dropping it fixes landscape in a
tab, where `viewport-fit=cover` genuinely does put content under the camera cutout.

Ancestor padding does not reach `position: fixed`, so `.taskbar` and `.window.maximized` carry
their own `--safe-*` — a maximized window pinned to `top: 0` puts its own restore button under
the clock. The maximized window is positioned on both edges and therefore sized `width: auto`;
`100%` overflows by the side insets.

**Reserving the strip is only half of it: padding scrolls.** It holds the first screen clear of
the clock and then the page slides straight under it, so the songbook read as fixed until you
scrolled — while a maximized window, being fixed and inset, read as fixed all along. That pair
of symptoms is the signature. So `body::before` also *paints* the strip: a fixed band in the
desktop navy that the page scrolls behind, sized from `--safe-top` and therefore nothing at all
in a browser. It sits above everything — the taskbar (9999) and the typing modal (10000) — on
the grounds that a band any overlay can paint over is not doing its job.

The corollary is that anything deliberately anchored to the top of the viewport must clear the
band or it parks itself out of sight behind it. `typing.css` has two: the key table's sticky
header (`top: var(--safe-top)`; the table has no scroll container of its own, so it sticks to
the viewport) and `.typing-key-detail` (`calc(8px + var(--safe-top))`).

What is left in the standalone block is only behaviour that needs there to be no browser:
`overscroll-behavior-y` and the long-press/selection rules on window chrome. Nothing there is
load-bearing for layout, which also means none of the above depends on iOS matching the
`display-mode` media feature.

Named custom properties rather than `env()` inline because `env()` reads as zero on every
machine we can debug on: `document.documentElement.style.setProperty('--safe-top', '59px')` in
a desktop console drives the real rules with what a Dynamic Island phone reports.

**Safari binds the manifest to the document, not to the DOM.** It reads `<link rel="manifest">`,
the title and the touch icon when a document *loads* and never looks again. `ClientRouter`
swaps all three correctly on a client-side navigation — verified in Chromium — but Safari goes
on offering whatever it captured at the last full load, so clicking through the site to the
tuner produced an "Add to Home Screen" dialog carrying the songbook's name and start URL under
the tuner's icon: three pieces of state from three different moments. Refreshing fixed it,
which is the tell.

So `crossesAppBoundary` (`src/utils/pwa/scope.ts`, tested) marks links that would change the
linked manifest with `data-astro-reload`, making those navigations real page loads, plus an
`astro:page-load` reload as a safety net for back/forward. Navigation *within* one app and
locale stays soft — clicking through the songbook is the case that matters. Note the identity
is app **and** locale: `/songs` and `/pl/songs` are separate installable apps.

`scope.ts` is split from `apps.ts` because it ships to the browser and `apps.ts` imports the
whole translation table.

### Service worker

One worker for every app — iOS shares a single registration and one CacheStorage across
Safari and every home screen icon on the origin, so there cannot be more than one.

`dist/sw.js` is generated by `scripts/generate-sw.mjs` as an npm `postbuild` hook. It cannot be
a static file in `public/`: the precache list has to name the content-hashed `_astro/*` chunks,
which only exist after a build. `src/sw/routing.js` holds the pure decisions and is **inlined**
into the output rather than imported, keeping the worker a classic script; it is tested in
`routing.test.js`, because there is no jsdom here and a `fetch` handler is not a reachable
state in a test.

The precache tiers, and which ones you get is decided by the *page*, not the worker. A page
takes at most two: the shell, and the one named after the app it belongs to.

- **essential** (~33 kB gz) — fonts and the offline page. Everyone, on install.
- **shell** (~340 kB gz) — the site root in both locales, the offline page, the navbar and its
  island chunks. **Installed apps only.** The navbar's auth island drags in the whole Firebase
  SDK, over half a megabyte on every page: fair for an app someone installed and expects to
  work on a dead network, not something to push at a visitor who opened korczak.xyz once. The
  worker cannot tell those apart — iOS gives them the same registration — so `register-sw.js`
  checks `display-mode: standalone` and names the tiers it wants.
- **one tier per app** — `songs` (~1.4 MB gz, the 82 song pages), `flashcards` (~110 kB gz),
  `baby-sleep` (~92 kB gz), `events`. Each covers its app's whole subtree, because a tab is a
  separate document and an uncached tab is a dead link on a dead network.

The per-app split is what stops the shell growing with the app count. Folding the newest apps into the
shell instead cost every installed app — including the songbook, which wants none of it — an extra
149 kB gz, and each further app would have charged all the others again. Note that merging two apps
did *not* halve anything here: the flashcards tier is roughly the two it replaced added together,
since it caches the same documents and the same island chunks. What the merge saved is one tier's worth
of bookkeeping in three files, not bytes.
The tuner and the songbook *index* are still in the shell for the historical reason that they
were the only two apps when it was written; they are two cheap routes and moving them now would
only churn the cache.

That leaves the same "which app owns this path" fact stated in three files that cannot import
each other — `SCOPED` in `scope.ts`, `APP_TIERS` in `generate-sw.mjs`, `APP_TIERS` in
`register-sw.js` (inlined into `<head>`, so it can import nothing). Drift between them is
**silent and one-sided**: a tier the page asks for but the generator never wrote is a no-op, so
the app simply has no offline pages. `tiers.test.ts` reads the two scripts as text and checks
they agree with `appForPath` on behaviour rather than on spelling.

Tier names are app ids, so one of them contains a hyphen — and `cacheVersion` used to read the
build id as "everything from the third `-` on", which made `k95-baby-sleep-<build>` report its
version as `sleep-<build>`. A version matching no other cache is one `activate` never sweeps and
`matchDocument` never counts as current: the tier grows forever and always loses to the runtime
cache. It reads the *last two* segments now, a build id being exactly `<timestamp>-<digest>`.

Strategies: documents are **network-first** (serving one app shell for every navigation breaks
`ClientRouter`, which fetches real per-URL markup; going to the network first also keeps HTML
in step with the deployed chunk hashes), hashed assets are cache-first, and **cross-origin is
never intercepted at all** — Firestore's streaming connections and the token refresh described
above are not something to put a cache in front of.

**A page is decided by its path, not by what the request calls itself.** `mode: 'navigate'`
covers only real navigations; `ClientRouter` fetches the next page's markup with a bare
`fetch()`, which arrives as `mode: 'cors'`, `destination: ''` — the shape of a data fetch — and
Astro marks it with nothing, since `internalFetchHeaders` compiles to `{}` without an adapter.
Astro's `<link rel="prefetch">` looks the same. Classified as assets, those went cache-first,
and a song page was served by the path written for fonts and hashed chunks: stored once, then
served past every deploy until its cache was swept. An installed songbook went on showing the
previous build's lyrics under a URL whose content had changed — visible only because the navbar
carries a build stamp, and *self-healing on every second deploy*, which is what made it look
like an iOS quirk. So `looksLikeDocumentPath` decides on the last path segment: every route here
is extensionless and every non-document carries an extension. `handleAsset` additionally refuses
to store `text/html`, so a future misclassification costs one stale render, not a stuck entry.

**Reading a document back is `matchDocument`, never `caches.match`.** Bare `caches.match`
searches every cache in *creation* order — oldest first — so the previous build that `activate`
deliberately retains answers before the current one. For a content-hashed asset that is
harmless; for a document the URL is stable and the markup is a build old.

Two things that are load-bearing and look like details:

- **Responses are re-created before being cached** (`cachePut`). `fetch` returns a *decoded*
  body but keeps the headers that described the bytes on the wire, so storing it verbatim
  yields plain JavaScript wearing `content-encoding: gzip`. The browser then fails to gunzip
  its own cache and every module script and font on the page dies, while the cache looks
  perfectly healthy from the outside. Netlify compresses, so this is not a dev-only concern.
  This was caught only by killing the server and reloading — Playwright's `setOffline` does
  not block localhost, so an "offline" test against a live server proves nothing.
- **`activate` keeps the previous build's caches, not just the current one.** With
  `skipWaiting`, a tab still running the old HTML can lazily import an island chunk whose
  hashed name was just deleted. Build ids lead with a timestamp so they sort chronologically.

`public/_headers` serves `/sw.js` `no-cache`. Without that, an installed iOS app holds its
worker indefinitely and never picks up a new one — you ship a fix and the home screen app goes
on running last month's code.

**That header does not survive the CDN, so registration asks for it too.** korczak.xyz sits
behind Cloudflare in front of Netlify, and Cloudflare's 4-hour Browser Cache TTL raises any
shorter origin `max-age` on a `.js` response: `/sw.js` arrives as `max-age=14400` however it
leaves Netlify. (The other `_headers` rules are untouched — `/icons/*` is already longer at
604800, and `/manifests/*` and HTML are `DYNAMIC`, so Cloudflare never rewrites them.) Hence
`register('/sw.js', { updateViaCache: 'none' })` in `register-sw.js`, which puts the guarantee
somewhere no CDN sits between us and it.

### Fonts

VT323 and Press Start 2P are **self-hosted** in `public/fonts/`, not loaded from Google. An
installed app has to render with no network, and `song.css` aligns chords over lyrics by
character cell — losing VT323's metrics misaligns every chord chart, so a system-font fallback
is not graceful degradation here. `latin-ext` is not optional: every Polish diacritic except
`ó` lives there. See `public/fonts/README.md`.
