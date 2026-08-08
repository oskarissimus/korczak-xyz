# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

The Astro site is `korczak-xyz/`; all npm commands run from there. `resume/` is a separate
subproject.

## Solitaire Game

The solitaire game is at `/games/solitaire/`. A JavaScript debug interface is available at
`window.solitaire` when the game is loaded — see the `solitaire-debug` skill.

## Typing Trainer

The trainer is at `/games/typing/`. Progress syncs to Firestore under `users/{uid}/progress/{bookId}`
when signed in, and to localStorage always.

### Sync

Local and cloud are reconciled by *lineage*, not timestamps. Each progress revision carries
`(rev, writerId)`, and `typing-sync-base:${bookId}` in localStorage bookmarks the revision both
sides last held in common. Comparing those three points is what distinguishes "the other side
is stale" from "the two have branched" — a distinction `lastPlayedAt` cannot make.

- `src/utils/typing/reconcile.ts` — the decision table (pure; unit-tested in `reconcile.test.ts`)
- `src/utils/typing/syncEngine.ts` — state machine, single-flight write queue, retry/backoff
- `src/utils/typing/syncPresentation.ts` — `SyncState` → what the indicator shows (pure; tested)
- `src/components/Typing/SyncStatus.tsx` — the indicator on the progress line
- `src/components/Typing/ConflictModal.tsx` — shown when the two have genuinely branched

`rev` is compared by magnitude only *within* one `writerId` — and there, one direction is
impossible. A writer cannot fall behind a bookmark it already reached by typing forward, so
`local.rev < base.rev` from the same writer means the local record was lost or rolled back, not
edited. The table asks only whether local *differs* from the bookmark, so without an explicit
`local-behind-base` case the rollback reads as progress and gets pushed over good cloud data.
That is exactly how a session lost five sections. Such a record is routed through strict
ancestry instead: `pull` if the cloud contains it, `conflict` if not — never `push`.

The indicator shows the outcome of the last attempt and nothing else: "✓ Synced" when progress is
on the account, "✕ Sync failed · 2 min ago" when it is not. Work in flight is not shown — it is
transient, no one acts on it, and a spinner beside the passage is motion someone typing has to
ignore. A failure is what persists and what can be clicked to retry. The success case shows the
word without the age; the exact time is in the tooltip.

The outcome cannot come from `SyncStatus` alone: it is a precedence ladder, so `syncing` outranks
`error` and a failing retry reads as healthy. `describeSync` reads `error`/`conflict` alongside
`lastSyncedAt`/`lastFailedAt` instead, which is why `SyncState` carries `lastFailedAt` at all.

The indicator reads on from `Progress: 42%` on the line under the progress bar
(`.typing-progress-footer`), because that number is what it qualifies — progress here, and whether
it is also progress on the account. `StatsBar` takes it as a `syncStatus?: ReactNode` slot so it
never learns about the sync engine; `TypingSession` builds the node.

The line reserves the indicator's height; the indicator itself reserves nothing. `--sync-cell-h`
(36px, set by the signed-out sign-in button — the tallest state) lives on
`.typing-progress-footer`, not on `.typing-sync-slot`, because what must not move is the line:
the indicator arrives at hydration, and it is absent altogether when auth is off. Put the
reservation on the slot and both of those cases shift the row. The button needs `line-height: 1`
to fit inside 36px; its own font metrics make it 41px.

Width is reserved nowhere. Nothing is anchored to the indicator's right edge and the percentage
before it is left-aligned, so a long state — the Polish sign-in label is 325px measured — wraps
under the percentage instead. That wrap only works because `.typing-progress` has **no
`min-width` floor**: with one, flexbox squeezed the column to the floor while its content still
demanded 325px and the button hung out of the panel. Nothing on this path may clip; a truncated
"Sync failed ·" is the one output this indicator must not produce.

Above ~800px every state leaves the stats row at 86px with the tiles setting it, so the common
`✓ Synced` costs the layout nothing. Verified 320–1400px against the skeleton.

The book-picker row is a Win95 dialog line: `Book [combo box]`, both at the left margin.
`.typing-book-combo` wraps the control because one element cannot draw both a sunken field and a
raised drop-down button; both its pseudo-elements are `pointer-events: none` so clicks still reach
the control.

It is **not** a `<select>`. A `<select>`'s popup belongs to the OS — `appearance: none` reaches the
field and nothing else — so on a phone the list arrived as a translucent dark rounded iOS sheet
over a Windows 95 dialog. `src/components/Typing/BookSelect.tsx` draws the list instead: the ARIA
select-only combo box, focus staying on the button with `aria-activedescendant` naming the active
row, which also keeps the on-screen keyboard away. The keys are a pure function in
`src/utils/typing/comboKeys.ts` (tested in `comboKeys.test.ts`) — there is no jsdom here, so
anything that has to be verified cannot live in the event handler.

The picker renders in `Typing.tsx`, not in `TypingSession`, which is keyed on the book: a keyed
remount would tear down the control from inside its own click handler. Focus afterwards belongs to
the session, which claims the typing input on mount.

Width is the widest `Title — Author`, the way a `<select>` sized itself: `.typing-book-sizer` stacks
every label in the button's own grid cell, hidden but measured. That is also how the pre-hydration
stand-in in `TypingSkeleton.astro` matches — it renders the same markup and labels from
`bookMeta.ts` (metadata only, no `?raw` book texts). It used to hard-code the picker's measured
width, which had gone stale by 132px; there is no number to keep up to date now.

### Firestore client health

The Firestore JS client can die mid-session and stay dead. Going offline long enough for the
auth token to need refreshing makes the refresh fail with `auth/network-request-failed`; that
string reaches Firestore's `isPermanentError`, which knows only gRPC codes and calls
`fail(0x3c6b)` on anything else. The assertion poisons the client's `AsyncQueue`, and from then
on **every promise already waiting on it is never settled** — not resolved, not rejected. Any
`await` on it hangs for the life of the page, so an "in flight" flag cleared in a `finally`
never clears. That is how a session ends up showing a sync permanently in progress.

- `src/lib/firestoreHealth.ts` — `runCloud()` puts a 25s deadline on every Firestore call and
  treats a blown deadline (or an `INTERNAL ASSERTION FAILED`) as evidence the client is dead.
  `installFirestoreWatchdog()` catches the assertion arriving as an unhandled rejection.
- `src/lib/firebase.ts` — `getDb()` / `recycleDb()`. Recovery is `terminate()` plus a fresh
  `getFirestore(app)`; nothing else revives a poisoned client. Read the handle per call, never
  hold it.
- `syncEngine` re-runs the initial reconcile on reconnect or on backoff when it never completed
  (`reconcileOwed`), and forgives the retry backoff earned by a client that has since been
  replaced (`isRecoverableClientError`).

`syncEngine.test.ts` drives the whole chain with `firebase/firestore` mocked to return promises
that never settle — the only faithful model of the dead-client case.

### Local storage budget

The origin gets ~5 MB, shared with the solitaire game, the quiz and the song preferences. The
trainer can spend all of it: `typing-progress:${bookId}` carries `typedHistory` — the whole book
as typed — and `typing-sessions` archives every sitting's keystroke log. It once did, and the
result was not an error but **silence**: `localStorage.setItem` threw on every keystroke while
the page went on typing and pushing to Firestore, so the next page load read back a record three
minutes stale and pushed it over the cloud. Hence:

- Writes go through `writeKey` in `src/utils/typing/storage.ts`, never a bare `catch {}`. It
  reports `storage.write.failed` (error) — **once per key per page load**, because a full store
  fails again on the next keystroke and an `error` entry makes the log sink flush immediately,
  writing to the store that is already full. `storage.write.recovered` re-arms it.
- On a quota error it surrenders the older half of the session archive and retries once
  (`storage.evicted`). Sessions are replayable telemetry already mirrored to Firestore; progress
  is not, so progress always wins. The archive is never evicted to make room for the archive.
- The archive is pruned as it uploads: `useTypingSession`'s seed effect drops each session once
  its cloud write resolves (`removeArchivedSessions`). Before this it was append-only *and*
  re-uploaded in full on every mount — its guard is a ref, which a page load resets.
- `saveProgress` is coalesced to 500 ms, flushed on section completion and by `flushSession`
  (pause, unmount, `pagehide`, reset, export). Both halves read `progressRef` at write time, so
  a pending timer can only write the newest value.

`storage.test.ts` fakes a `localStorage` with a byte ceiling — there is no jsdom in this project,
so "the store is full" is otherwise not a reachable state in a test.

### Frontend logging

Structured logs buffer in localStorage and upload in batches to `users/{uid}/logs`, reachable at
`window.typingLogs` — see the `typing-logs` skill.

Two `error`-level assertions watch progress for going backwards, and they cover different
windows — the first one alone missed the loss it was written to catch:

- `progress.revert.detected` — progress moved backwards by more than a single-section backspace
  *within a session*. Carries before/after snapshots and the sync status at the time.
- `progress.stale.detected` — what loaded at mount already sits behind its own sync bookmark.
  The in-session check cannot see this: the damage is baked into the stored value, so there is
  no earlier value to compare against. Carries the loaded record, the bookmark and
  `storageBytes()` — which is usually the explanation.

## Fretboard Trainer

Spaced-repetition flashcards for the notes on the neck, at `/games/fretboard/`. A card is one
position, drilled **both ways round** on independent schedules: `name` shows the dot and asks
what it is called, `find` names the note and a string and asks where it is. Reading a diagram
and finding G on the A string mid-song are different skills, and the scheduler has no business
assuming one implies the other.

Answers are a tap, never a self-grade. Correctness is objective and the SM-2 rating comes from
correctness plus how long it took (`≤2s` easy, `≤5s` good, slower hard, wrong again) — which is
what makes the per-position accuracy and speed on the stats page measurements rather than
claims. `srs.ts` is Anki's shape: minute-scale learning steps (1m, 10m) before day-scale
intervals, relearning after a lapse, mature at ≥21 days.

- `src/utils/fretboard/` — `notes.ts` (tuning, card ids), `diagram.ts`, `srs.ts`, `deck.ts`
  (scope and queue), `replay.ts` (sync core), `stats.ts`, `storage.ts`, `cloud.ts`, `keys.ts`
- `src/hooks/useFretboardData.ts` — local state, upload queue, pull and merge
- `src/components/Fretboard/` — the two islands and their parts

### The deck is derived; the answer log is the record

The typing trainer reconciles by lineage because its progress is a *mutable document* two
devices can branch. This data is not that shape, and copying `reconcile.ts` here would import a
conflict model — and a conflict dialog — for a conflict that cannot happen. Two facts do the
work instead:

1. **A finished sitting is immutable and uniquely identified**, so merging two devices' logs is
   a union by id. One document per sitting at `users/{uid}/fretboardSessions/{sessionId}`,
   written once, never edited. No transactions, no bookmark, no `(rev, writerId)`.
2. **Card state is a pure fold of the answers applied to it** — `rate()` takes `now` rather than
   reading the clock precisely so this holds. The merged deck is what you get by folding the
   merged log, so nobody wins and nothing is overwritten.

The deck is still *cached*, because the log it was folded from is pruned once its sittings are
safely in the cloud. `foldedThrough` is the newest event already in the cache, and it is what
tells `reconcileDeck` whether arriving events go on top (**append**) or mean the fold has to
start again (**rebuild**). When they interleave and the local log has been pruned there is
nothing to rebuild from, so they are folded on top anyway (**append-late**): every answer is
still counted, only the due dates come out of an older clock, which costs a card one early
appearance. A caller holding the whole cloud log can pass `completeLog` and get the rebuild.

Answers are written to `fretboard-current` as they happen and folded into the deck when the
sitting ends — one small key per answer rather than re-serialising a quarter-megabyte log every
few seconds. A tab closed mid-sitting therefore loses nothing: the next load finds the orphan
and finishes the sitting on its behalf (`commitSitting`, shared by both paths, so "half of it in
the deck and none of it in the history" is unreachable).

### What to ask is scheduled; what order to ask it in is shuffled

`buildQueue` keeps those two apart. **Selection** stays by due date — a capped sitting draws the
cards that have waited longest, and drawing a random handful instead would quietly abandon the
schedule. **Order** is a shuffle, because once the cards are drawn their sequence carries no
information, and a fixed one is something you learn instead of the neck: every sitting used to
walk E, A, D, G, B, e in turn, which you can answer without reading the card. New cards are
drawn from the whole fret range for the same reason — the range setting is the curriculum, so
`scopeIds` is a stable enumeration and nothing more, not an introduction order.

`spreadPositions` then pulls apart cards asking about the same place. `name:2-7` and `find:2-7`
are different questions, but back to back the second is answered off the first — and it lands in
the log as a fast, correct answer, so the scheduler pushes the card out and the stats page
reports a fluency that was never demonstrated. A shuffle alone does not fix that; it only makes
the clumping unpredictable.

The randomness enters through `rng` on `QueueOptions`, defaulting to `Math.random`, so the
module stays pure and a sitting's order is something a test can pin to a seed.

### The in-session queue is ordered by due time, not by a fixed gap

A missed card comes back inside the sitting. It used to be re-inserted a fixed number of places
ahead — which **deadlocks**: with a gap of `g`, `g` cards that keep being missed each re-insert
themselves exactly `g` ahead, the same handful cycle forever and nothing behind them is ever
reached. Twenty-five answers, two cards seen. `requeue` now places the card in front of
everything scheduled later than it; cards not yet attempted this sitting have nothing scheduled
and sort to the front, which is what guarantees the sitting keeps moving through its material.
`MIN_REQUEUE_GAP` only binds at the tail, and only to stop a card being asked twice in a row —
the answer is still on the screen you just read. `requeue` is deliberately the one ordering
decision that is **not** shuffled: its due-time ordering is what guarantees the sitting keeps
moving, and randomness there would risk the deadlock back.

### Drawing the neck

`diagram.ts` deliberately reproduces the songbook's chord-diagram grammar (`chordDiagram.ts`):
same four-character row prefix, same `---+` cells, so the fret numbers land on the same columns
and the two notations read as one. It is **not** the same function — a chord marks the five
strings it does not use (`✕`/`○`), and a note card must leave them blank or it answers a
question it did not ask. The window is five frets wide, not the whole neck: thirteen frets is 56
characters, which no phone renders without either shrinking the glyphs past reading or pushing
the answer off-screen, and the fret numbers are printed either way, so a window asks exactly the
same question.

Because both notations are laid out in *characters*, the marks on them cannot be allowed to
advance like the characters they are: `●`, `○` and `✕` are not in VT323, so each comes from
whatever fallback font the platform has — 0.602em against VT323's 0.40em in Chromium, and
something else again on a phone. Half a cell of overhang pushed the rest of the row right, out
of column with the rows above it and with the fret numbers, so in a chord shape every muted or
open string sat offset from its neighbours. `src/styles/chordMarks.css` (shared by both, the way
`tabs.css` is) boxes each mark at `1ch` — the width of `0` in the element's own font, which is
VT323 whatever the glyph's own font turns out to be — and lets the glyph overhang the box
instead of the layout. The pressed dot is then **drawn** rather than printed, because how far it
overhangs is a property of a font we do not ship, and boxed-but-printed it swallows the dashes
either side of it; a circle sized in `ch` overhangs by exactly as much as we say everywhere —
1.2 cells, proud of the grid but clear of the dashes. `-webkit-text-fill-color`
hides the character without disturbing the box, the inherited `color` the circle paints itself
with (so light mode keeps working by setting `color`), or the text itself.

A `find` card is answered on `NeckGrid` instead, because pointing at a place on the instrument
needs a target big enough for a thumb. Only the asked string is live, which is what makes 19px
cells workable at 320px — vertical aim does not matter when five of the six rows cannot be
pressed. The grid's columns are `minmax(0, 1fr)`, so the whole neck always fits rather than
scrolling; a neck you have to scroll to answer is worse than a narrow one you can see. The same
component draws the stats heatmap, where each square takes the **weaker** of its two directions:
a position you can read but not find is not a position you know.

Fret 0 has no column of its own — the **string-name column is the open position**, and on the
asked string it is the button. An open string is not stopped anywhere, so a box labelled `0`
standing where the first fret's box stands reads as a fret, and "F on the D string" then looks
like it could be answered there. This is the grammar `diagram.ts` already used, where the dot for
an open string goes on the nut and the numbered cells start at 1, so the two notations agree
again. The nut cell undoes two things the plain cells do, and both rules therefore sit *after*
`--live`/`--muted` in the stylesheet: it draws no string line (the string starts at the nut, and a
line through a letter reads as a strike-through), and it is not dimmed when its string is not the
one being asked about — the other strings' names are how the neck is read, and cell opacity would
take the letter with it. The nut bar itself is an `::after` painted into the grid gap and 1px past
the cell top and bottom, so the six rows join up instead of reading as six dashes.

### Storage and stats

Keys are `fretboard-deck` (the cache), `-events` (capped at 2000), `-sessions`, `-mastery`,
`-settings`, `-current`, `-unsynced`, `-pulled-at`. Writes go through the same `writeKey`
discipline as the typing trainer, sharing `src/lib/localStorage.ts`; under quota pressure it
surrenders the oldest answers and never the deck cache, which is the one thing here that cannot
be rebuilt offline.

Everything on the stats page is recomputed from the deck and the log except the daily mastery
snapshots, which exist because "how many cards were mature last Tuesday" is the one question the
log cannot answer cheaply — and because a scheduler change should not rewrite last month.

### Notation

German/Polish notation calls the black key below B natural **B**, which leaves B natural needing
a letter of its own — **H**. That is a `notation` setting (`'international' | 'german'`), not a
translation: it is a property of the player rather than of the page's language, and someone
reading the English page in Warsaw still wants H. The locale only picks the default
(`defaultNotationFor`), and once the setting is touched it is stored and synced and follows the
account across both locales. This also settles a disagreement the site had with itself — the
songbook's chord transposer (`src/utils/chords.ts`) has always printed `H`.

Exactly two of the twelve change (`GERMAN_LABELS` in `notes.ts` is that sparse table, not a
second full one), plus the 2nd string, which becomes the H string. `Cis`/`Des` is a further step
nothing here takes.

`PITCH_CLASSES[].name` stays international whichever is picked. It is what an answer is graded
against and what lands in `ReviewEvent.answered` in localStorage and Firestore, so a notation
reaching it would split one card's history in two — a deck practised one way and reviewed the
other has to stay one deck. Card ids and storage keys carry no note names at all, so nothing here
can orphan a deck. `pitchLabel`/`stringLabel`/`noteLabelAt` take the notation as a **required**
argument rather than defaulting to international, because a defaulted one is how a single call
site goes on quietly showing `B`.

`keys.ts` maps letters per notation rather than keeping one set of naturals and a shift rule: `H`
answers B natural, and `B` **unshifted** answers A♯, the letter being the flat name there. That
closes the existing shift hole from the other side — shift on `B` reaches for what `B` already
answers, so it does nothing.

The Win95 tab strip is shared with the typing trainer as `src/styles/tabs.css` (`.win-tabs` /
`.win-tab`), pulled in by each game's stylesheet with `@import`, so a page picks it up through
the one stylesheet it already needed.

## Installable web apps (PWA)

The site ships **three** installable apps from one origin: the whole site, the guitar tuner
(`/games/tuner`), and the songbook (`/songs`). Each has its own scope, so opening a link
outside it leaves the app — which is the point, since most of the site is not built for a
phone. `Layout.astro` takes a `pwa` prop (`'site' | 'tuner' | 'songs'`, default `'site'`) that
picks which manifest the page links; iOS reads the manifest of the page you install *from*, so
that prop is what decides which app "Add to Home Screen" produces.

- `src/utils/pwa/apps.ts` — the app registry: paths, scopes, translation keys
- `src/pages/manifests/[app].webmanifest.ts` — one manifest per app per locale, generated so
  the names come from the same i18n table as everything else
- `src/components/PwaHead.astro` — manifest link, `apple-touch-icon`, and the Apple-only meta
  tags. `apple-mobile-web-app-title` is not optional: without it iOS labels the icon from
  `<title>`, which here is always `Something | korczak.xyz`, and shows `Songs|korcz...`.
- `src/assets/icons/*.svg` → `npm run icons` → `public/icons/`. Committed, not built: Netlify
  only runs `astro build`, and the deploy should not depend on sharp's native binaries.

The tuner and songs art is drawn **full bleed**: every platform masks a home screen icon to its
own shape, so the artwork runs to all four edges with nothing load-bearing within ~40px of them,
and the convex read comes from a bounce light, a gloss sweep and a perimeter vignette layered at
the end of each file. The square-on-navy art this replaced left a visible border on all four
sides once iOS rounded the corners off the navy. `generate-icons.mjs` therefore picks the
maskable treatment per source: `bleed` ships those two unscaled, `inset` keeps the old shrink-onto-navy
for `logo.png`, whose own square edges a circular mask would clip.

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

One worker for all three apps — iOS shares a single registration and one CacheStorage across
Safari and every home screen icon on the origin, so there cannot be more than one.

`dist/sw.js` is generated by `scripts/generate-sw.mjs` as an npm `postbuild` hook. It cannot be
a static file in `public/`: the precache list has to name the content-hashed `_astro/*` chunks,
which only exist after a build. `src/sw/routing.js` holds the pure decisions and is **inlined**
into the output rather than imported, keeping the worker a classic script; it is tested in
`routing.test.js`, because there is no jsdom here and a `fetch` handler is not a reachable
state in a test.

Three precache tiers, and which one you get is decided by the *page*, not the worker:

- **essential** (~26 kB) — fonts and the offline page. Everyone, on install.
- **shell** (~850 kB) — the app routes and their island chunks. **Installed apps only.** The
  navbar's auth island drags in the whole Firebase SDK, over half a megabyte on every page:
  fair for an app someone installed and expects to work on a dead network, not something to
  push at a visitor who opened korczak.xyz once. The worker cannot tell those apart — iOS gives
  them the same registration — so `register-sw.js` checks `display-mode: standalone` and names
  the tiers it wants.
- **songs** (~350 kB) — the 82 song pages, for the installed songbook only.

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

## Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized —
see the `i18n` skill for how.

## Workflow

When work is finished, commit and push directly to `main`. Don't create feature branches
or pull requests for routine work unless I explicitly ask for one.

Claude Code on the web doesn't honour this on its own: each cloud session is assigned a
generated `claude/<slug>` branch in its **system prompt**, which outranks this file. There is no
setting to turn that off — the session form's branch picker only chooses what you start *from*,
and the "Allow unrestricted branch pushes" toggle applies to Routines, not interactive sessions.
So `.claude/hooks/session-start.sh` restates the rule as a `SessionStart` hook, whose
`additionalContext` lands ahead of the first prompt where the session actually reads it. In cloud
sessions only, it also checks out `main` when the assigned branch is still untouched — a clean
tree sitting exactly on `origin/main`. A branch that already carries work is left alone, so the
hook is safe on resume. This is a workaround for injected prompt text, not a supported switch; if
web sessions start ignoring `main` again, that prompt likely changed.
