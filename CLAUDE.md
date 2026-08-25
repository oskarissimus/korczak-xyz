# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

The Astro site is `korczak-xyz/`; all npm commands run from there. `resume/` is a separate
subproject.

## Solitaire Game

The solitaire game is at `/apps/solitaire/`. A JavaScript debug interface is available at
`window.solitaire` when the game is loaded — see the `solitaire-debug` skill.

## Typing Trainer

The trainer is at `/apps/typing/`. Progress syncs to Firestore under `users/{uid}/progress/{bookId}`
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

## Songbook

Songs are fenced `plaintext` blocks at `src/content/songs/pl/`, chord line above lyric line,
aligned **in characters**: the chord at column N is drawn over the character at column N below
it. `SongPostPage.astro` re-emits each line verbatim inside `<span class="chord-line">` and lets
`white-space: pre-wrap` in a monospace font do the positioning. Transposition is the only thing
that rewrites a chord line, and `transposeLine` puts every chord back at the column it started
in for exactly this reason.

So nothing may change the chord line's metrics, and `.chord-line` in `song.css` carries the
list. `font-weight: bold` was on it for years and is the trap: we self-host VT323 at weight 400
only, so bold is **synthesised**, and WebKit's CoreText backend synthesises it by adding
`size / 36` to the advance of every glyph (`m_syntheticBoldOffset` in `FontCoreText.cpp`, added
to the advance in `WidthIterator.cpp`). Against VT323's 0.40em cell that is 1/14.4 of a cell per
character — **a ratio independent of font size**, so no size setting escapes it. The chord line
stretched against the lyrics beneath it and a chord at column N drew at column N × 1.069: half a
cell out by column 8, a whole character by column 14, two by column 29. In `Sto psot` the D sits
at column 14 of `Bo koty lubią psoty`, which is the `p` of *psoty*; it drew at 14.97, over the
`s`. Every chord past the first few in the song was wrong, and the further right, the wronger.

It is invisible on anything but an Apple device, which is what makes it worth writing down.
Skia and FreeType embolden by stroking the glyph and leave the advance alone, so Chromium and
WebKit-on-Linux both place the chord exactly — measured at 0.01px — and only Safari and the
installed songbook show the drift. A rendering test here can therefore never catch it.
`src/styles/chordAlignment.test.ts` reads the stylesheet as text instead and guards the
declaration, the way `pwa/tiers.test.ts` guards facts no test can reach by running the thing.

The weight is kept as paint: `text-shadow`, which is what WebKit itself draws for synthetic bold
(the glyph again, offset by `size/36`) minus the part that reaches the layout. Same rule, same
reason, as the boxed marks in `chordMarks.css` — a glyph's ink may overhang, its advance may not.

The side layout (`renderSideLayout`) is exempt from all of this: it strips the positioning
spaces and puts the chords in their own flex column, so `.chord-col` may be bold and is.

## Guitar Flashcards

One spaced-repetition app at `/apps/flashcards/`, holding two decks: the notes on the neck and
moving chords between keys. They were two apps — `/games/fretboard/` and `/games/transpose/`, back
when the section was `/games/` — and
the two sections below still describe their cards, because the cards did not change. What changed is
that there is now one entrypoint, one installable app, and **one sitting that mixes both decks**.

Three tabs: `Practice`, `Neck stats`, `Chord stats`. The progress pages stay two because they measure
different skills over separate histories — the neck heatmap and the chord-key table are not two views
of one number — and folding them behind a switch would hide half the answer behind a click. The old
routes are 301s in `public/_redirects`.

### Mix the queue, not the data

**No data moved.** `createSrsStorage('fretboard')` and `('transpose')` keep their eight localStorage
keys each, and `users/{uid}/fretboardSessions` / `transposeSessions` keep their documents. That is
what makes the two stats pages separate *by construction* rather than by a filter, it is why the merge
needed no migration and could not lose a schedule, and it is why `useFretboardData` and
`useTransposeData` are still two near-duplicate hooks (125 diff lines) rather than one parameterised
one. `useFlashcardsData` mounts both side by side and adds only what belongs to the sitting.

What is merged is the *sitting*. A card id is opaque to `src/utils/srs/`, so both decks fit in one
queue once their ids are told apart — `fb|find:1-4:b`, `tp|degrees:9:145:de`:

- `src/utils/flashcards/trainers.ts` — `qualify` / `unqualify`. `|` is the separator because neither
  grammar contains one; `trainers.test.ts` asserts that over the whole of both scopes rather than
  trusting it, since a grammar that grew a `|` would fail silently as answers filed against ids
  nobody minted.
- `src/utils/flashcards/mix.ts` — `buildMixedQueue`. **One `buildQueue` call, not two queues woven
  together.** Selection there is by due date, so one call means the sitting takes whatever has waited
  longest across both decks: a deck left alone for a fortnight fills it, a deck that is caught up
  contributes nothing. Two queues built to their own lengths and interleaved would guarantee each deck
  a share of every sitting, which sounds fair and is the scheduler being overruled twice. The `spread`
  key is namespaced by trainer, so each deck's own rule applies to its own run and a neck card is
  never held apart from a chord card — they cannot give each other away.
- `src/utils/flashcards/settings.ts` — `trainers`, `sessionLength`, `newPerSession`, at
  `flashcards-settings` and `users/{uid}/flashcards/settings`. Those last two **left both trainers'
  `Settings`**: a mixed sitting has one length, and a copy on each deck is two numbers that must agree
  with nothing to make them. Each `buildQueue` takes a `QueueShape` parameter now. The migration reads
  whichever trainer had stored a shape, fretboard first.
- `src/utils/flashcards/sync.ts` — `mergeSync`, one badge over two syncs. One rule matters: **a half
  that failed is never reported as synced**, so the precedence is `error > syncing > off > idle` and
  `lastSyncedAt` takes the older of the two.

**A qualified id exists only inside one sitting's queue.** It never reaches a `ReviewEvent`, never
localStorage, never Firestore. The one place a qualified id is deliberately handed onward is the
summary, which builds a display-only copy of the events so each missed line can be named by the
trainer that owns it and `byDirection` reads `neck · find` rather than folding two vocabularies into
one column.

One sitting produces **two commits under one session id** — `fretboardSessions/{id}` and
`transposeSessions/{id}`, the same `id`, which is what lets the two records be recognised as its
halves. `ReviewEvent.id` is `${sessionId}-${ordinal}` with the ordinal counted **once across both**,
so ids stay unique in each log. A deck that contributed nothing gets no record: `finishSession`
already returns null and clears its orphan key on zero events, which also means a tab closed
mid-sitting is recovered independently on each side, by the hooks that always did it.

### The components, and where the seam is

`FlashcardsSession` is the loop both trainers used to keep a copy of — the queue, the working deck,
the answer log, `requeue`. **Nothing in it knows what a card is.** It reads a trainer off the queued
id, hands the rest to that trainer's card component, and takes back one submission: right or wrong,
what was answered, and how many places the card asked for. That last one crosses the seam rather than
being decided centrally, because the rating's speed thresholds are per place and only the card knows
how many it wanted.

- `src/components/Flashcards/FretboardCard.tsx`, `TransposeCard.tsx` — parse, the answer surface, the
  keyboard, and the verdict readout. Each is keyed on the queue position, so a card mounts fresh and
  has nothing to reset, and each holds its own verdict rather than reading one down through props —
  the verdict is made of what was pressed and what should have been, facts only the card has.
- The keyboard is the card's while the card is unanswered and the runner's afterwards, because
  carrying on past a wrong answer is the runner's business.
- Each trainer's `SettingsPanel` is now **rows only**, composed by `Flashcards/SettingsPanel.tsx`
  under a heading. A scope belongs to the deck it describes; the sitting belongs to the app.
- The two `translations.ts` are **deliberately not merged**. They overlap by about forty keys and
  disagree on a dozen — `answerWas` is `It was {note}` in one and `Answer: {answer}` in the other,
  `notationGerman` is the single letter `H` in one and a sentence in the other — so one namespace
  would silently pick a winner per key and the losing card would print the wrong template. Each card
  is drawn with its own; `Flashcards/translations.ts` holds only what belongs to neither.

One naming debt, written down so it is not rediscovered: **`.fb-*` is two families now.** The generic
half — buttons, tiles, the start screen, the session bar, the settings rows, the summary, the sync
badge, the feedback line — is the *merged app's* chrome and is drawn on the chord cards' screens as
much as the neck's; only `.fb-neck-*`, `.fb-diagram`, `.fb-pad-*`, `.fb-stage` and `.fb-heat-*` are
really about a fretboard. `transpose.css` still carries its own copy of the generic half for
`TransposeStats`. Collapsing both into `.fc-*` is ~40 class names across two sheets and every
component and changes no behaviour, so it was not done in the same commit as the merge.
`flashcards.css` is the one sheet every page imports, and it is the only place the four shared sheets
are pulled in — `fretboard.css` and `transpose.css` used to carry those `@import`s each, and importing
one file from two sheets inlines it twice.

## The neck cards

Spaced-repetition flashcards for the notes on the neck. Most cards are one
position, drilled **both ways round** on independent schedules: `name` shows the dot and asks
what it is called, `find` names the note and a string and asks where it is. Reading a diagram
and finding G on the A string mid-song are different skills, and the scheduler has no business
assuming one implies the other. On a black key `find` is split again, once per spelling — see
below. A third direction, `pitch`, is not about a position at all, and two more — `allNote` and
`allPitch` — are not about *a* place but about all of them at once; see further below. And a card
is split once more wherever the two notations call the note different things, so `C♯` and `Cis`
can both be in the deck rather than one or the other — see *Both notations at once*.

Answers are a tap — a set of taps and a check on the two select-all directions — and never a
self-grade. Correctness is objective and the SM-2 rating comes from correctness plus how long it
took (`≤2s` easy, `≤5s` good, slower hard, wrong again, **per place the card asked for**) — which
is what makes the per-position accuracy and speed on the stats page measurements rather than
claims. `srs.ts` is Anki's shape: minute-scale learning steps (1m, 10m) before day-scale
intervals, relearning after a lapse, mature at ≥21 days.

- `src/utils/srs/` — **shared with the chord cards**: `scheduler.ts` (SM-2, was `fretboard/srs.ts`),
  `replay.ts` (the merge core), `types.ts` (the record shapes), `queue.ts` (selection and running
  order), `history.ts` (summaries and snapshots), `storage.ts` (`createSrsStorage`), `cloud.ts`
  (`createSrsCloud`). See *Two decks, one scheduler* below.
- `src/utils/fretboard/` — what is about a neck: `notes.ts` (tuning, card ids), `diagram.ts`,
  `deck.ts` (scope, `spreadPositions`, `positionSubject`), `stats.ts` (the heatmap), `storage.ts`,
  `cloud.ts`, `keys.ts`
- `src/hooks/useFretboardData.ts` — this deck's local state, upload queue, pull and merge; mounted by
  `useFlashcardsData` alongside the chord one
- `src/components/Fretboard/` — the neck's own parts: `NeckGrid`, `NoteCard`, `NotePad`,
  `FretboardStats`, the settings rows, `describeCard`, `translations`. The card that assembles them
  is `Flashcards/FretboardCard.tsx`.
- `src/components/srs/` — `Verdict.tsx`, `MasteryChart.tsx`, `TrendChart.tsx`, shared with the chord
  cards; their styles are `verdict.css` and `srsCharts.css`, pulled in by `flashcards.css` the way
  `tabs.css` is. Their empty state is `.srs-empty` and not `.fb-empty` — an app prefix in a shared
  component meant the chord-progress page rendered an unstyled empty chart, which is invisible until
  the one page that lacks the sheet has no data.

### A black key is two `find` cards, one per spelling

"Where is C♯ on the A string" and "where is D♭ on the A string" have the same answer and are not
the same question. A card that asked under both names at once (`C♯/D♭ on the A string`) could be
passed while only ever reading one of them, and music written in flats never mentions C♯ — so the
`find` direction is split by `Spelling` (`'sharp' | 'flat'`), and the two halves are separate
cards on separate schedules for exactly the reason the two directions are.

The `name` direction is **not** split: it asks what a pitch class is called, and both names are
right, so its pad goes on showing `C♯/D♭`. A natural has one name under either spelling, so it
stays one card each way round. `hasTwoSpellings` is what decides, and it reads `PITCH_CLASSES`
(now `{ name, sharp, flat }`) rather than a second list to keep in step.

The flat card's id carries `:b` — `find:1-4:b`, the ASCII flat the songbook's transposer already
writes — and **the sharp card is the unsuffixed one**. That is a migration, not a preference:
`find:1-4` is what every stored deck and every logged answer already names, so reading it as the
sharp card keeps the schedule it earnt and lets the flat card arrive as the new material it is.
`parseCardId` rejects a `:b` that could never have been minted (a `name` card, or a natural),
because such an id is a corrupt record and not a card to fold answers into.

Which positions are two cards must not move with the notation setting, or a deck would change
shape when a display option is touched. It cannot: German notation *renames* and never merges —
`A♯`'s flat name is `B` there rather than `B♭`, still two names — so `hasTwoSpellings` answers
without being told the notation at all.

`spreadPositions` needed nothing for this. It keys on the position, and the two spellings share
one; they are in fact the sharpest case it exists for, since they share the answer too and back
to back the second is not read at all.

### A `pitch` card is a pitch, not a place

`find` bakes a string into the question. The skill it therefore never asks for is the one you use
when someone calls a note at you: `C♯4` — find it *anywhere*, and choosing the string is part of
the answer rather than part of the question. So `pitch` is a third direction on its own schedule,
by the same argument as `name` against `find`, and **one way round only**: the reverse ("which
pitch, with octave, is this dot?") would need a pad of forty-odd buttons and would mostly test
arithmetic.

Octaves are **sounding pitch, not written pitch** — the open low E is `E2`, the open high e is
`E4`. That is what a tuner shows and what `TUNING_MIDI` already says; writing a guitar an octave
up is a notation convention this game does not otherwise take part in. `octaveAt` had said so in
a comment since it was written, and was dead code outside its test until now. At `maxFret: 12` the
deck spans `E2`–`E5`, 37 pitches.

The card id is `pitch:${midi}`, because the MIDI number *is* the question — one pitch, one card,
however many places on the neck sound it. That breaks the assumption every other part of this game
had been able to make, that a card decodes to a `(stringIndex, fret)`, so `parseCardId` returns a
**discriminated union** and `isPositionKey` is the narrowing. That was the point of the union
rather than optional fields: the compiler names every site that assumed a place, and there were
more of them than a search would have found. The spelling split applies here as it does to `find`,
for the same reason — `pitch:61` and `pitch:61:b` are `C♯4` and `D♭4`.

**Any one correct position grades the card**, and the verdict then lights up the others, so the
alternatives are still taught. `positionsSounding` is the cross-string sibling of `fretsSounding`
and compares whole MIDI numbers rather than pitch classes — the open low E and its twelfth fret
are one answer to a `find` card and two different pitches here.

`scopeIds` enumerates these over `midisInScope` rather than over the grid: the fret × string loop
would mint the same pitch several times, once per place that plays it. Everything else about scope
is unchanged — `ensureCards` still never removes, so narrowing the strings leaves an unreachable
pitch's schedule intact.

`spreadPositions` keys a pitch card on the **lowest position that sounds it**, computed over the
whole neck so the grouping is a property of the card and not of the current settings. One key per
card is all that function has, and that is the most useful one: the two spellings of a pitch share
it (the same-answer case again), and the card is also held apart from the `name`/`find` cards on
that square. The pitch's other squares are uncovered, and a leak there is the mild kind.

The neck heatmap leaves these out. A pitch card belongs to no one square, so folding it onto all
three or four would count one card several times and onto one of them would name a place the card
never did. `positionStats` skips them and `neckHint` no longer claims to count everything.

`NeckPicker` is position-valued for this — `liveStrings`, `chosen`, `answers`, `onPick(string,
fret)`. Every string in the scope is live, so vertical aim starts mattering where it did not
before; the rows are 40px, which is a whole touch target, and the horizontal precision the ~19px
cells demand at 320px is the same as it always was. `cellLabel` replaced `fretLabel` because a
screen reader now has 78 buttons to tell apart rather than 13, and the prompt no longer names a
string to tell them by.

The keyboard does **not** answer these. `fretFromKey` returns a bare fret, and a fret without a
string says nothing here; a two-keystroke string-then-fret mapping would be modal state for a
control that is a tap away. The advance key still works.

One thing to know about deploying it: a stale bundle reading `directions: ['name','find','pitch']`
out of the synced settings mints ids its own `parseCardId` rejects, and a sitting comes up empty.
No new direction token can ever be safe backwards, so this is accepted rather than fixed — the
service worker is network-first for documents, so the window is a page already open across the
deploy. What *is* fixed is the forward case: `loadSettings` filters `directions` against
`DIRECTIONS`, and `FretboardCard` reports the id unreadable so the sitting skips it instead of
rendering nothing.

### Asking for every place is a question neither of those asks

`find` and `pitch` are satisfied by the first place you think of, so neither ever makes you look
at the rest — and the rest is the useful part of the neck: a pitch class comes round every twelve
frets and the same pitch lies under three or four fingers at once. So two more directions ask for
the **whole set** and grade it all or nothing: `allNote` is *mark every E*, `allPitch` is *mark
every E3*.

- `allNote:${index}` is keyed on the pitch class — the index into `PITCH_CLASSES`, because a name
  would have to be spelt and the spelling is already `:b`'s job. Twelve cards (seventeen, with
  the black keys' flat spellings) however wide the neck is, since the card is the class and not
  the places that sound it.
- `allPitch:${midi}` is keyed exactly as its `pitch` twin is, and is a different card on a
  different schedule: the same answer set, a different question asked of it.

Both split by spelling and by notation for the reasons everything else here does.

**All or nothing.** A set missing one position is wrong, because "every E" is the question and
partial credit would report a fluency across the neck that was never demonstrated. That makes the
verdict's job telling the two failures apart: magenta `✕` on a place marked that should not have
been, an unfilled `○` on one that was missed. Which one got away is most of what there is to
learn from a missed card here, and a single "not quite" says none of it.

The rating's speed thresholds are **per place asked for** (`ratingFromAnswer`'s `targets`). Six
positions cannot be marked in two seconds by anyone, so measuring them against the one-tap budget
would grade every answer `hard` and hold the whole direction at day one forever. A budget per
place asks both kinds of card the same question — was each one recalled, or counted up.

`positionsAnswering` is the one place the answer set is decided, for every card answered on the
neck. Three things have to agree about it and they are in three files: the grader, the marks the
verdict lights up, and the per-place budget above. They disagreed once already, when `find`
counted the twelfth-fret octave and the readout under it did not. Note that the set moves with
the scope — widen the fret range and *every E* gains the twelfth frets — which is `fretsSounding`'s
rule from the beginning: the scope is the neck as far as this deck is concerned.

`NeckPicker` grew a `multi` mode rather than a second component: the cells accumulate a selection
(cyan, and `aria-pressed`, because nothing has been graded yet and green would read as a verdict),
and the check button commits it. The button sits *outside* `.fb-stage`, since the verdict is drawn
over the stage and the button has to stay pressable while the marks it produced are still on the
neck; it is greyed rather than hidden when nothing is selected, a control that appears on the
first tap being one nobody knew was coming. `Enter` commits too — the same key that carries on
past a wrong answer, which is the only other thing this screen asks you to confirm. There are no
per-cell keys, for `fretFromKey`'s reason: a fret without a string says nothing here.

The heatmap leaves these out exactly as it leaves out `pitch`, and `spreadPositions` keys them on
the lowest place they cover. Most of what a select-all card leaks about the squares it has just
had you mark cannot be keyed away by a function with one key per card — holding that run apart
would be a scheduler of its own.

One more direction token is one more thing a page open across a deploy cannot read; that trade is
the one the `pitch` section sets out, and it is still accepted rather than fixed for the same
reason. What protects the forward case protects these too: `loadSettings` filters `directions`
against `DIRECTIONS`, and `FretboardCard` reports it unreadable so the sitting skips it.

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

### The verdict

The written verdict under the card is precise and small, and a correct card is gone 700 ms later
— so it is read after the fact or not at all. `Verdict.tsx` draws the maru/batsu pair over the
box the card lives in instead: the diagram on a `name` card, the neck on a `find` card, wrapped
in `.fb-stage` for the positioning context. That wrapper also carries the `align-self:
flex-start` that used to be on `.fb-diagram`, because the diagram sizes to its own 27 characters
and a stretched wrapper would centre the ring in the empty panel beside the card.

It is an **SVG, not `✓`/`✕`** — neither glyph is in VT323, which is the whole subject of
`chordMarks.css`, and this one additionally has to centre over a grid. It is **unfilled**: on a
`find` card the marks underneath are the rest of the answer — which frets sound the note, which
one was pressed — so a disc would hide exactly what it is reporting on. A drop shadow carries it
over the navy instead. Both size caps earn their place: the neck is nearly square at 320px, so a
mark sized off height alone came out two frets wide and sat on the answer cells, and `max-width`
bounds it from the other side while the viewBox keeps it circular in the non-square box.

`.fb-choice--on` is the same rule a third time. Its sheet's own `.fb-choice:hover` is (0,2,0) and
beats a bare `.fb-choice--on` at (0,1,0), so every settings row across both trainers greyed out the
one button the pointer was resting on — which on a settings row is the button you are about to
click, so the row could not be read while it was being used. Invisible on a phone, which has no
hover at all.

The answer states beneath it (`.fb-neck-cell--right`/`--wrong`, `.fb-pad-key--right`/`--wrong`)
each name themselves **twice**, the second time with `:hover`. `Layout.astro` has a global
`button:hover { background: #a0a0a0 }`, and (0,1,1) beats a single class; the enabled cell is
protected by `.fb-neck-cell--live:hover:not(:disabled)` at (0,3,1), but answering disables the
buttons and takes that rule out with them. So the one cell the pointer was on — the one just
pressed, whose colour *is* the answer — went flat grey and stayed grey until the mouse moved.
It looked right on a phone, and on a mouse the verdict was the only thing you could not see.

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

German/Polish notation is a different set of names, not a different way of writing the same ones:
the accidentals are syllables (**Cis**, **Des**, **Fis**, **Ges**), the black key below B natural
is called **B** outright, and B natural takes a letter of its own — **H**. Exactly six of the
twelve come out differently; the naturals C D E F G A are the same word in both, which is why
`GERMAN_LABELS` in `notes.ts` is a sparse table rather than a second full one. The 2nd string
becomes the H string.

It is a property of the player rather than of the page's language — someone reading the English
page in Warsaw still wants H — so the locale only picks the default (`defaultNotationFor`), and
once the setting is touched it is stored and synced and follows the account across both locales.

The songbook's chord transposer (`src/utils/chords.ts`) prints `H` and `B` the same way but keeps
`#` for the rest, and that is **not** a disagreement to fix: a chord symbol is written `C#m` in
Poland as everywhere else, while the note under it is called cis. Chord symbols and note names
are two notations, and only one of them is the neck cards' business.

`PITCH_CLASSES[].name` stays international whichever is picked. It is what an answer is graded
against and what lands in `ReviewEvent.answered` in localStorage and Firestore, so a notation
reaching it would split one card's history in two — a deck practised one way and reviewed the
other has to stay one deck. `pitchLabel`/`spellingLabel`/`stringLabel`/`noteLabelAt` take the
notation as a **required** argument rather than defaulting to international, because a defaulted
one is how a single call site goes on quietly showing `B`.

`keys.ts` maps letters per notation rather than keeping one set of naturals and a shift rule: `H`
answers B natural, and `B` **unshifted** answers A♯, the letter being the flat name there. That
closes the existing shift hole from the other side — shift on `B` reaches for what `B` already
answers, so it does nothing. The syllables need nothing further: `Cis` is shift on the letter it
begins with, and `Des` has no key of its own exactly as `D♭` has none.

### Both notations at once, because `C♯` and `Cis` are two things to know

`notation` is **not** a display setting and has not been one since the deck gained a notation
axis. `Settings.notations` is a *list* — the panel's `B`/`H` row toggles like the directions row,
either or both — and a second notation puts a second card on a second schedule, by exactly the
argument that splits a black key's `find` card by spelling. Reading `Cis` and reading `C♯` are
different acts, and passing one is not passing the other.

Only where the two disagree about the word. `hasTwoNotations` decides by comparing what the card
would print under each — not against a list of pitch classes, so the axis cannot drift from the
names — and `cardId` **normalises the rest away**: `find:1-3` is C on the A string in both, so
there is no `find:1-3:de` and `parseCardId` refuses one. That is what lets `scopeIds` loop over
the selected notations and dedupe, and it is why selecting one notation leaves the deck exactly
the size it was.

The German card's id carries `:de`, after `:b`, and **the international card is the unsuffixed
one** — the same migration argument the spelling split made. Plain ids are what every stored deck
and every logged answer already name, from back when the notation never reached an id at all.
So a stored `notation: 'german'` migrates to `['international', 'german']`, not to `['german']`:
those cards *are* the international ones now (`ReviewEvent.answered` has always held
international names), and migrating to German alone would put a Polish player's whole deck out of
scope and start them again at zero. Adding German alongside keeps the work and lets the German
cards arrive as the new material they are.

The consequence to know: switching from one notation to the other is not a relabelling. Six of
the twelve pitch classes are genuinely different cards, and they arrive new.

Everything on a card is drawn in the **card's** notation — the pad it is answered on, the string
letters beside the neck, what the keyboard letters mean. A card that reads the same either way has
no opinion, so `cardNotation` has it borrow `displayNotation`; otherwise a player drilling German
names would meet an international pad on every card that happened to land on a natural, mid
sitting, for no reason they could see. `displayNotation` is also what the two pictures that are
not cards use — the settings panel's string row and the stats heatmap — and it prefers German
whenever German is in the deck at all, that being the marked case.

`spreadPositions` needed nothing for this either. The two notations of one position share its
key, which is the same-answer case the spellings already were.

The Win95 tab strip is shared with the typing trainer as `src/styles/tabs.css` (`.win-tabs` /
`.win-tab`), pulled in by each app's stylesheet with `@import`, so a page picks it up through
the one stylesheet it already needed.

## Two decks, one scheduler

`src/utils/srs/` is what the two decks genuinely share, and the line is drawn at **what does not know
what a card is**. A card id is an opaque string in every file there; each deck owns its own grammar
for it and its own parser, and nothing in that directory ever looks inside one. That is exactly the
property `src/utils/flashcards/mix.ts` exploits to put both decks in one queue.

- `scheduler.ts` — SM-2 with learning steps. Pure, takes `now`, which is what makes the deck a fold.
- `replay.ts` — union by id, refold. The whole argument is in its header.
- `queue.ts` — `buildQueue`, `requeue`, `spreadBy`. Selection by due date, order by shuffle.
- `history.ts` — `summarizeSession` takes a `directionOf` callback rather than a parser, which is
  the one place the split needed a seam.
- `storage.ts` / `cloud.ts` — **factories**, not modules of functions. `createSrsStorage(prefix)`
  is per instance so the two decks cannot evict each other's event log under quota pressure, which
  a shared `failingKeys` set and a shared eviction target would have let them do. It is also what
  keeps the two histories apart now that one sitting writes to both.

What stayed with each deck is what has an opinion about the material: the scope enumeration, the
card-id grammar, and the `spread` function that pulls apart cards which would answer each other.

## The chord cards

Spaced-repetition flashcards for moving chords between keys. Three
directions, and they are three skills rather than three ways of asking one thing — the same
argument that splits the neck cards' `name` from their `find`:

- `transpose` — *A D E, into the key of C*. Move a progression you are looking at. Two valid
  routes: count three semitones onto each chord, or read the degrees and re-issue them.
- `degrees` — *I, IV, V in A*. Issue a key's chords from nothing, with no progression to move.
- `key` — *A D E — what key?* Recognise a set of chords, which is what makes the other two more
  than arithmetic.

Four patterns: `I IV V`, `I IV V vi`, and the two minor ones the songbook actually plays — `i iv v`
and `i iv V`, the second raising the seventh, which is `a d E` and `e a H7` and half the library.
All permutations of source and target key, and **every ordering of the chords within one** — see
below. `Settings.keys` narrows the deck: `all`, `songbook` (the keys the songs here are written in),
or a list of tonics you pick off a row of twelve.

- `src/utils/transpose/` — `theory.ts` (keys, degrees, names), `cards.ts` (card ids, notation
  canonicalisation), `deck.ts` (scope, `spreadSubjects`, `cardSubject`), `library.ts` (the songbook
  index), `keys.ts`, `stats.ts`, `storage.ts`, `cloud.ts`, `collect.ts` (build-time only)
- `src/hooks/useTransposeData.ts` — mounted by `useFlashcardsData` alongside the neck one
- `src/components/Transpose/` — `AnswerSlots`, `ChordPad`, `TransposeStats`, the settings rows,
  `describeCard`, `translations`. The card that assembles them is `Flashcards/TransposeCard.tsx`.

### Every ordering of a pattern is its own card

`chordsOf` returns a pattern's chords in degree order and, for a long time, nothing anywhere
reordered them — so every card in this trainer printed its tonic first, and all three directions
leaked their answer because of it:

- `key` — *H E F# — which key?* is answered by reading the first chord. The other two are never
  looked at. This is the card that prompted the change.
- `transpose` — *A D E → into C* can be answered without reading the source progression at all:
  take the target key off the prompt and spell its I IV V. The chords you were asked to move are
  decoration.
- `degrees` — always *I, IV, V in A*, in that order, so the row is answered by counting 0, 5, 7 up
  from the tonic once rather than by knowing each degree on its own.

Shuffling the order per appearance would have fixed all three, and more cheaply. It is a **deck
axis** instead — `Order` in `cards.ts`, a permutation of the degree positions — because reading
`F# H E` as B major is a thing to have learnt, and a thing learnt gets a schedule here, by the
argument that splits a black key's `find` card by spelling and every card by notation.

`promptChords` and `answerChords` apply the *same* permutation, which is what keeps a `transpose`
card gradeable slot by slot: slot `i` answers prompt chord `i`. `answerChords` carries the numeral
with each chord for the same reason — the degree printed under a `degrees` slot and the chord that
slot is graded against now come out of one list, where they used to be two independent `chordsOf`
calls and two places to apply an ordering.

The suffix is `:o201`, written **after** the notation one (`degrees:9:1456:de:o1203`), and **degree
order is unsuffixed**. That is the migration `:b` and `:de` both made: `key:11:145` is what every
stored deck and every logged answer already names, so it keeps the schedule it earnt and the other
orderings arrive as the new material they are. `parseCardId` reads the two suffixes as a bag and
lets the existing round-trip reject the rest — a pair written the wrong way round, a repeat, a
permutation of the wrong length, and an explicitly written `:o012`.

`cardLabels` stays in degree order, and that is load-bearing rather than an oversight: permuting
cannot add or remove a word, so the notation axis cannot depend on the ordering axis — which is
what lets `canonicalNotation` be **memoised** on a cache key with the order stripped out. Without
the memo `scopeIds` builds tens of thousands of label arrays, and it runs on every `buildQueue` and
every stats render.

**The cost is `n!`** — six cards for a three-chord pattern, twenty-four for `I IV V vi`. At the
default scope that is ~530 cards becoming ~8,000, about 1.6 MB of the ~5 MB origin budget, and the
deck cache is the one thing `createSrsStorage` never evicts. Which is why the key picker and
`Settings.orders` both exist, and why the start screen's `/{total}` tile is the number to watch.

`Settings.orders` is that second control, and it is a different question from the axis itself.
The axis says every ordering *is* a card; `OrderScope` (`'degree' | 'shuffled'`, either or both,
the `Chord order` row) says which of them to be asked right now — because `i iv v` in one key is a
thing you sit down to work on, and you may want it as it is written, which is how you play it, or
only scrambled, which is what makes you read it. `degree` alone is precisely the deck as it stood
before the axis existed: one card per question, and the very cards every stored schedule was
earnt on. A **scope**, so `ensureCards` parks the rest rather than deleting them and switching
`shuffled` back on finds the work still there.

A record written before the setting existed has no key for it, so spreading it over
`DEFAULT_SETTINGS` supplies both and a deck stored by the build that shipped the axis is
unchanged.

Two things needed nothing for this. `subjectOf` is still the card's *answer*, so every ordering of
one key shares one and `spreadSubjects` holds them apart — back to back, `H E F#` and `E F# H` are
one question asked twice, which is the giveaway arriving by another route. And `keysProducing`
compares chord *sets*, so the `key` direction stays answerable under any permutation.

What did change is that `spreadBy` can no longer always separate them: a chord subject now holds a
dozen cards where it held two, and a sitting can run out of subjects before it runs out of cards.
Its fallback is what makes it total, and `mix.test.ts` asserts the real guarantee rather than the
old one — a repeat may appear only where *every card still to be placed* shared a subject with the
last few, which is to say where there was nothing else to put there.

### Picking the keys

`Settings.keys` is `'all' | 'songbook' | PitchClass[]`. The two words stay words rather than
becoming presets that fill a list, because `songbook` resolves **per pattern** — C D E F G A for
`I IV V`, A D E G for `i iv V` — and a flat list of tonics cannot say that. `tonicsFor` resolves
the three cases; `effectiveTonics` unions them across the selected patterns, which is what the
panel's twelve key buttons draw their lit state from, so a preset shows what it resolves to rather
than an empty row. Touching any key turns that resolved set into an explicit one.

`sanitizeSettings` is the single choke point for both localStorage and the cloud copy, so the list
is validated, deduped and sorted there — two records meaning the same scope should not differ — and
an empty or unrecognised one falls back to the default the way `keepKnown` protects the other three.

### A key spells its own chords

There is no sharp/flat axis here, the way there is on the neck cards' `find` direction, because a key
is not free to choose: the IV of F is B♭ and never A♯, and the V of B is F♯ and never G♭. Each key
carries the spelling its signature dictates (`MAJOR_SPELLING`, the circle of fifths — D♭ over C♯,
F♯ over G♭ on the one genuine tie) and every chord drawn from it is written that way. One fewer
axis on the deck, and one more thing the deck teaches: you tap a pitch class off a pad offering
both spellings, and the slot answers with the one the key wants.

### The `key` direction is only answerable because of the patterns

No two of the 48 (tonic, pattern) pairs produce the same set of chords, so *what key is this* has
one answer. {C, F, G} is C major and nothing else — F major wants a B♭, G major wants an F♯ — and
the minor patterns cannot collide with the major ones by shape (all-minor, or two-and-one, against
all-major or three-and-one). That is a property of these four patterns rather than of harmony, so
`theory.test.ts` asserts it over the whole deck instead of trusting the argument. Add a fifth
pattern and that test is the thing that will tell you whether the direction still works.

### Three notation systems, not two axes

`polish` (`C#`, `a`, `H`, and `B` for B flat — every chart in `src/content/songs/`), `german` (the
same with syllables: `Cis`, `Des`, `Es`, `Fis`) and `international` (`C#`, `Am`, `B`, `Bb`).
`Settings.notations` is a list, either or any, and it is a **deck axis** rather than a display
setting for the reason the fretboard's is: reading `Es` and reading `E♭` are two acts. The trap the
first two exist for is the letter B, which is B flat in a Polish chart and B natural in an English
one with nothing in the context to tell you which.

It was two independent axes first — how a black key is spelt, and what B means — and that is
**wrong**, because whether minor is written `Am` or `a` belongs to both of them. Four combinations
produce three readings, so a card printing `C F G a` under three of them got two schedules for one
question. Naming the systems is what makes the split factor.

A card splits only where its own words differ (`canonicalNotation`, decided by comparing what the
card would print rather than against a list of pitch classes). `C F G` is one card, `F B C` is two,
`A D E f#` is three. Suffixes `:de` and `:in`; Polish is the unsuffixed one, and `parseCardId`
refuses a suffix that could never have been minted.

**`displayNotation` is not `canonicalNotation`, and conflating them is the trap.** The canonical
notation is what the card is *filed* under and collapses systems the card cannot tell apart:
`D G A → A♭ D♭ E♭` reads the same in Polish and international, so it is the Polish card either way.
But the **pad shows all twelve pitch classes**, including ones the card never prints — so drawing
it canonically put a button labelled `B` in front of a player who had selected international names
only, where `B` is B natural and here it meant B flat. The app handing over the exact confusion the
axis exists to drill. `displayNotation` returns the first *selected* system that would have minted
the card, whose labels are identical to the card's by construction; the keyboard map reads it too,
since `B` on the keyboard has to mean what the button labelled `B` means. Its fallback is the
card's own notation and **not** the selection — falling back the other way prints `As Des Es` on a
card filed as `Ab Db Eb`, which is the same bug with its halves swapped.

### Answers are taps, and all or nothing

A pad of twelve pitch classes and a row of slots. Twelve rather than twenty-four because **the
pattern fixes each slot's quality** — the vi is minor whatever root you pick — so only roots are
ever tapped, and a pad of twelve fits across a phone.

A progression with one chord wrong is a wrong progression, so grading is all or nothing and the
verdict's job is saying *which* slot went wrong. `ratingFromAnswer`'s per-target budget does the
rest: a four-chord answer is not measured against the clock for one tap.

`transpose` slots are **unlabelled**. Printing `I IV V` under them would hand over the degree
route, and that route is one of the two ways to answer the card. A `degrees` card labels them,
because there the numerals are the question.

A `key` card is answered with a tonic and, when a minor pattern is in scope, a mode. Only then: in
a major-only deck every answer is major and the mode slot is a wasted tap on every card. The card's
shape therefore moves with the settings, the way *every E* on the fretboard gains the twelfth frets
when the range widens.

**The verdict is drawn beside the slots, not over them** — the one place this trainer parts company
with the fretboard's. There the mark goes over the neck because the neck is large and the marks
under it are dots; here the answer row is three or four short fields and every one of them *is* the
answer, so a mark centred on a three-slot row lands squarely on the middle one. `.tp-stage`
unpositions the shared overlay and it becomes a flex item at the end of the row.

It also drops the shadow, and for two reasons worth keeping apart. A filter's region is the
element's own box, so a shadow with no room left around the drawing is **clipped square**: the ring
is 91% of the viewBox whatever the box measures, so a 5px blur on the 56px mark this row pins it to
spills about 5px past every edge and comes back with corners — a soft dark square behind a circle.
Over the neck the mark is up to 124px on navy and the cut edge falls where nothing can see it. The
second reason is why removing it is right rather than merely cheap: the shadow exists so an unfilled
ring stays legible over the neck and the answer marks beneath it, and this mark is beside the slots
on bare panel with nothing under it at all. What it needed instead was a colour that reads on grey —
`#00ff00` on `#c0c0c0` is 1.3:1, which is what the shadow had been standing in for — so it takes
`.tp-verdict--ok`/`--bad`'s own ink and matches the words it is drawn next to.

### The songbook is where the examples come from

`library.ts` reads the song bodies through the songbook's own grammar — `isChordLine` and
`parseChord` from `src/utils/chords.ts`, which is what `parseChord` was added for — rather than a
second copy of the token regex, because a parser that drifted from the one the song pages use would
quietly disagree with them about what a song is written in.

A song is filed under (tonic, pattern) when it plays all of that pattern's chords **and** no other
candidate fits better. Two filters in order: diatonic share, then the chord the song opens on.
Without the first, *Here Comes the Sun* is filed under the four keys it happens to contain a I IV V
for; without the second, songs whose whole vocabulary sits inside two readings are filed under
both. Ties surviving both are kept, because a genuine tie is a fact about the song.

It runs at **build time**, in the page, over `getCollection('songs')`, and only the compact index
crosses into the island — titles and slugs, not the song texts. Not a generated file: one committed
alongside the songs is one that can fall out of step with them.

Two uses. The verdict names the songs behind the card — **after the answer, never before**, since
on a `key` card the title gives the answer away — and `Settings.keys = 'songbook'` narrows the deck
to the keys the library actually uses. As of writing that is C, D, E, F, G, A for `I IV V`, and A,
D, E, G minor for `i iv V`.


## Event Watch

At `/apps/events/` — three tabs (Feed, Interests, Alerts) over a shared corpus of scraped listings,
with web push when something matching an interest is announced, goes on sale, or gets close. The
first app here that watches the outside world rather than recording what I did, which is why it is
**signed-in only**: the collecting happens on a server and the notifications have to know where to go.

Two halves. `korczak-xyz/src/utils/events/` and `src/components/Events/` are the client;
`functions/` is a scheduled Cloud Function that collects and sends.

### One matcher, two runtimes

`src/utils/events/` is compiled **twice** — by Astro for the browser, and by `tsc` into the Cloud
Functions bundle, via `rootDir: ".."` and an `include` of `../korczak-xyz/src/utils/events/*.ts` in
`functions/tsconfig.json`. The feed and the collector both ask "does this event match this
interest?", and if they ever answer differently the feed shows things you were never told about and
pushes arrive for things the feed does not list.

This repo's usual idiom for one fact in two files is to read one as text and assert agreement
(`tiers.test.ts`, `chordAlignment.test.ts`) — but that is for cases where an import is *impossible*.
Here it is possible, and a copy plus an agreement test would only be identical until the first bug
fix. The price is that nothing in that directory may import outside itself: no DOM, no
`import.meta.env`, no `firebase/*`, no React. `portable.test.ts` enforces it, and the **`browser/`
subdirectory** holds the modules that cannot obey (localStorage, the Firestore client). `readdirSync`
does not recurse and the tsconfig `include` uses a single `*`, so the two agree by construction
rather than by a list.

### Keywords ask what an event says; tags ask what it is

Keyword matching is on **word boundaries**, because `'floyd'` inside "Floydwear" is an interest you
turn off, and `'opera'` inside "operacja" is worse. But whole-word alone is wrong for Polish, which
inflects everything: `klezmer` never reaches "koncert klezmerski", `rycerski` never reaches "turniej
rycerskiego". Loosening to a prefix match everywhere brings Floydwear straight back, so the choice is
**explicit rather than guessed**: a keyword ending in `*` is a prefix, anything else is a whole word.
The seeded Polish stems use it (`klezmer*`, `sredniowieczn*`, `rycersk*`); `floyd` and `opera`
deliberately do not.

**An empty keyword list means NO constraint, not "matches nothing".** The Opera Narodowa seed is
`tags: ['opera']` with no keywords at all, because "tell me when new repertoire is announced" is not
a keyword search. Reading empty as unsatisfiable makes that interest silently dead — matching
nothing forever, with nothing in the UI to say why. It is the first test in `match.test.ts`.

`haystackOf` deliberately does **not** read tags. It used to, and the result was that any tag a
source applies feed-wide became a blanket keyword hit for every row: tagging the Jewish Culture
Festival's feed `klezmer` made the Klezmer interest match all 67 of its articles, one of which was
about Ted Kaczynski. Tags are matched all-of and structurally, by `interest.tags`. That live run also
found `tagsFor` in the Teatr Wielki adapter falling through to `opera` for anything that was not
ballet, which handed the keyword-less Opera interest the entire season, galas included.

**A keyword-less interest has no second filter, so a generous tag is the whole of what reaches it**
— which is why that mistake keeps arriving from a new direction. The third time was Ticketmaster's
`tagsOf` mapping `genre.includes('classical')` onto `opera`, on the reasonable-sounding grounds
that an interest asking for opera should reach a ticketed listing and a Teatr Wielki one alike:
switching the real API key on took Opera Narodowa from 7 matches to 202, the other 195 being
candlelight Chopin recitals. It bought nothing either — their Polish catalogue has no `opera` genre
or subGenre at all, so the branch only ever fired on classical. The rule to apply when mapping a
source's vocabulary onto ours: **widen a tag only as far as the narrowest interest that uses it can
bear**, and let the raw genre slug carry the rest, which is what it is there for.

### What may wake me up

`notices.ts` is pure, so the whole "should this push fire?" question is reachable from a unit test
rather than from a phone at 7am. Three guards against the flood, and all three are needed:

- **`armedAt`** — written when notifications are first armed. Nothing already in the corpus at that
  moment can ever be `announced`. Without it, arming replays the entire corpus into the lock screen.
- **`interest.createdAt`** — a field of its own, *not* `Versioned.updatedAt`. Adding an interest
  surfaces its backlog in the feed and pushes about nothing; if this were `updatedAt`, editing one
  keyword would re-arm the whole backlog.
- **`maxPerRun`** (3) — the overflow becomes one summary, and the suppressed notices are still
  latched so they never fire individually later. This is what saves you when a scrape's markup
  shifts, every synthesised key changes, and an entire opera season looks new. `onsale` is exempt
  (capped separately at 10): tickets going on sale is the thing that was asked for, and it is not
  noise.

`soon` uses **`max`** of the matching interests' `leadDays`, not min — leadDays means "how much
warning I want". One notice per kind per fingerprint, never one per interest: the interests are *why*
it fired, not *what* fired.

**The notice document is a lock taken before sending, not a receipt written after.** `create()` fails
on an existing document, which is the atomic latch. Written after the send, a crash between sending
and writing repeats the push on the next run — the worst thing this app can do. Written before, a
crash loses one, which is invisible and recoverable. Lose one rather than send two.

Notice ids are `${slugKey(fingerprint)}|${kind}`. The separator is `|` because event ids contain
hyphens, and the key is the **fingerprint** rather than the event id so one concert listed by two
sources notifies once.

### The service worker, and why a name collision there is expensive

`generate-sw.mjs` now inlines **two** pure modules (`routing.js`, `push.js`) rather than one. They
share a single top-level scope after concatenation, and there is exactly one service worker for every
installed app on this origin — so a name declared in both is a SyntaxError that takes the songbook,
the tuner and the sleep log offline along with this app, until the next deploy. `swBundle.test.js`
parses the concatenation with `new Function` (which never touches `self` or `caches`) and names the
culprit file on a collision.

**iOS unsubscribes the app if a push event completes without showing a notification**, silently. So
`parsePushPayload` is total by construction — malformed JSON, an empty payload, a schema from a
future build all yield a showable title and body — and the handler has exactly one shape with no
early return. The sender emits a Declarative Web Push envelope (`web_push: 8030`) with the flat
fields alongside: on Safari 18.4+ the OS renders it even if our JS throws, and still dispatches the
push event, so the same tag collapses the two into one banner.

There is deliberately **no `pushsubscriptionchange` handler**. iOS never fires it, and on platforms
that do the worker could not act on it — no auth, no SDK, possibly no client to postMessage. It would
be code that looks like a safety net and is not.

### Keeping the subscription alive

iOS reports no `expirationTime` and fires no event when it drops a subscription after a few weeks of
the app not being opened. The only defence is looking on every launch: `useWebPush` calls
`getSubscription()` and, with permission already granted, re-subscribes **silently** (no gesture is
needed once granted). That check runs from the **Feed** island as well as Alerts, because the Feed is
the tab the icon opens — hanging it off Alerts alone means it never runs.

`Notification.requestPermission()` is the **first statement** in the click handler, before any
`await`. Put `await navigator.serviceWorker.ready` ahead of it and the gesture chain breaks on iOS:
the prompt never appears and nothing reports why.

Subscriptions are keyed by `sha256(endpoint)` so re-arming updates a row instead of adding one, and
the previous row is retired explicitly — iOS hands out fresh endpoints often, and a stale one is an
endpoint the collector pushes to until it earns a 410 that may never come. On the sending side,
**404 and 410 are the only codes that delete a subscription**: a 403 is a VAPID key mismatch, and
deleting on that would wipe every device the first time a secret is fumbled.

### The sources, and why three of the four are generic

Four adapter *types*, not four scrapers — `rss` and `ical` are driven by URL lists, so watching one
more festival blog is a line in `FEEDS`, not code. An adapter returns `RawEvent[]` and **nothing
derived**: the id, the haystack, the fingerprint and the day are computed by `upsert.ts`, so a new
adapter cannot get normalisation subtly different.

- **teatrwielki.pl** is the one bespoke scrape, and the source the app was really asked for. Note
  `/kalendarium/` is useless — a TYPO3 shell whose calendar is drawn by JavaScript, containing
  `data-day` attributes and no events. The **season page** (`/repertuar/sezon-2026/27/`) is plain
  server-rendered markup carrying title, genre, composer, premiere date and a stable slug. Titles
  contain inner tags (`<h2>COPP<span>É</span>LIA</h2>`), so they must be stripped. Individual
  performance nights stay behind the JS calendar; that is an accepted gap, since the question is
  whether Figaro is programmed, not which Tuesday. A **committed HTML fixture** is what turns the
  inevitable redesign into a red build rather than a silently empty feed.
- **python.org** is an iCal feed — 874 VEVENTs, mostly historical, so `collect.ts` drops anything
  already past. Geography is deliberately *not* filtered there: PyCon US may still be worth knowing
  about, and deciding that is the interest's job. RFC 5545 line unfolding is the one parsing bug
  worth naming: miss it and every long `SUMMARY` truncates at 75 octets, which looks like the feed
  having short titles.
- **RSS feeds** leave `startsAt` null on purpose. A feed item is an *article*: putting its `pubDate`
  in `startsAt` would file every post as happening today and then let `soon` fire about it.
- **Ticketmaster** can never produce an `onsale` transition — its listing *is* its ticket page. That
  is correct, not a gap. No API key is a configuration state, not a failure, so it returns `[]`.

`eventSources/{id}` records health, and **zero is a failure only when the source used to return
something**. Without that table the theatre could redesign, the scrape return `[]`, and the app go on
looking perfectly healthy while never announcing another opera — the most likely way this fails and
the least likely way anyone notices.

`functions/src/smoke.live.test.ts` runs every adapter against the real network under `LIVE=1`
(skipped otherwise, so CI and an offline laptop are unaffected). It is what caught both the haystack
bug and the opera over-tagging; run it after touching an adapter.

### Deploying it

`firestore.rules` gained `events/` and `eventSources/` — top-level collections are outside the
`users/{uid}` wildcard, so a feed that reads nothing usually means the rules have not gone out.

**Rules and functions now deploy from CI** (`.github/workflows/firebase-deploy.yml`), which is the
one place this repo's "deployed by hand" note no longer holds. It is path-filtered to `functions/`,
`firestore.rules`, `firebase.json` and `korczak-xyz/src/utils/events/**` — that last one because
`functions/tsconfig.json` compiles the matcher in from there rather than keeping a copy, so a change
to it changes the backend. Auth is Workload Identity Federation, so there is no long-lived service
account key in GitHub; the security boundary is the provider's `attribute-condition` pinning it to
this repository, and without that any repo on GitHub could mint a token for the pool. The workflow
holds a `concurrency` group because two concurrent function deploys race to create the same source
bucket and one loses with a 409.

One trap in `firebase.json`: the predeploy hook calls `./node_modules/.bin/tsc` directly rather than
`npm run build`. The firebase CLI is a bundled binary shipping its own node 20 and npm 8, and that
npm throws `Cannot read properties of undefined (reading 'stdin')` *after* the build has already
succeeded — failing a deploy whose output was perfectly good.

The functions need the Blaze plan, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `TICKETMASTER_API_KEY`
as secrets, and the public key **also** in Netlify's build environment as `PUBLIC_VAPID_PUBLIC_KEY`.
The VAPID public key can never change: rotating it invalidates every subscription on every device,
silently. Full sequence in `functions/README.md`.

Push works only from an app installed to the Home Screen — not from a Safari tab, ever. That is what
the `needs-install` state on the Alerts tab exists to explain, and why it is checked before
permission: on iOS in a tab there is nothing useful to say about permission, and a button that
silently does nothing looks exactly like a bug in the app.


## Baby Sleep Log

At `/apps/baby-sleep/` — nights and naps as one entry each, with a stats tab, a config tab and a
share tab.
`src/utils/babySleep/` holds the shapes and the pure logic, `useBabySleepData` the state and sync.

The reconciliation is **not** the typing trainer's: these documents are mutable but they are not a
branching document two devices edit into a conflict, so `merge.ts` is a CRDT-ish union by id
(`rev` → `updatedAt` → `writerId`, delete absorbing) and no conflict dialog is possible. The hook
**pulls before it pushes**, unlike `useFretboardData`, because a blind `setDoc` would land on top of
a correction made elsewhere.

**A local write does not go through any of that.** `commit` applies it by id (`applyLocal`), because
the human at the form is not a concurrent device: they are looking at the record and replacing it,
and there is nobody to arbitrate with. Routing it through the reconciler anyway is losable rather
than safe — see below, where it silently ate every routine logged for a night that had been deleted
once.

### Night wakings

A night broken by a waking is **two entries with a gap between them**, not one entry carrying a list
of wakings. The record shape does not change for this, and that is the point: an entry is one
contiguous stretch of sleep, so the per-entry merge rule already handles two rows without being told
anything, where a `wakes: [...]` array inside an entry would need a merge rule of its own for two
devices editing the same night.

Two ways in, producing the same rows. Live: tap "woke up", tap "night sleep" again when the baby
settles — nothing new was needed for that. After the fact: `split.ts`, cutting a sleep already logged
into the two halves it was really slept in, reachable from `Add wake` on any row with room for one —
naps included, and the sleep still running, whose second half stays running (the case where the
waking was slept through and only logged in the morning). The first half **keeps the entry's id**, so
another device receives an ordinary edit rather than a delete and two inserts, and both halves go
through one `commit` so no device ever sees a night that ends at the waking and has nothing after it.

`stats.ts` is where the blocks are read back as one night, through `nightBlocks`. Getting the total
right was free — `groupByDay` already summed several night entries into one `nightMs` — but the clock
times were not: `bedtimePoints`/`wakePoints` mapped over night *entries*, so a broken night gave its
day a 03:20 "bedtime" and a 03:00 "wake-up" that nobody experienced, pulling both circular means
towards the middle of the night. One point per night now: the first block's start and the last
block's end.

`nightBlocks` returns null while any block is still running, and that is load-bearing rather than
tidy. `nightMs != null` used to mean "this night is finished", because an unfinished night was one
open entry with no duration. A broken night has a closed first block, so it reports a duration while
the baby is still asleep — and the old test would have let half of tonight into the averages.

### The routine before a sleep

Two more facts, at the two moments they are known: **when the routine started** and **when he went
into the crib**. The gap between them is the routine; the gap from the crib to `entry.start` is the
part that actually moves — sitting beside him while he falls asleep — and it is what the stats tab
calls *time to fall asleep*.

It is not only a *bedtime* routine. A nap is led into the same way, so a routine carries a `kind`
exactly as a sleep entry does, and the day holds one per nap alongside the night's.

**Not two fields on the entry.** The entry does not exist yet: it is created by the "night sleep" tap
forty minutes later, so a "routine started" button would have nowhere to write. And the two halves are
two separate acts twenty minutes apart, on a shared log often by two people on two phones — the case
`climate.ts` sets out, where a whole-record last-write-wins merge silently drops one half. So it is
climate's design again: one document per routine, reconciled by `versioned.ts`, its own localStorage
keys, its own push queue, its own collection (`users/{uid}/babySleepRoutines`), its own hook.

- `routine.ts` (the record, `routineKey`, `parseRoutineId`, `validateRoutine`, `normalizeRoutine`),
  `routineStats.ts` (the merge, the join, the point extractors), `routineStorage.ts`,
  `routineCloud.ts`, `src/hooks/useNightRoutine.ts`
- `RoutineLive.tsx` — the strip above `LiveControls`, which never learns about routines. Two slots,
  one per kind, each showing its live routine or the button that starts one. It ticks only while
  something is counting up, and each slot is gone by its own clock.
- `RoutineForm.tsx` — reachable from the routine rows on any day in the history. Its own form and not
  a fieldset in `EntryForm`, because a broken night is several entries and one routine: folded in, it
  would ask the same question once per block, and `EntryForm`'s validated `onSubmit` contract would
  have to carry a second draft it has no use for.

#### The id says which occasion

```
night   2026-08-18            the sleep-day key
nap     2026-08-18-nap-1230   the same key, plus the hh:mm the routine started
```

The night's grammar is the bare key it always was, and that is a migration and not a preference:
`2026-08-18` is what every stored record and every Firestore document already names, so it keeps its
meaning and nap routines arrive as the new material they are — `:b`, `:de` and `:o201` again.

The day part is **`sleepDayKey(t, kind)`** and deliberately *not* `currentNightKey`: a routine is
logged at the start of the sleep exactly as an entry's `start` is, so it must go through the same
`NIGHT_CUTOFF_HOUR` rule, or a night routine begun at 00:10 files itself a day after the sleep that
follows it. A nap does not go through it, which is that rule's own documented asymmetry. Two things
fall out of keying on the occasion rather than on the entry — `split.ts` needed nothing at all, since
cutting a night in two leaves the routine alone, and correcting an entry's times cannot orphan one.

The nap's suffix is a **time and not an ordinal**, and that is the whole of why it is safe. Derived
rather than a `uuid()`, so two phones tapping in the same minute converge on one document instead of
racing to create two; derived from the clock rather than from a count, so a phone that has been
offline since yesterday cannot mint `-nap1` for the afternoon and silently overwrite the morning's.
A minute apart makes two records, which is visible in the history and clearable. Duplicate rather
than lose. The id is minted once, from the draft's own `start`, in `logRoutine` — the one path the
live tap and the form both take — and `setRoutine` carries `prev.id` through an edit, so correcting a
start time does not move a document.

`kind` and `night` are **derived from the id, never believed from the field**, which is the rule
`normalizeRoutine` already followed for `night` rather than a second one beside it. The stored field
is still called `night` for both kinds, and renaming it is not the tidy-up it looks like:
`pullRoutines` reads with `orderBy('night', 'desc')`, and a Firestore `orderBy` on a field a document
lacks **excludes that document from the result** — so the rename would make every routine written
before it invisible to the pull.

#### What ends the settling

`asleepFor` is the one rule, replacing the three copies of "the first block of the night" that had
grown up in `routineStats.ts`, `EntryList.tsx` and `BabySleep.tsx`:

- **night** — the earliest night entry filed under the routine's own night key. The *first* block,
  because a waking at three in the morning starts a second entry the routine had nothing to do with.
- **nap** — the earliest nap starting at or after the crib, within `MAX_SETTLE_MS`. A nap routine has
  no key to join on — there are several a day and the nap does not exist when the routine begins — so
  it joins to the next nap in *time*. That also makes the midnight edge free: the search is over the
  entries, not over one day's bucket.

`asleepByRoutine` folds it over the day buckets and keys the result by **routine id**, so the band
drawn on the chart, the figure in the history row and the live strip's countdown cannot come to
disagree. The row join stays what it was — by time, via `clipSegment` — because a routine begun at
00:10 is keyed to the night before and drawing it on that row would put a bar a whole day left of
the moment it happened.

#### The figures stay night-only

A nap routine is logged, synced and drawn, and reaches no tile and no chart. "Has bedtime been
drifting later" is a question about bedtime, and pooling a ten-minute nap settling with a forty-minute
evening one would answer neither. The three extractors read `nightRoutinesByDay`, so a nap routine
cannot reach a tile even by accident — it is not in the map — and `routineStats.test.ts` asserts the
guarantee directly: the same day with and without its nap routines computes identical stats.

Two rules in `routineStats.ts` differ from `stats.ts`'s. **Today is included** — these follow the
clock-point rule, not the duration rule, because a settling time is complete the moment he falls
asleep, so tonight's shows immediately. And **the night's first block is read directly, never through
`nightBlocks`**, which returns null while any block is running: only the first block's start is needed
and it is known the instant the night begins, so going through `nightBlocks` would hide tonight's
figure until morning. Nothing is clamped — a routine logged as ending after he was already asleep is a
mis-log and is excluded, not pinned to zero.

#### On the screens

The live strip's two buttons are `Night routine` and `Nap routine`, mirroring the `night sleep` / `nap`
pair below. The kind is explicit at the tap rather than inferred from the clock, because a
late-afternoon nap and an early bedtime are the same hour and the id is fixed by that first write.
Two idle slots put their buttons side by side; a slot with a line takes the whole row, and the flex
basis on the slot is what says which.

A finished **nap** line keeps its button beneath it (`canRestart`), because the day holds one routine
per nap and the afternoon's has to be startable while the morning's reading is still on the screen.
A finished night line does not: a night's id *is* its night key, so a second tap would overwrite the
evening just recorded rather than begin anything.

The history draws one row per routine under each day heading — the night's, then the naps in order,
then a row carrying only `Add nap routine`. Each row's settling comes from `settleMs(routine,
asleepFor(...))` rather than a subtraction of its own, which is how it stopped being the one place
that forgot `MAX_SETTLE_MS`.

`SleepTimeline` draws them all on the row the *clock* puts them on: two slim bars half the row's
height meeting at the crib, which is a pale full-height tick. Bath to crib is solid orchid; crib to
asleep is the same orchid dimmed, and it ends where the sleep beside it begins — so the settling time
is drawn rather than left as a gap. That is the point of drawing it at all: an empty stretch of row is
also what an evening with no routine logged looks like, and it says nothing about whether anyone was
sitting in the dark for it. Half height because a routine is not a sleep and a bar of equal weight
beside the night reads as one; drawn before the sleeps, so where a mis-log overlaps one the sleep is
what you see. Orchid because the other three colours on that chart are spoken for — blue is the night,
teal a nap, yellow a sleep still running — which is the same argument that keeps the *log* screen's
routine buttons plain grey, reaching the opposite conclusion because a chart has room for a fourth
series and a row of coloured buttons does not. **Nap routines take the same orchid and get no legend
entry**: each bar sits directly beside the teal nap it leads into, which is what says which it is.

The dimming is 0.7 and not `.bs-bar--partial`'s 0.45. These bars are a few pixels wide on a
near-black row, where 0.45 is a smudge you have to know is there, while a whole bar of a day's
totals at the same value is unmissable; the pair is only ever read against each other, and 0.7 is
far enough from the solid bar beside it to say which is which.

`routineSegmentsForDay` draws nothing no figure counts, which is `segmentsForDay`'s rule for
implausible entries and holds for its reason: a tombstone, a stale timer, an impossible routine
length, and — for the settling specifically — `settleMs`'s own rejections, a crib logged after he was
already asleep or a gap past four hours. Two things still running are drawn as far as `now`: a routine
with no crib yet, which has **no tick** (the missing mark is what says nobody is in the crib), and the
settling on a sleep nobody has tapped yet, which is what the live strip is counting up.
`MAX_SETTLE_MS` is what stops that second one smearing a band across the chart.

`DurationSpreadChart` grew optional `minSpan`/`tickSteps` for this. Its three-hour floor is right for
a night and flattens a settling time into a straight line along the bottom; the settle chart passes
30 minutes and 5/10/15/30-minute ticks. The defaults are still the night's.

`storage.ts`'s `CACHED_PER_OWNER` gains both routine keys — miss that and the previous household's
routines stay cached and get pushed into the new account on the first write. `firestore.rules` needed
nothing for naps: its `users/{uid}/babySleepRoutines/{recordId}` block already wildcards the document
id, so no manual deploy is involved in this half. The log tab and the stats tab each mount two hooks,
so they show one badge over two syncs via `mergeSync` from `src/utils/flashcards/sync.ts` — pure, and
it knows nothing about flashcards. The one rule that matters there: a half that failed is never
reported as synced.

The routine buttons are the plain raised grey, not a colour. Navy is the night, teal is a nap and
yellow is waking, so every colour on that screen is already spoken for and a coloured routine button
would read as one of the three things it is not.

### The config tab, and the one intention in the log

`/apps/baby-sleep/config/` holds what bedtime is **aiming at**, as opposed to what it did: the clock
time he should be in the crib by, which is the moment the routine ends. Everything else in this app
is an observation; this is the only target, and nothing is graded against it — no average moves, no
tile counts hits and misses. It is drawn, and reading the dots against it is the whole feature.

Its own tab rather than a control on the stats page, because that page answers what happened and a
knob that moves the goalposts sitting among the measurements invites moving it until they look
better.

**It is synced, and that is the reason it is a record at all.** `BabySleepSettings` in `storage.ts` —
which window the stats page was last showing — is genuinely this browser's and stays there. A target
is the household's: it has to survive a reinstall and reach the other parent's phone, or the two
charts disagree about the goal in silence. So it is `climate.ts`'s shape again — a `Versioned` record
reconciled by `versioned.ts`, its own localStorage keys, its own push queue, its own collection —
with one difference: it is a **singleton**, `users/{uid}/babySleepTargets/targets`, one document with
a fixed id. There is no occasion to key on, so the union by id is a single `pickVersioned` call and
`mergeTargets` is that call.

- `targets.ts` (the record, `setCribTarget`, `mergeTargets`, `normalizeTargets`), `targetsStorage.ts`,
  `targetsCloud.ts`, `src/hooks/useSleepTargets.ts`, `BabySleepConfig.tsx`

**Clearing a target is a null field, never a tombstone.** The id is fixed, so setting one again after
clearing necessarily reuses the id of what was deleted — which is precisely the case `versioned.ts`
documents as having once made a night unloggable for good. Its causal rule handles that now; the
simpler answer is available here and is taken, there being nothing to delete and only a field to
empty.

`cribMinutes` is minutes after local midnight, because a target is a time of day and not a moment: it
is the same 19:15 every evening. It is **night-only**, for the reason the routine tiles are — a nap is
led into at whatever hour the morning worked out to, and a clock target for one is a number nobody
could hit or miss. `normalizeTargets` takes an unreadable `cribMinutes` as *no target* rather than
rejecting the record, so a future build writing a shape this one cannot read still leaves this one a
revision to move forward from.

The field is committed by a button and not on change: a `<input type="time">` fires on every
keystroke and every spin of a native picker, and each of those would be a document the other parent's
phone pulls.

`firestore.rules` needs its own `users/{uid}/babySleepTargets/{recordId}` block and, as ever, that is
`firebase deploy --only firestore:rules` by hand — so the *shared* half does nothing until it is run,
while the owner's own access comes from the `users/{uid}/{document=**}` catch-all and works
immediately. `CACHED_PER_OWNER` gains both keys, or the previous household's target stays cached and
is pushed into the next account on its first write.

#### Where the target shows up

Two charts, because they answer different questions about the same line:

- **The timeline** takes it as a vertical line down every row (`targetMinutes`), which is what this
  chart can say and the spread chart cannot: not how far the mean was off, but *which nights* were
  the late ones. Placed off the plain 24-hour fraction, the same approximation the hour ticks use, so
  the two stay in column on the twice-yearly 23- and 25-hour rows.
- **A new in-crib chart** — `cribPoints` in `routineStats.ts`, the clock time each night's routine
  *ended*, with `cribTime` as its tile. This is the population the target is set against, and it did
  not exist before: the deck of clock charts measured falling asleep, waking and the first nap, and
  the crib is the moment you can act on where falling asleep is the one that happens to you.

`SpreadChart` grew an optional `target` and draws it **solid where the mean is dashed**, in green —
the one colour these charts had left, navy being the night, teal a nap, orchid the routine, yellow
the mean and cyan the dots. The two lines can sit on top of each other for weeks, so what it *was*
must never be mistaken for what it is *meant to be*. The target widens the axis like any other
value: a target the dots are nowhere near is exactly the case worth seeing, and a line that quietly
falls off the top reads as no target at all. On the clock axis it goes through `unwrapAround` against
the same centre the dots do, or a 19:15 target drawn on raw minutes beneath a run of near-midnight
bedtimes sits a whole axis away from the points it is the goal for.

With no target set the in-crib chart carries a line of prose saying where to set one, since an
absent line and a feature nobody has heard of look identical.

### The spread charts

Five of them: four clock times and the night's length. `SpreadChart.tsx` is the drawing — dots, mean
line, ±1 SD band, ticks, legend — and the line it is split on is that **it does not know what it is
plotting**. It takes numbers in the axis's own units and a function that prints one, so
`ClockSpreadChart` (minutes, circular) and `DurationSpreadChart` (milliseconds, linear) stay one
chart in two places rather than two that drift.

`y` and `value` are separate on a point for the clock's sake. A bedtime is unwrapped against the
circular mean before it is plotted — 23:50 and 00:05 are fifteen minutes apart, not twenty-three
hours — so it may sit at -10 or 1450 minutes on the axis, and a tooltip printing that number would
name a time nobody experienced. The plotted number and the printed one are different facts.

The duration axis does not start at zero: `DailySleepBars` above it already answers "how much sleep"
against a zero baseline, and the question here is how much last night differed from the night before,
which an hour of variation inside a twelve-hour axis cannot show. The three-hour floor stops the zoom
going the other way and turning twenty minutes of ordinary drift into a mountain range. It does carry
a `floor` of 0, though, because a duration axis padded past zero prints two gridlines both labelled
`0m` — reachable from a single ten-minute night.

`nightDurationPoints` is what the chart plots *and* what `nightPerDay` averages, so the tile and the
dots beneath it are one population by construction. It is the one extractor that skips days still in
progress: a bedtime is a complete fact the moment the night starts, a duration only once it is over.

### The climate tab

`/apps/baby-sleep/climate/` answers one question the log could not: **how low can the overnight
temperature go before the window has to be shut.** Two facts a night, learnt at the two moments you
know them — the forecast low and the window before bed, the verdict (`cold` / `ok` / `warm`) in the
morning — and a chart that puts the boundary between them where you can read it off.

**A night is two records, not one.** `{tempC, window}` at 21:00 and `{verdict}` at 07:00 are two
separate acts hours apart, and on a shared log usually two people on two phones. One record per
night makes those halves compete in a whole-record last-write-wins merge, so a phone offline across
the gap silently drops one of them — and the row still looks fine. Two records never compete: the
union-by-id merge keeps both without being told anything, and no new merge rule exists to get wrong.
It is the argument that makes a broken night two sleep entries rather than one entry with a
`wakes: [...]` array, applied again.

The id is `${night}-${part}` (`2026-08-18-eve`, `2026-08-18-am`), derived rather than a `uuid()`, so
two devices logging the same evening converge on one document instead of racing to create two. It
splits at the **last** hyphen — a `yyyy-mm-dd` key carries two of its own, the trap
`parseManifestParam` documents. `normalizeClimate` takes the id as the truth and normalises the rest
away: an evening record cannot hold a verdict and a morning record cannot hold a temperature,
whatever a stray document claims, because that separation is the whole point of the split.

- `src/utils/babySleep/versioned.ts` — the reconciler, **lifted out of `merge.ts`**. It is generic
  because nothing in it knows what a row is: an id, a `rev`, a `writerId` and a tombstone is the
  whole contract. `merge.ts` keeps its exported names as thin wrappers, so the sleep log is
  unchanged and `merge.test.ts` passes untouched. The two rules that make merging without a dialog
  safe — `rev` before the wall clock, an absorbing delete — moved with the code.

  **The delete absorbs only what it is level with or ahead of**, and that qualifier was bought the
  hard way. It was unconditional at first, on the stated grounds that nothing ever undeletes — an
  undo being a new row with a new id. True of the `uuid()`-keyed sleep entries; **false of every row
  keyed on its night**, which is both of the collections above. Re-logging such a night necessarily
  reuses the id of whatever was deleted there, so the tombstone swallowed the new record, kept its
  own values, and moved `rev` forward — no error, `-unsynced` drained, the badge reading Synced. And
  no retry could ever come out differently, the id being a function of the night, so one delete made
  that night unloggable for good. Past the tombstone's own `rev` the writer has demonstrably seen the
  delete, so a live record there wins; at or below it the tombstone still absorbs, which is the
  phantom-nap case the rule was written for. Both halves were needed: fixing only `commit` leaves the
  *other* phone's tombstone absorbing the re-logged night and **pushing it back**.
- `climate.ts` (records, `currentNightKey`, `parseTemp`), `climateStats.ts` (the join and the
  threshold), `climateStorage.ts`, `climateCloud.ts`, `src/hooks/useNightClimate.ts`.

`currentNightKey` is **not** `sleepDayKey`: `NIGHT_CUTOFF_HOUR = 6` files an 07:00 event under
today, which is right for a sleep starting at 07:00 and wrong for a verdict on the night that just
ended. Before noon is yesterday's night, after noon is tonight — noon because nothing about a night
is logged at midday, so no real entry sits near enough to be filed wrongly.

`windowThreshold` is the min and max of the two populations (`okFloor`, `coldCeiling`) rather than a
fitted cutoff, because it is explainable from the dots — *the coldest night that was fine, the
warmest that was not* — and where they overlap that overlap is a fact about the nights, shown rather
than smoothed into a false precision. No cold night at all is *settled*: you simply have not found
the floor yet. `warm` counts as not-cold; the question is only ever about the bottom end.

`ClimateChart` is deliberately **not** a `SpreadChart` wrapper. The other charts plot a value per
day against time; here temperature runs along X, the two window states are two lanes, and the
verdict is the dot's colour — so the boundary between the colours in the top lane *is* the answer.
Dots sharing a lane and a temperature are stacked by their position within that group, not by a hash
of the night key: consecutive dates hash to consecutive numbers, so a hash put every dot at nearly
the same height and two nights at 12° drew as one.

The list's colours are **not** the chart's. The chart draws on near-black where cyan and a light
blue read cleanly; the same values on the dialog grey are barely there, so the rows carry dark
variants. And each verdict button names its colour twice, the second time with `:hover` — the same
`button:hover { background: #a0a0a0 }` at (0,1,1) in `Layout.astro` that `.fb-neck-cell--right`
guards against, which otherwise greys out the one button the pointer is resting on.

`adoptOwner` clears **every** per-owner cache, the climate keys included, and its answer is now
memoised for the page load: two hooks call it and only the first can observe the switch, so without
the memo the second keeps the previous household's rows in memory and pushes them into the new
account on its first write.

`firestore.rules` needs its own `users/{uid}/babySleepClimate/{recordId}` block — rules are a
permissive union, so the `babySleep` block says nothing at all about this path. As ever it is
deployed by hand (`firebase deploy --only firestore:rules`), so the *shared* half of this feature
does nothing until that is run; the owner's own access comes from the `users/{uid}/{document=**}`
catch-all and works immediately.

No PWA work was needed: `APP_TIERS['baby-sleep']` already claims the whole subtree in both
`generate-sw.mjs` and `register-sw.js`, so the tab precached itself.

### Sharing

The log can be read and written by a second account, so both parents log against one history. The
data does not move for this: it stays at `users/{ownerUid}/babySleep`, and access is widened.

One top-level document per invitee, **keyed by the lowercased email**:
`shares/{email} → { email, ownerUid, ownerEmail, createdAt }`. The id is the address rather than a
generated key because a security rule has to resolve it from the caller's token alone — `exists()`
and `get()` are things a rule can do, and a `where('email','==',…)` query is not. That makes
`normalizeShareEmail` (`shareKeys.ts`, tested) load-bearing rather than cosmetic: it lowercases on
the way in, and if it ever stopped agreeing with the rule's `request.auth.token.email.lower()`, the
owner would write grants the rule could never find and sharing would fail silently.

One document does three jobs: it is the grant the rules read, the pointer telling the invitee's
browser whose log to open, and the row the owner revokes. Unlike a sleep entry it is **really
deleted** on revoke — the rule asks whether it exists, so a tombstone would leave access granted.

`useDataOwner` resolves it, and **a failed lookup must never fall back to the user's own uid**.
"I could not tell" and "you have no share" are indistinguishable from the fallback's side, and
guessing wrong makes the invitee's device decide it owns a private log and push the household's
entries into her own subtree. So a failure leaves `resolved` false, sync stays off, the log keeps
working locally, and the share tab offers a retry.

`baby-sleep-owner` records which data owner the localStorage cache belongs to. Without it, signing
out and in as the other person on one browser leaves the previous log's rows cached, and the first
sync — seeing entries the cloud lacks — pushes them into the wrong account. An absent value adopts
the current owner, so an install predating this migrates instead of losing its history.

`authorEmail` is set on creation and never on edit: it answers who *recorded* the sleep, which a
later correction does not change. `writerId` cannot stand in for it — that is a browser profile, so
one person on a phone and a laptop is two writers. It renders only on entries somebody **else**
logged; labelling every row on a two-person log is noise.

### The rules deliberately do not check `email_verified`

Nothing in this flow verifies an address — the owner creates the invitee's account by hand in the
Firebase console, and the site sends no email. Requiring verification would lock out the very
account the share is for. That is safe **only because sign-up is disabled at the Identity Platform
level**, which is what stops anyone claiming an address they do not own. If sign-up is ever enabled,
`firestore.rules` must require `request.auth.token.email_verified` before anything else, or a
stranger can register an invited address and walk in.

Note there has never been an email whitelist in this repo, despite how the restriction is often
described: the single occurrence of the owner's address is a comment in `NavAuth.tsx` about
truncating a long name. Sign-up being off is a console setting, not a file.

`firestore.rules` is not deployed by CI — `firebase deploy --only firestore:rules` is manual, and
the sharing rules do nothing until it is run.

## The section is `/apps/`, and was `/games/`

Everything under it used to live at `/games/`. Most of it is not a game — the typing trainer, the
guitar flashcards, the tuner, the baby sleep log, the pregnancy calendar, the anesthesia quiz — and
the heading was picking the wrong word for six of nine things. The three that really are games
(solitaire, minesweeper, pipes) lose nothing by sitting under one that does not claim to describe
them.

The move is the paths and the label, nothing else. Local storage keys, Firestore collections and
every card id are untouched, because none of them ever carried the section name; so nobody's
progress, schedule or sleep log noticed. Inside the games the word stays the word — `gameState`,
`New Game`, `solitaire.newGame` are about a game and are still right.

`public/_redirects` 301s `/games/*` to `/apps/:splat` in both locales. The four old
fretboard/transpose rules are listed **before** that catch-all, because first match wins and
`/games/fretboard` has to reach the flashcards rather than an `/apps/fretboard` that does not
exist; each of those four is also written a second time under `/apps/`, for the bookmark that
comes back through the catch-all.

The cost is the one the flashcards merge already paid, and it is worth knowing before renaming a
route again: **an installed app's `start_url` now 301s out of its own scope**, so iOS opens the
tuner, the flashcards and the sleep log in Safari rather than in the app. There is no way to hand
an existing install a new identity — deleting the icon and installing once from the new URL is the
whole fix. The songbook and the site app are unaffected, their paths not having moved.

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

### End every push with the hash and the time

After pushing, the **last line of the reply** is the short commit hash and the push time. Nothing
after it. That line is what I read: I am watching the navbar's status bar for the deploy to land,
and it prints exactly `git rev-parse --short HEAD` next to a timestamp, so the reply has to give me
the two strings I am about to compare against. Burying them in a paragraph, or writing "pushed to
main" without them, means opening a terminal to find out what I am waiting for.

Format, one line, at the very end:

```
`4a1ccf8` · pushed 06:54 UTC / 08:54 Warsaw · 11 Aug 2026
```

- **Short hash**, from `git rev-parse --short HEAD` — the same command `Navbar.astro` runs at build
  time, so it is character-for-character what the status bar links to.
- **Both clocks.** The navbar renders its timestamp with `toLocaleString` in the *viewer's* zone,
  which for me is Europe/Warsaw (`+0200` in summer, `+0100` in winter) while this container runs in
  UTC. Giving only one of them leaves me doing the arithmetic on a phone.
- Several pushes in one reply: one line each, in order, oldest first.

One thing that line does **not** promise: **the navbar timestamp is the build time, not the commit
time.** It is `new Date()` evaluated while Netlify builds, so it lands a minute or two after the
push and will never match to the minute. The *hash* is the thing that matches exactly — compare on
that.

### Don't make me poll for the deploy — read it off the site

Netlify builds and deploys every push to `main` (`korczak-xyz/netlify.toml`; the GitHub Actions
workflow is a build check and deploys nothing). So the push is not the end of the job, and the
answer to "has it landed yet" is a request away rather than something to hand back to me:

```
curl -sS https://korczak.xyz/ | grep -o 'commit/[0-9a-f]\{7,\}' | head -1
```

That is the deployed commit, straight from the status bar's own markup — the same string the navbar
links to, so it settles the question exactly. `data-timestamp="..."` on the same page carries the
build time. The HTML is served `max-age=0, must-revalidate` and Cloudflare marks it `DYNAMIC`, so a
poll always sees the current deploy and never a cached one. Poll every 15–30s; a deploy here takes
a couple of minutes.

**Wait for it before signing off**, unless I have said not to. Report the hash as *live* only once
the site has actually served it, and say plainly if it has not landed yet rather than implying it
has. If it has not flipped after ~10 minutes, say so and stop polling — that is a failed build, and
I would rather hear it than watch a phone.

**But first check the commit can deploy at all.** The Netlify site's base directory is
`korczak-xyz/`, and Netlify's monorepo default skips any build whose commit changed nothing under
it — roughly `git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- korczak-xyz`. A commit touching
only root-level files (this file, `.claude/`, `README.md`, `resume/`) therefore **never deploys**,
the status bar keeps the hash of the last commit that did, and polling for it would spin until it
gave up. That is correct behaviour, not a failure — nothing user-facing changed. So:

```
git diff-tree --no-commit-id --name-only -r HEAD | grep -q '^korczak-xyz/'
```

No match: say the commit is docs-only and does not deploy, name the hash the site is still serving,
and don't poll. Match: poll, and report it live.
