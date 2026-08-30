---
name: flashcards
description: The guitar flashcards at /apps/flashcards/ - two decks (neck notes, chord transposition) over one shared SM-2 scheduler, one mixed sitting, and two separate stats pages.
paths:
  - "**/utils/flashcards/**"
  - "**/utils/fretboard/**"
  - "**/utils/transpose/**"
  - "**/utils/srs/**"
  - "**/components/Flashcards/**"
  - "**/components/Fretboard/**"
  - "**/components/Transpose/**"
  - "**/components/srs/**"
  - "**/hooks/useFlashcardsData.ts"
  - "**/hooks/useFretboardData.ts"
  - "**/hooks/useTransposeData.ts"
  - "**/styles/flashcards.css"
  - "**/styles/fretboard.css"
  - "**/styles/transpose.css"
  - "**/styles/srsCharts.css"
  - "**/styles/verdict.css"
  - "**/pages/**/apps/flashcards.astro"
  - "**/pages/**/apps/flashcards/**"
---

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
  together.** Selection there is a weighted sample over one pool, so one call means both decks compete
  for every slot on the same terms: a deck that has fallen behind takes a larger share, a deck left
  alone past `BACKLOG_DEADLINE_MS` fills the sitting outright, a deck that is caught up contributes
  nothing. Two queues built to their own lengths and interleaved would guarantee each deck
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

### Time spent is read off the sittings, not the answer log

`src/utils/srs/practice.ts` is the one definition of "time spent practising", the way
`activeTypingMs` is the typing trainer's, and everything that reports it — the `Time` tile on each
progress page, the `Practice time` tile on the start screen, the bars in `PracticeChart` — goes
through it. Four things it settles:

- **It reads `SessionRecord[]`, not `events`.** Everything else on a progress page is recomputed
  from the log, and for the deck and the accuracy that is right. It is wrong for a lifetime total:
  `EVENT_CAP` keeps the newest 2000 answers and `createSrsStorage` surrenders the older half under
  quota pressure, so a total folded from the log **shrinks as the log is pruned** — a year of
  practice quietly becomes three months of it, with nothing on the screen to say so. The sitting
  record is written once, capped at `SESSION_CAP` *sittings* rather than answers, pulled back from
  the account, and already carries `totalMs`.
- **The app-wide total is a plain sum of the two decks'.** A mixed sitting writes two records under
  one session id, each holding only its own half's answering time — so there is nothing to join on
  and nothing counted twice. Every deck is counted, including one currently switched off: turning
  the chord cards off for a fortnight does not unspend the hours already spent on them. The tiles
  beside it are the opposite question — what to do now — and are scoped.
- **One answer contributes at most `MAX_ANSWER_MS` (2 min).** A card's clock starts when it appears
  and nothing but answering stops it, so a sitting begun and walked away from banks the whole walk.
  `answerMs` caps it in `FlashcardsSession`, where the event is minted, so one number reaches the
  deck, the stored sitting, the day's bar and the total rather than four places each capping their
  own. It cannot move a rating: `ratingFromAnswer`'s slowest budget is 5 s a place, 30 s for a
  six-place select-all card, so the cap only ever touches an answer already rated `hard`. Stored
  records keep whatever they were written with; this is from here on.
- **The empty buckets are drawn.** `practiceBuckets` fills the days or weeks nobody practised,
  because "am I practising" is half of what this chart is asked and a series that skips them draws
  a fortnight off as an unbroken run of bars. It steps by *calendar* day (`new Date(y, m, d + 1)`),
  not by 86,400,000 ms — two days a year are not 24 hours long, and a fixed step files everything
  after a DST boundary one bucket out. `MAX_BUCKETS` keeps the newest 400, so one stale record from
  three years ago is not a thousand empty bars.

`PracticeChart` is bars and not a line, because this is a quantity per bucket rather than a rate
sampled at a point: a line between Tuesday and Friday draws a slope across two days nobody
practised. It is the one chart here that owes no second channel — the site's rule is about telling
two *series* apart and there is one, read against its axis — and it is magenta because that is what
time already is on the typing trainer's over-time chart. Its day/week toggle is its own, both
progress pages drawing the panel identically; its strings are in `Flashcards/translations.ts`,
since a sitting belongs to neither deck.

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

### What to ask is sampled with a deadline; what order to ask it in is shuffled

`buildQueue` keeps those two apart. **Order** is a shuffle, because once the cards are drawn their
sequence carries no information, and a fixed one is something you learn instead of the neck: every
sitting used to walk E, A, D, G, B, e in turn, which you can answer without reading the card. New
cards are drawn from the whole fret range for the same reason — the range setting is the
curriculum, so `scopeIds` is a stable enumeration and nothing more, not an introduction order.

**Selection** was the top `sessionLength` by due date, on the grounds that a capped sitting must
draw the cards that have waited longest and a random handful abandons the schedule. The first half
of that is still true and the second half was the wrong conclusion, because taking the oldest makes
a sitting predictable in *content*: sixty cards due and a sitting of ten is the same ten every time,
and the shuffle only reorders them. So the draw is two tiers, and the point is that only one of them
is a preference:

- **`BACKLOG_DEADLINE_MS` (4 days) is a guarantee.** Anything overdue by more than it is taken
  outright, oldest first. This is the whole of what keeps the schedule honest, and no weighting can
  stand in for it: a soft bias moves the average and leaves the tail, and drawn uniformly about one
  card in twelve waits over a fortnight. A week was judged too long to discover a card had been
  quietly skipped over, hence four days.
- **Everything else is a weighted sample**, `1 + overdue / BACKLOG_DEADLINE_MS`, so a card just due
  weighs 1 and one at the deadline would weigh 2 — by which point it is not being sampled at all, so
  the two tiers meet without a step. One constant sets both the ramp and the cutoff. The bias is
  meant to be felt and not obeyed; a weight free to grow would quietly turn the sample back into the
  oldest-first slice it replaced.

The sample is Efraimidis–Spirakis — key each card `u^(1/w)`, take the largest `k` — which is exact
for weighted-without-replacement in one pass and draws from the same injected `rng` as the shuffle,
so a seeded sitting is still reproducible end to end.

Two things about the guarantee are worth knowing before touching this. **The two tiers come back
from `sampleDue` separately and the rescued cards are kept at the head of the review list**, because
the `.slice(0, sessionLength)` that ends `buildQueue` eats the *tail* of that list — merge them and
the new-card ration silently drops the very card the deadline rescued. And the deadline is a promise
about **steady state**: while more cards are past it than one sitting holds, the bound is capacity,
not the deadline. A hundred and twenty cards at ten a day take twelve sittings to work through
however they are chosen. `queue.test.ts` simulates exactly that and measures only after the backlog
is off.

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

It **wraps**, with `column-gap` only so the rows abut and the panel line stays under the last one —
which is what a Win95 property sheet does when its tabs outgrow a row, and a no-op for every strip
that already fitted. Without it a strip simply ran off the side of a phone: the sleep log's five
Polish labels want ~470px and Event Watch's four want ~424px against a 320px screen, so the last
tab — the newest one, every time — was the one nobody could reach.

## Two decks, one scheduler

`src/utils/srs/` is what the two decks genuinely share, and the line is drawn at **what does not know
what a card is**. A card id is an opaque string in every file there; each deck owns its own grammar
for it and its own parser, and nothing in that directory ever looks inside one. That is exactly the
property `src/utils/flashcards/mix.ts` exploits to put both decks in one queue.

- `scheduler.ts` — SM-2 with learning steps. Pure, takes `now`, which is what makes the deck a fold.
- `replay.ts` — union by id, refold. The whole argument is in its header.
- `queue.ts` — `buildQueue`, `sampleDue`, `requeue`, `spreadBy`. Selection by weighted sample
  under a deadline, order by shuffle.
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
