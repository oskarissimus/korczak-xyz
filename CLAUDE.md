# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

```
korczak-xyz/
├── korczak-xyz/          # Main Astro website
│   ├── src/
│   │   ├── components/   # React/Astro components
│   │   ├── hooks/        # React hooks
│   │   ├── pages/        # Astro pages
│   │   ├── utils/        # Utility functions
│   │   └── workers/      # Web workers
│   └── public/           # Static assets
└── resume/               # Resume subproject
```

## Common Commands

```bash
cd korczak-xyz
npm run dev      # Start dev server (usually port 4321)
npm run build    # Production build
npm run preview  # Preview production build
npm test         # Run unit tests (vitest)
npx tsc --noEmit # Type check without emitting
```

## Solitaire Game

The solitaire game is at `/games/solitaire/`. Key files:

- `src/components/Solitaire/Solitaire.tsx` - Main game component
- `src/utils/solitaire/types.ts` - Type definitions (Card, GameState, Location)
- `src/utils/solitaire/rules.ts` - Game rules and validation
- `src/utils/solitaire/solver/` - AI solver for winnability analysis
- `src/hooks/useSolvabilityAnalysis.ts` - Async solver hook

### Solitaire Debug Console

A JavaScript debug interface is available at `window.solitaire` when the game is loaded. Use it to inspect state, execute moves, and debug game mechanics without using the UI.

```javascript
// State Inspection
solitaire.show()           // Print ASCII game board to console
solitaire.state()          // Get raw GameState object
solitaire.json()           // Get state as JSON string

// Undo/History
solitaire.undo()           // Undo last move
solitaire.history()        // Get history array

// Hints & Analysis
solitaire.hint()           // Get recommended move (from solver if available)
solitaire.moves()          // List all legal moves
solitaire.solvability()    // Get solvability analysis result

// Move Execution
solitaire.move(from, to)      // Execute validated move
solitaire.forceMove(from, to) // Skip validation (for edge case testing)

// Location formats:
//   'stock', 'waste'       - Stock/waste pile
//   'f0' to 'f3'           - Foundation piles
//   't0' to 't6'           - Tableau columns (top card)
//   't3:2'                 - Tableau column 3, card at index 2

// Examples:
solitaire.move('waste', 't3')    // Move waste top to tableau 3
solitaire.move('t2:4', 'f0')     // Move tableau 2 stack from card 4 to foundation

// Shortcuts
solitaire.draw()           // Draw from stock
solitaire.autoplay()       // Auto-play safe foundation moves
solitaire.find('Kh')       // Find King of hearts location
solitaire.find('10d')      // Find 10 of diamonds
solitaire.card('t3')       // Get card at tableau 3

// Serialization (copy/paste game states)
solitaire.copy()           // Copy game+history to clipboard
solitaire.paste()          // Load from clipboard
solitaire.encode()         // Get encoded string without clipboard
solitaire.decode(str)      // Load from encoded string

// Game Control
solitaire.newGame()        // Start fresh game
solitaire.win()            // Trigger win state (debug only)

// Help
solitaire.help()           // Show all available commands
```

Debug interface files:
- `src/hooks/useSolitaireDebug.ts` - Main debug hook
- `src/utils/solitaire/debugHelpers.ts` - Helper functions

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
- `src/components/Typing/SyncStatus.tsx` — the indicator on the book-picker row
- `src/components/Typing/ConflictModal.tsx` — shown when the two have genuinely branched

The indicator shows the outcome of the last attempt and nothing else: "✓ Synced" when progress is
on the account, "✕ Sync failed · 2 min ago" when it is not. Work in flight is not shown — it is
transient, no one acts on it, and a spinner beside the passage is motion someone typing has to
ignore. A failure is what persists and what can be clicked to retry. The success case shows the
word without the age; the exact time is in the tooltip.

The outcome cannot come from `SyncStatus` alone: it is a precedence ladder, so `syncing` outranks
`error` and a failing retry reads as healthy. `describeSync` reads `error`/`conflict` alongside
`lastSyncedAt`/`lastFailedAt` instead, which is why `SyncState` carries `lastFailedAt` at all.

The book-picker row is a Win95 dialog line: `Book [combo box]` at the left margin, the indicator
at the right one, held apart by `margin-left: auto` on `.typing-sync-slot`. The slot is borderless
and its width is a floor (13rem), not a cage — nothing sits to its right, so a long failure string
grows leftward into slack instead of being clipped. Polish runs to 276px measured; reserving that
permanently for an indicator that is 73px wide in the state it actually holds would eat a third of
the row. `.typing-book-combo` wraps the `<select>` because one element cannot draw both a sunken
field and a raised drop-down button; both its pseudo-elements are `pointer-events: none` so clicks
still reach the control.

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

### Frontend logging

Structured logs buffer in localStorage and upload in batches to `users/{uid}/logs`. They keep
buffering while signed out and flush once a user resolves.

```javascript
typingLogs.show(40)     // print the last n entries
typingLogs.find('sync') // entries whose event name contains a string
typingLogs.dump()       // the whole buffer
typingLogs.flush()      // upload now (needs sign-in + network)
typingLogs.verbose()    // mirror new entries to the console (persists)
typingLogs.info()       // client id, page id, uid, buffered count
typingLogs.help()
```

`progress.revert.detected` is an `error`-level assertion that fires if progress ever moves
backwards by more than a single-section backspace. If it appears, the entry carries before/after
snapshots and the sync status at the time.

## Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized.

### Adding translations

1. Add the key to both `en` and `pl` objects in `src/i18n/index.ts`
2. Use the `useTranslations` hook in components:

```astro
---
import { useTranslations } from '../i18n';
const t = useTranslations(lang);
---
<span>{t('myKey')}</span>
```

### Translation key conventions

- Use dot notation for namespaced keys: `statusBar.lastUpdated`, `song.chords`
- Group related translations with comments in the i18n file

## Workflow

When work is finished, commit and push directly to `main`. Don't create feature branches
or pull requests for routine work unless I explicitly ask for one.
