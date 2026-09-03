---
name: baby-sleep
description: The baby sleep log at /apps/baby-sleep/ - entries and routines as CRDT-ish unions by id, the stats and spread charts, the climate tab, the printable checklist, targets, and sharing with a second account.
paths:
  - "**/utils/babySleep/**"
  - "**/components/BabySleep/**"
  - "**/hooks/useBabySleepData.ts"
  - "**/hooks/useNightClimate.ts"
  - "**/hooks/useNightRoutine.ts"
  - "**/hooks/useSleepTargets.ts"
  - "**/hooks/useDataOwner.ts"
  - "**/styles/babySleep.css"
  - "**/styles/night-routine.css"
  - "**/pages/**/apps/baby-sleep.astro"
  - "**/pages/**/apps/baby-sleep/**"
  - "firestore.rules"
---

## Baby Sleep Log

At `/apps/baby-sleep/` — nights and naps as one entry each, with a stats tab, a config tab, a
share tab and a printable checklist.
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

**A day is listed when it holds a sleep *or* a routine.** `EntryList` grouped by the entries alone, so
a day with a routine and no sleep had no heading — and therefore no routine rows, no `Edit`, no way in
at all. The record was stored and synced and simply unreachable; logging a nap first was the only way
to get at it. `groupHistory` in `days.ts` takes the entries and the extra day keys and unions them —
day keys rather than routines, so that module still needs no `RoutineRecord` import. The entry `<ul>`
is drawn only when there are entries, and `.bs-day-routines:last-child` drops the rule that would
otherwise close the block off from nothing.

The routines are windowed with the entries, not with the whole log: `recentRoutines` in `BabySleep`
applies `HISTORY_DAYS` to the map before passing it down, or a routine-only day from months ago would
appear under a heading that says *Recent sleeps*. A routine still **running** is kept however old, the
same exemption an open entry has above it — that is the forgotten timer, and hiding it is how it stays
forgotten.

#### Adding one that has already finished

The form slot's resting state used to be `EntryForm` alone, so a routine that had already ended had
nowhere to go: the live buttons stamp `Date.now()`, and the history row is the long way round. Its
first field is now `AddChoice`, one row of four — `Night sleep`, `Nap`, `Night routine`, `Nap routine`
— mirroring the live strip's four one-to-one, so what can be logged after the fact is exactly what can
be tapped as it happens. The labels are the live strip's own strings, so the row needed nothing
translated.

It is a **`ReactNode` handed to whichever form is mounted**, not a field either form owns. The two
forms stay separate for the reason `RoutineForm`'s header sets out — `EntryForm`'s validated
`onSubmit` carries an `EntryDraft` and has no use for a routine's — so the row is the typing trainer's
`syncStatus` slot again: the form never learns what it switches between. Where the row is present it
*is* the type picker, and `EntryForm` draws no kind row of its own; two controls setting one field is
two answers to the same question. Editing an entry has no row and keeps the plain `Night`/`Nap`
toggle, because there the kind is the entry's own.

Picking a kind must not throw away times already typed, so the header moves `fields.kind` alone rather
than re-seeding the form. `RoutineForm` is the exception and re-seeds on purpose: its defaults are a
19:00 or 13:00 anchor, which genuinely differ by kind.

**A night adopts tonight's record; a nap never does.** A night routine's id *is* its day key, so
picking `Night routine` when one is already logged has to load and correct it — otherwise Save writes
the form's defaults over the evening just recorded. A nap is always a new record, a day holding one
per nap. That is `canRestart`'s split on the live strip, reached a second time by the same argument.
Saving returns the slot to the sleep form, since a second Save would file a second record a minute
along.

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
id, so no rules change is involved in this half. The log tab and the stats tab each mount two hooks,
so they show one badge over two syncs via `mergeSync` from `src/utils/flashcards/sync.ts` — pure, and
it knows nothing about flashcards. The one rule that matters there: a half that failed is never
reported as synced.

The routine buttons are the plain raised grey, not a colour. Navy is the night, teal is a nap and
yellow is waking, so every colour on that screen is already spoken for and a coloured routine button
would read as one of the three things it is not.

### The checklist tab

`/apps/baby-sleep/checklist/` is the bedtime routine as a **sheet to print and hang up**: ten steps
in the order of the evening, one A4 portrait page, a Print button and nothing else. It holds no
state and reads none — no hook, no island, no Firestore — which is the point of it being here
rather than a feature of the log: the routine is the same every night, so what varies is worth
recording and what does not is worth putting on a wall where a five-year-old can see it.

A tab of the sleep log rather than an app of its own, which it briefly was. It is read at the same
hour by the same person who is about to tap *Night routine* on the log, and an app entry of its own
made the apps index list two things for one bedtime. `public/_redirects` keeps `/apps/night-routine`
pointing here in both locales.

Its strings are in `translations.ts` with the rest of the app's, and nothing of it is in the
site-wide table any more — the apps index no longer has a row to label. Nothing was needed for the
PWA: `APP_TIERS['baby-sleep']` claims the whole subtree, so the tab precached itself, and the page
sets `pwa="baby-sleep"` like every other tab.

`src/styles/night-routine.css` is its own stylesheet rather than part of `babySleep.css`, because
almost all of it is `@media print` and none of the other tabs want it. Three things in there are
load-bearing:

- **One base unit, everything else in `em`.** The unit is `4.4mm` in print and `2.095cqi` on
  screen, which are the same length once the sheet is 210mm wide — so the preview lays out exactly
  as the page prints, and a label that wraps on paper wraps on screen. `cqi` and not `vw`: the
  sheet is scaled off its own width, so the preview stays faithful inside a window that is
  narrower than the viewport. A `vw` clamp stays behind `@supports` for browsers without
  container queries.
- **Printing hides the chrome with `display: none`, not `visibility: hidden`.** A hidden box still
  takes up its space, and a document taller than one page prints a second, blank one. That is also
  why the sheet is `296mm` and not `297mm`: exactly A4 rounds up on some printers.
- **Those rules reach the layout's own wrappers** (`.container`, `.baby-sleep-window`), which is
  only safe because this stylesheet is imported by the two checklist pages and nothing else.

The tick boxes are Win95 raised buttons and nothing ticks them: it is paper. That is the one place
in this app where a thing that looks tappable is not, and it is deliberate — the sheet is for the
wall, and the log is what records that the night happened.

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

`firestore.rules` needs its own `users/{uid}/babySleepTargets/{recordId}` block, rules being a
permissive union: the blocks above say nothing at all about this path, so without it the *shared*
half is dead. The owner's own access comes from the `users/{uid}/{document=**}` catch-all and works
whatever this collection's rules say — which is exactly what makes a forgotten block invisible to
the person most likely to notice. It goes out with the push, `.github/workflows/firebase-deploy.yml`
being path-filtered on `firestore.rules`; there is nothing to run by hand.
`CACHED_PER_OWNER` gains both keys, or the previous household's target stays cached and is pushed
into the next account on its first write.

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

Eight of them: four clock times and four durations. `SpreadChart.tsx` is the drawing — dots, mean
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

#### The trailing average on the night's length

The mean is one flat line across the whole window, so it answers *how much does this vary* and
cannot answer *is it getting better*: a fortnight of slow improvement and a fortnight of noise draw
the same picture under it. `movingAverage.ts` is the second line — a trailing mean of the last seven
nights, `average` on `SpreadChart`, in axis units like everything else it takes, so that file still
does not know what it is plotting.

Three rules, and each is the kind a later change reverses quietly:

- **The window counts logged nights, not calendar days.** A night nobody logged is not a night of
  zero sleep, and a window in days would have to invent one or silently shorten itself. Counting
  points also makes DST irrelevant, which a millisecond window would not be — these day buckets are
  local midnights, and two a year are not 24 hours apart.
- **Full windows only.** Under seven points it draws nothing, and the line starts at the seventh
  night. Every point on it is then a mean of seven, which is what the legend beside it claims; a line
  averaging one night at its left end and seven at its right is noisier on the left than it looks and
  says so nowhere. On the 3d and 7d windows it is simply absent.
- **A point sits at the *last* night of its window.** Centring it would draw the line three days left
  of the data it summarises and leave the three most recent nights — the ones being looked at — with
  no line over them.

Magenta, and a dash-dot. Every other colour on that panel is spoken for (navy the night, teal a nap,
orchid the routine, yellow the mean, green the target, cyan the dots), and in grayscale magenta
clears all three it shares the panel with — 2.50 against cyan, 2.92 against yellow, 2.29 against
green, on a floor of 1.5. But the **dash** is what carries it: this chart tells its lines apart by
mark rather than by hue, the target's green against the dots' cyan being 1.09 and always having been.
So the third pattern has to be a third pattern, and `chartContrast.test.ts` holds the three apart —
it does *not* put them in its grayscale table, which that green/cyan pair would rightly fail.

#### The activity windows

Two more duration charts, and they are about the *day* rather than the night: how long he was awake
from the morning wake-up to the first nap, and from that nap to the next sleep. Each carries the
mean, the ±1 SD band and the same trailing average — `AVERAGE_WINDOW` is one constant for all three
charts that draw that line, because a legend saying "7-day average" beside a line smoothed over five
is a disagreement nothing on the screen would show.

**Two charts and not one.** The first window is set by the morning and is what decides whether the
nap lands mid-morning or at noon; the second is set by how that nap went, a forty-minute one and a
two-hour one not buying the same afternoon. A single series pooling every gap between sleeps averages
the two into a number that answers neither, which is `firstNapPoints`' argument against a mean over
all nap starts, one rung down.

**A window is numbered by its place in the day, not by what happens to bound it.** The second one was
the first nap to the *second* nap when it was written, and on the shape this log actually has — wake,
one nap, bed — that is not a window at all: the chart shipped empty, with nothing on it to say why.
It runs to whatever sleep comes next, which is the second nap where there is one and bedtime where
there is not, and `secondWakeWindowPoints` needs no branch to say so — it takes the first entry in
the day's bucket beginning after the nap ends. The night it lands on is the day's own, filed under
the evening that closes the day; the night that ended *this* morning belongs to the day before and
cannot be picked up by mistake, since it begins before the nap rather than after it.

Four rules in `stats.ts`, each the kind a later change reverses quietly:

- **The morning wake-up is read off when nights *end*, never off the day's own night.** A night is
  filed under the evening it began — the night of the 18th ends on the morning of the 19th — so the
  window that follows it belongs to the *next* bucket. Reaching back through `days[i - 1]` would also
  cost the first day of every window its point, that night having started before the window opened;
  `morningWakeAt` scans the ends instead, which needs no predecessor bucket and picks the last block
  of a broken night without being told about wakings.
- **Today counts.** These follow the clock-point rule, not the duration one: a window is a complete
  fact the moment the next sleep begins, however much of the day is still to come. That is
  `routineStats.ts`'s rule for a settling time, reached again.
- **`MAX_WAKE_MS` (10h) excludes rather than counts.** A gap longer than that has a sleep missing from
  the middle of it, and it would land in the mean as a morning the baby was up for eleven hours with
  nothing on the chart to say the afternoon nap was the first one written down. `MAX_SETTLE_MS`'s
  rule for the other join this app makes between two records — a fabricated window is worse than a
  gap. The slack is deliberate and was bought once already: at eight hours the cap silently dropped
  the genuine afternoons of a one-nap day, an early nap and a late bedtime being that far apart, and
  a real evening quietly missing is the same loss the other way round. A window with a whole sleep
  missing from it is hours past ten either way.
- **The first window needs only a nap's *start*, the second needs that nap closed.** So a day whose
  nap is still running contributes to the first chart and not to the second, and the two tiles print
  different denominators. That is the same fact the tiles have always stated.

`firstWakeWindowPoints` therefore takes the raw entries as well as the buckets and
`secondWakeWindowPoints` takes only the buckets — both ends of the second window are filed under the
day it happened on. Each is honest about what it needs rather than sharing one signature.
`WAKE_MIN_SPAN` is an hour: the night's three-hour floor draws a fortnight of real drift as a flat
line, and the settling chart's half-hour floor turns the same drift into a mountain range.

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
permissive union, so the `babySleep` block says nothing at all about this path. It deploys from CI
on the push that changes it, so the *shared* half is live as soon as the commit is; the owner's own
access comes from the `users/{uid}/{document=**}` catch-all and would work even with the block
missing, which is what makes a forgotten one hard to notice.

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

`firestore.rules` deploys from CI (`.github/workflows/firebase-deploy.yml`, path-filtered on the
file itself), so the sharing rules go out with the commit that changes them. It was manual when
sharing was built and three sections of this file went on saying so afterwards, which is how a
target block came to be pushed with a note telling the next reader to deploy it by hand.
