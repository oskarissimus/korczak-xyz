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
`.typing-book-combo` wraps the `<select>` because one element cannot draw both a sunken field and a
raised drop-down button; both its pseudo-elements are `pointer-events: none` so clicks still reach
the control.

`.typing-skel-select` in `typing.css` hard-codes the real picker's rendered width so the row does
not jump on hydration. Re-measure it in a browser whenever the book list changes — it had drifted
132px before anyone noticed.

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

## Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized —
see the `i18n` skill for how.

## Workflow

When work is finished, commit and push directly to `main`. Don't create feature branches
or pull requests for routine work unless I explicitly ask for one.
