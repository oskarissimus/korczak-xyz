---
name: events
description: Event Watch at /apps/events/ - the scraped corpus, the one matcher compiled into both browser and Cloud Function, web push, the classifier that says where an event is and whether it is one, and the Terraform project layer.
paths:
  - "**/utils/events/**"
  - "**/components/Events/**"
  - "**/hooks/useEventFeed.ts"
  - "**/hooks/useEventCorpus.ts"
  - "**/hooks/useEventSourcePrefs.ts"
  - "**/hooks/useWebPush.ts"
  - "**/styles/events.css"
  - "**/utils/jsonView.ts"
  - "**/pages/**/apps/events.astro"
  - "**/pages/**/apps/events/**"
  - "functions/**"
  - "terraform/**"
  - "firestore.rules"
  - "firestore.indexes.json"
  - "firebase.json"
  - "**/sw/push.js"
  - "**/sw/push.test.js"
  - ".github/workflows/firebase-deploy.yml"
---

## Event Watch

At `/apps/events/` — three tabs (Feed, Alerts, Sources) over a shared corpus of scraped listings,
with web push when something is announced, goes on sale, or gets close. The Feed is the output of
the pipeline and carries no controls at all; the Sources tab is where the pipeline is read, per
source, and carries the app's one filter. There were two more tabs, Pipeline and Interests, and
*The Pipeline tab is gone* and *The interests are gone* below are what replaced each and why. The
first app here that watches the outside world rather than recording what I did, which is why it is
**signed-in only**: the collecting happens on a server and the notifications have to know where to
go.

Two halves. `korczak-xyz/src/utils/events/` and `src/components/Events/` are the client;
`functions/` is a scheduled Cloud Function that collects and sends.

### Filters are per source, and opt-in — the owner's standing rule

**Every filter belongs to one source, is switched on for that source by name, and is never
inferred.** Stated by the owner (Sep 2026) while the app is being tuned: the point is to
understand and control exactly what each source does, one at a time, until each is where it
should be. A filter that appears on a source because its data happens to fit — the town picker
turning up on python.org's conference calendar because its rows named two cities — is the
thing this rule forbids, even when it is harmless.

In practice:

- A new filter is a flag on that source's `SOURCE_CATALOGUE` entry (`townPicker`, `countryPicker`,
  `reachPicker`, `unclassified`)
  and is set only on the source it was asked for. Offering it to another source is a separate
  request, not a generalisation to make on the way.
- Its setting lives on that source's switch in `sourcePrefs.ts` and is drawn on that source's
  card, so what reaches the feed and the lock screen is readable one card at a time.
- No cross-source or global filter — nothing like the interests, which applied one rule
  everywhere and were removed for exactly that (see *The interests are gone* below).

### One rule, two runtimes

`src/utils/events/` is compiled **twice** — by Astro for the browser, and by `tsc` into the Cloud
Functions bundle, via `rootDir: ".."` and an `include` of `../korczak-xyz/src/utils/events/*.ts` in
`functions/tsconfig.json`. The feed and the collector both ask "does this event reach the reader?",
and if they ever answer differently the feed shows things you were never told about and pushes
arrive for things the feed does not list.

Since the interests went that question is short — is it past, and is its source switched on — and
the argument for compiling rather than copying is unchanged: `buildFeed` and `noticesFor` read the
same `sourcePrefs.ts`, so a switch cannot mean one thing on the screen and another on the phone.

This repo's usual idiom for one fact in two files is to read one as text and assert agreement
(`tiers.test.ts`, `chordAlignment.test.ts`) — but that is for cases where an import is *impossible*.
Here it is possible, and a copy plus an agreement test would only be identical until the first bug
fix. The price is that nothing in that directory may import outside itself: no DOM, no
`import.meta.env`, no `firebase/*`, no React. `portable.test.ts` enforces it, and the **`browser/`
subdirectory** holds the modules that cannot obey (localStorage, the Firestore client). `readdirSync`
does not recurse and the tsconfig `include` uses a single `*`, so the two agree by construction
rather than by a list.

### The interests are gone, and tags still have to mean what they say

There was a whole grammar here: `Interest` with keywords matched on word boundaries, a `*` suffix
for a Polish prefix match, all-of tags, any-of cities, ISO-2 countries OR-ed with
`internationalAnywhere`, `includeCoverage`, a date window, `leadDays`, a mute, a synced collection
per account with tombstones, eight seeds, an editor, a tab, and `match.ts` compiled into both
runtimes so the feed and the collector could not disagree about any of it. **All of it is gone
(Sep 2026), at the owner's request**, and the reasoning is worth recording because the feature
worked and the arguments for it were sound.

What it was for: one durable list, written once, applied to every source. What it cost: the edge
cases. Every source needs a different rule — a theatre wants its sale dates, an entry platform
wants a place, a magazine's feed wants almost nothing — and expressing five different questions in
one vocabulary meant each seed was a workaround for the vocabulary rather than a statement of what
was wanted. The three shapes an interest could take (keyword, keyword-less-plus-tag, tag-plus-city)
were three ways round the same problem. Per-source filtering is the answer instead: what a source
collects is decided in its adapter and in the pages it reads, and whether this account hears it at
all is one checkbox on its card.

So `match.ts`, `interests.ts`, `filtering.ts`, `cities.ts`, `useEventInterests`, `EventsInterests`,
`InterestForm`, `InterestRules`, the Events `SyncBadge`, both `interests.astro` pages and about
forty translation keys in two locales are deleted; `countries.ts` is down to `ONLINE` and
`countryLabel`, its hundred-and-thirty-name table having existed for one caller. `_redirects` 301s
both locales' `interests` paths to `/apps/events/sources/`, bare and slashed, because an installed
app precached the route. `users/{uid}/eventInterests` documents are **not** deleted — the catch-all
rule still covers them, nothing reads them, and a migration that deletes user data to tidy a schema
is a worse idea than a collection nobody opens. Same call as `eventIgnores`, below.

**`EventRecord.haystack` went with it**, which is the one change here that touches every stored
document. It was folded title + subtitle + venue + city + the head of the description, computed on
every upsert and read by exactly one thing: the keyword matcher. `batch.set` rewrites the whole
document, so the field drops off the corpus over the run after this deploys, and the client's pull
gets a couple of hundred bytes a row lighter. `haystackOf` is in the history if a search box ever
wants it.

What is left of the grammar, and what is not:

- **`Interest.leadDays` is `LEAD_DAYS`, one number, 14.** It could differ per interest — 45 days
  for a season, 30 for a marathon, 14 for a ticket sale — and nothing replaces that. A race is now
  warned about on the same schedule as a concert, which is a real loss and was taken deliberately.
  If a per-source lead is ever wanted it belongs in the source catalogue beside that source's
  pages, not in a second per-account collection: a theatre and an entry platform differ because of
  what they publish.
- **`Interest.includeCoverage` is nothing.** `coverage` rows reach the feed like any other. The
  sponsor posts and pacer times that made `EventKind` worth having are four cards from a ten-item
  WordPress feed, and the answer to a feed that is mostly those is the switch on its card.
- **`Interest.cities` and `cityKey` are gone, and `CITY_ALIASES` with them.** The table that joined
  `Warsaw` to `Warszawa` had one reader. Every row still states its own town and the card prints
  it; nothing compares two spellings any more. Metro Watch keeps its own station alias table and
  the rule that outlived this one — **a wrong alias is worse than a missing one**.
- **`EventKind`, `Reach` and `country` are all still written, and only `country` and `reach`
  filter — on one source, by opt-in** (python.org's country and reach pickers, below). Otherwise they are read on the card: the place chip, and the kind chip on anything that is not a `listing`. A `?`
  there is how "the classifier has not reached this row" is said, and it is now the only sign in
  the app that the pass has stopped — which is why `extraction.ts` counts it per source.

**The tag rule survives the interests and is worth keeping**, because what it is really about is a
source claiming more than it knows. `haystackOf` used to fold tags into the text it searched, so
any tag a source applied feed-wide became a blanket keyword hit for every row: tagging the Jewish
Culture Festival's feed `klezmer` put all 67 of its articles — one about Ted Kaczynski — in front
of somebody who asked about klezmer. `tagsFor` in the Teatr Wielki adapter fell through to `opera`
for anything that was not ballet, handing a keyword-less interest an entire season, galas included.
Ticketmaster's `tagsOf` mapped `genre.includes('classical')` onto `opera`, taking Opera Narodowa
from 7 matches to 202, the other 195 being candlelight Chopin recitals. Three directions, one
mistake. The rule to apply when mapping a source's vocabulary onto ours is unchanged: **widen a tag
only as far as the narrowest reader of it can bear**, and let the raw genre slug carry the rest.

Who the narrowest reader is has changed, and it is a shorter list than it was: `distancesOf` is
gated on `running` and will put `42.2 km` on a film night if that tag widens (`maraton` is a live
Polish word for a long sitting of anything); `presale` counts down to `ticket-sale` and will put a
reminder on the calendar for a press office if that one does; `needsClassifying` and the newsroom
reader's queue are `newsroom`; and the classifier's prompt reads `tags` wholesale. A page may
stamp feed-wide only what every row on it **is** — `newsroom` on a news list, `running` on a
running listing, `history` on a history magazine — and anything narrower goes on per row.

`ticket-sale` is the sharpest case and the one the Teatr Wielki adapter is careful about: it is
applied per row and only where a date was actually read out of the prose, because it means "there
is a deadline on this row" and `presale` is what acts on it. Stamped page-wide it would schedule a
reminder about a parking notice.

### What may wake me up

`notices.ts` is pure, so the whole "should this push fire?" question is reachable from a unit test
rather than from a phone at 7am.

**Everything an enabled source collects is push-eligible**, which is the change the interests'
removal made here and it is the one to understand before touching a cap. The interests used to
stand between the corpus and the lock screen; the source switches are what stand there now, and
they are per publication rather than per subject. So the caps are doing more work than they were.

- **`armedAt`** — written when notifications are first armed. Nothing already in the corpus at that
  moment can ever be `announced`. Without it, arming replays the entire corpus into the lock screen.
- **`announceFloor`** — the same rule for a source switched back on, from the moment of the tap.
  See *The switch on each source* below.
- **`maxPerRun`** (3) — the overflow becomes one summary, and the suppressed notices are still
  latched so they never fire individually later. This is what saves you when a scrape's markup
  shifts, every synthesised key changes, and an entire opera season looks new.
- **`maxOnSalePerRun`** (10) — `onsale` and `presale` share it, and it never becomes a summary:
  tickets going on sale is the thing that was asked for, and it is not noise.
- **`maxSoonPerRun`** (5) — **new, and only needed because the interests went.** A reminder used to
  fire only for a row an interest had named, so the ceiling was the length of a hand-written list;
  with the whole corpus eligible, a fortnight's lead over a national race listing is a morning of
  buzzing about races in towns nobody chose.

There used to be a third clock beside `armedAt` and `announceFloor`: **`interest.createdAt`**, a
field of its own rather than `Versioned.updatedAt`, so that adding an interest surfaced its backlog
in the feed and pushed about nothing while editing one keyword did not re-arm it. Nothing replaces
it, and nothing can — there is no per-reader act left that widens what matches.

**The overflow of `maxSoonPerRun` and `maxOnSalePerRun` is dropped, not latched**, which is the
opposite of what `announced` does and the distinction is the interesting part. An announcement is a
one-off: suppressing one without claiming its id only postpones the flood to the next run. A
countdown is asked again every run, and the events dropped today rise to the top of the sort as
they get nearer — latching them would silence exactly the ones about to become worth a reminder.

One notice per kind per fingerprint. The key is the fingerprint rather than the event id so one
concert listed by two sources notifies once.

#### `presale`, and why `onsale` was never enough

`onsale` fires when a ticket link **appears**, which is a thing that can only be observed after it
has happened. For a Teatr Wielki season that is the wrong side of the event entirely: the sale opens
at 11.00 on one morning and the house is half sold by lunchtime, so a notification that arrives on
the next six-hourly run is a notification about seats somebody else has.

The date, though, is **known weeks ahead**. `presale` counts down to `EventRecord.onSaleAt` exactly
as `soon` counts down to `startsAt`, on the same `LEAD_DAYS`. Four things about it:

- **`onSaleAt` must be in the future.** Nearly every Ticketmaster row carries the date its sale
  opened, usually months ago; without the guard the feature's first run is a hundred warnings about
  the past.
- **It is deliberately not gated on `isFresh`**, unlike `announced`. A date-based reminder is not
  an announcement: a source armed today has to be able to warn about a sale announced last week,
  which is the only reason anyone would switch it on.
- **Notices are ranked by `noticeAt`, not by `startsAt`.** A sale announcement is an article and has
  no `startsAt`, so sorting on that field alone files every one of them behind every dated notice in
  the run — and then the ticket budget keeps whatever the tail happened to hold instead of the sale
  that opens first.
- **It shares `maxOnSalePerRun` with `onsale`** rather than getting a budget of its own. They are one
  category of noise, and a source that starts stating sale dates across its whole catalogue must not
  walk past the cap by arriving under a second name.

**The `announced` push names the sale date too**, where the row has one and no date of its own.
`bodyFor` used to reserve that line for `presale` and print `Announced — no dates yet.` on
everything else dateless — which was precisely wrong for the theatre's news, since the article
announcing a season *is* the row carrying the one date worth having, and the announcement arrives
weeks before the `presale` reminder does. The two now say the same sentence, and repeating it is
the point: the first says a date exists, the second that it is close. No clock is needed to choose
the wording — "Tickets on sale from 1 Sep 2026, 11:00" is true of a sale that opens then and of one
that opened then — so `payloadFor` stays a pure function of the notice.

`LEAD_DAYS` means two things at once — how long before the curtain, and how long before the sale —
and that is on purpose rather than an economy. Both answer "how much warning do I want about this
kind of thing", and a second constant would be a second number to keep in step for a difference
nobody has wanted. It was `Interest.leadDays` and could differ per interest; see *The interests are
gone* above for what that cost.

**The notice document is a lock taken before sending, not a receipt written after.** `create()` fails
on an existing document, which is the atomic latch. Written after the send, a crash between sending
and writing repeats the push on the next run — the worst thing this app can do. Written before, a
crash loses one, which is invisible and recoverable. Lose one rather than send two.

Notice ids are `${slugKey(fingerprint)}|${kind}`. The separator is `|` because event ids contain
hyphens, and the key is the **fingerprint** rather than the event id so one concert listed by two
sources notifies once.

### The service worker, and why a name collision there is expensive

`generate-sw.mjs` now inlines **three** pure modules (`sentry.js`, `routing.js`, `push.js`). They
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

**A rejected `showNotification` is reported to Sentry** as `sw.push.show.fail`, and it is the one
failure on this worker worth waking somebody for. There is nothing the handler can do about it —
the rethrow is deliberate, so the platform still sees the push as unhandled and behaves as it
would have — but the symptom is the *absence* of notifications, which is exactly the failure
nobody discovers for a month. Reporting it does not change the shape above: `showNotification` is
still called on every path and there is still no early return.

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

### A subscription belongs to one app, not to the account

`pushSubs` was written as one row per device, on the reasoning that one origin serves one service
worker and therefore hands out one endpoint per browser. **That is true in a browser and false on a
home screen.** iOS gives every installed app its own storage container, its own registration and its
own subscription, and it attributes a delivered notification to the app that owns the endpoint —
name, icon and grouping. So a phone with Event Watch *and* Metro Watch installed holds two rows, and
a collector that fanned out to every row on the account put a fortnight of opera announcements in
the app somebody installed to hear about the metro, under Metro Watch's name. Both collectors were
correct on their own terms; the collection was the thing that was wrong.

`PushSub.apps` fixes it and `pushApps.ts` is the whole of it: `useWebPush` takes the app it is
arming for, stamps the row, and each collector filters with `subsForApp` before it sends. Three
things about that are load-bearing.

- **A map, not an array.** `setDoc(..., { merge: true })` replaces an array wholesale and merges a
  map key by key. On a desktop browser one endpoint really does serve both apps, and two tabs
  writing an array would each silently drop the other's claim — leaving whichever app was opened
  last as the only one that could reach the machine.
- **An unclaimed row belongs to every app.** Every subscription registered before this field existed
  carries no claim, and reading that as "nobody may push here" is a silence with no symptom. Read as
  "both", the behaviour is exactly the build being replaced, for as long as it takes each app to be
  opened once — and the launch check stamps the row on that first open rather than waiting for the
  twelve-hour heartbeat, which is what `loadPushApps` is for.
- **The device list is filtered too.** The Alerts tab answers "which devices will *this* app
  notify?", and it carries a Remove button — offering Metro Watch's endpoint under Event Watch's
  heading is an invitation to turn off the metro alerts from the wrong screen.

`pushTargets.test.ts` reads `functions/src/` as text and fails any file that reads the whole
`pushSubs` collection without `subsForApp`, because the thing that goes wrong here is not a wrong
answer from a function anybody wrote — it is a fourth place that reads the collection and forgets. A
read of a single row by id is exempt: `sendTestPush` is handed the device to test by the person
pressing the button.

The same mistake had a cosmetic half. `notificationOptions` hardcoded the events icon, so a metro
closure arrived wearing a ticket and a calendar — invisible on iOS, which draws the installed app's
own icon, and plain in a desktop browser. `pushIconFor` derives it from the path the tap opens, so
an old sender and a payload that fell back to the defaults both still get it right.

### Where a tap lands

A notification names one event; every tap used to open `/apps/events`, which is the feed's first
screen, so finding the concert the banner had named was left to the reader. `links.ts` is the fix,
and it is in the portable set because both ends of that string are: the Cloud Function writes
`?event=<fingerprint>` into the payload and the feed reads it back out. Two copies of one spelling
in two runtimes is exactly the drift that directory exists to prevent.

**The fingerprint, not the event id.** The feed shows one row per real-world night and
`dedupeByFingerprint` decides which document that row is — Ticketmaster's copy or the house's own —
so an id can perfectly well name the copy that lost and point at a card that is not on the screen.
It is the same reasoning `noticeIdFor` is keyed on the fingerprint for.

**A visit from a notification used to turn every filter off, and say so.** It opened on `all` rather
than `matched` with the stored city and label filters unapplied, because an interest edited since
the push was sent, a dismissal pressed afterwards or a city chosen weeks ago could each hide the one
row the tap was about — and a highlighted card nobody can see is the same bug wearing a fix. There
are no filters to turn off now, which is the quiet dividend of the feed having none: the only thing
that can still hide the row is the source it came from having been switched off since, and the note
says so. When the
row is genuinely gone — it happened, or its sale opened — the note says that instead, but only once
the network has answered: the cached feed is hours old and routinely lacks the row the push was
about, and announcing it missing on the first frame would be wrong about half the taps and then
correct itself.

**The locale is decided per subscription, not per notice.** `/apps/events` and `/pl/apps/events` are
two installed apps with two manifests (`manifestIdentity` in `pwa/scope.ts`), so handing a Polish
home screen the English path does not merely read English — the tap falls outside that app's scope,
the worker finds no window of its own to focus, and iOS opens Safari beside the app the notification
came from. One payload is built per notice, and `sendTo` rewrites its path from `sub.lang`, that
being the only place in the send path which knows what device is being written to. Everything else
in a notification stays language-neutral on purpose; where the tap goes is not a matter of wording.

The deep link needed one thing from the worker: `documentKey` used to include the query, so
`/apps/events/?event=…` was a cache miss and a notification tapped on the underground opened the
offline page rather than the app. Documents are keyed by path alone now — see `pwa.md`.

### How long the race is

`distance.ts` pulls a race's distances out of its title and `toRecord` stores them as
`EventRecord.distancesM` — **metres, integers, ascending**. Kilometres would be floats: a half
marathon is 21,097 m exactly where 21.0975 km is a number two runtimes may print differently, and
this value is written and compared on every run. The card draws it as the first chip in the meta
row and `bodyFor` puts it ahead of the date in the push body, which is the half that mattered —
a notification is the one place there is no card to open, and `XVII Bieg Ziemi Puckiej` on a lock
screen is a name, not a decision.

**Precision over recall, and the numbers say what that costs.** Every rule is anchored on a unit
or on a word that can only be a distance; nothing is inferred from a bare number. Race titles are
full of numbers that are not distances — `44 Międzynarodowy Bieg` is an edition, `5. Pietrasze
Cross Country 1/5` a round, `Grand Prix 2026 - 13.09.2026` a date, and `Bieg 3 Króli` is three
kings. Measured against the four live listings on 3 Sep 2026: **27 of 134 races carry their
distance in their title, and none of the other 107 produced a false one.** Four cards in five stay
quiet, deliberately — a card that says nothing is one you open, a card that says `44 km` about a
5 km run is one you plan a season around.

Three things in there are load-bearing:

- **The `running` tag is the gate, and it is the whole safety of the feature.** `maraton` is a live
  Polish word for a long sitting of anything — *maraton filmowy*, *maraton pisania listów* — and
  `piątka` is a five of any kind. Run across the whole corpus, the same rules that are exactly
  right about a race put `42.2 km` on a film night.
- **The named distances are most of the yield.** Polish names a race after its length far more
  often than it states one: `Stalowa Dycha`, `Nocna Piątka`, `Hajnowska Dwunastka`, `Zamkowa
  Energetyczna Ósemka`, and the marathons, which are never written as a number. They inflect
  through every case, so each is a prefix — the same bargain `klezmer*` makes in the matcher. The
  `\b` anchors are what keep them independent of each other: folded, `półmaraton` is `polmaraton`,
  so `\bmaraton` cannot see it, and `ultramaraton` hides from both, which is right — an ultra has
  no one distance.
- **A number's left edge is a consumed character, not a lookbehind.** Without it a three-digit
  pattern reads the *tail* of a longer number and `Bieg 2026 km` is a 26 km race. Safari only
  learnt lookbehind in 16.4 and this file compiles into the browser bundle too, so the guard is
  `(?:^|[^\d.,])` and the capture group stays group 1.

The **description is deliberately not read**, only title and subtitle. A description is prose, and
prose says `10 km od centrum`, `przewyższenie 300 m` and `500 m od mety` — distances that are real
and are not the race's. The one source that lists races carries no description at all, so this
costs nothing today and holds the line the day an adapter starts supplying one.

It is derived in `toRecord` beside the id and the fingerprint rather than in the running adapter, so a second source of races cannot get it subtly different — the Maraton Warszawski feed
already tags itself `running`. And unlike the classifier's fields it is **not** carried forward by
`mergeRecord`: it is recomputed from the title every run, costs nothing, and a stale one would
outlive a title being corrected.

The obvious next step, if four in five is not enough: `elektronicznezapisy.pl/event/<id>.html`
carries the organiser's own description, and roughly half of the titles that say nothing state a
distance there. That is ~110 extra page fetches per run against an adapter that currently makes
four, so it belongs in a `classify.ts`-shaped pass — after the upsert, only for events still
without a distance, capped per run and latched so it converges — and not in the listing scrape.

### The sources, and why most of them are generic

Five adapter *types*, not five scrapers — `rss` and `ical` are driven by URL lists and
`elektroniczne-zapisy` by a third, so watching one more festival blog is a line in `FEEDS`, and one
more running discipline a line in `RUNNING_LISTINGS`, not code. An adapter returns `RawEvent[]` and
**nothing derived**: the id, the fingerprint, the day and the distances are computed by
`upsert.ts`, so a new adapter cannot get normalisation subtly different.

- **teatrwielki.pl** is the source the app was really asked for, and it is now **one page**:
  `/teatr/aktualnosci/`, the theatre's own news list. It is read for one fact — the morning the
  tickets go on sale — because that is the only thing this house publishes with a deadline on it.

  **The season repertoire scrape is gone** (Sep 2026), and it is worth knowing what was given up
  before anybody restores it. `/repertuar/sezon-2026/27/` is plain server-rendered markup carrying
  a title, a genre, a composer, a premiere date and a stable slug per production, and it minted
  about sixty rows a season; `parseSeasonPage`, `slugOf` and `tagsFor` read it and a committed
  fixture guarded it. What it could never answer is the question above — a production's page grows
  a ticket link on the morning of the sale, which is the wrong side of the event — and the question
  it did answer, *is Figaro programmed*, is never urgent and is on the theatre's own site in ten
  seconds. Two consequences, neither reversible by wanting them otherwise:

  - **Nothing stamps `opera` or `ballet` any more.** Those came off the season teaser's genre line,
    and a news item has no genre line. The keyword-less `Opera Narodowa` seed (`tags: ['opera']`)
    therefore matches nothing this source produces; Ticketmaster's `tagsOf` still stamps `opera`
    where a listing really says so, which is the whole of what can now reach it.
  - **The corpus carries no Teatr Wielki *performance*.** Every row from this source is an article,
    so `startsAt` is null on all of them and the house contributes nothing to the dated half of the
    feed. `/kalendarium/` cannot fill the gap: it is a TYPO3 shell whose calendar is drawn in
    JavaScript, `data-day` attributes and no events.

  The **news list** is the only page in this app that answers a question with a deadline: *when does
  the sale open*. The theatre states it in prose — "Sprzedaż biletów od 1 września, g. 11.00" — a
  fortnight or more ahead, and `parseSaleAnnouncement` reads that sentence into `onSaleAt` so
  `presale` can count down to it. Four things about that read:

  - **There is no year in the sentence.** `parsePolishDate` required one and rightly refused to
    guess; here the guess has to be made, and the article's own `datetime` attribute is what makes
    it safe — a sale is announced before it opens, so the answer is the next occurrence of that
    day and month at or after publication. That rolls a December announcement of a January sale
    into the next year without a special case. (`parsePolishDate` itself went with the season
    scrape, its only caller; `yearFor` inside `parseSaleAnnouncement` is what does this now.)
  - **The sale wording is required, and the date must follow it.** The same list carries "Od 12
    czerwca 2026 roku nasi Widzowie mogą korzystać z 30% zniżki na parking" — a date after "od",
    about a car park. A reader that took any such date would put that on the calendar as a ticket
    sale.
  - **Every row is kept, not only the ones announcing a sale.** `eventSources` reads zero as a
    failure only where there used to be something, so a page that legitimately yields nothing for
    months could not be told apart from one whose wording moved. Ten articles a run is a health
    signal that stays honest — and it is now the *only* health signal this source has, the season
    pages having been the other half of it.
  - **`ticket-sale` is applied per row and never stamped on the page**, and only where a date was
    actually parsed. That tag is the whole of the keyword-less `Ticket sales opening` seed, and a
    tag is what `presale` counts down to — page-wide it would put a reminder on the calendar for
    the theatre's job adverts. Fourth direction, same mistake; see the tag rule above.

  **Three pages are read, not one** — `/teatr/aktualnosci/` and `p/2/`, `p/3/` behind it, per
  `TEATR_WIELKI_NEWS_PAGES`. The front page holds ten articles, which is about two months, and
  that was a **reach** limit rather than a parse one: the 15 April 2026 item *Wkrótce ogłoszenie
  nowego sezonu!* — the one carrying the 2026/27 sale date, see below — was two pages back by the
  time this scrape first ran on 3 September, so it was never ingested at all and no reading of any
  prompt could have recovered it. Six-hourly runs cover the front page comfortably for news
  published from *now* on; they do nothing about the spring before, which is when a theatre
  announces a season. Thirty articles reached five months back when this was written.

  The failure contract differs by page and it is the interesting half. **The front page failing is
  the source failing** and is not caught — it means the markup moved, and there is no season
  scrape left to look healthy in its place. **An archive page failing is not**: `p/3/` stops
  existing the day the theatre has fewer than thirty articles, and a source that went red over its
  own depth would cry wolf. What that forgiveness costs is a `p/2/` which silently 404s leaving
  this back on ten rows — visible in the count rather than in a flag, so `smoke.live.test.ts`
  asserts more than ten rows for this source specifically.

  The row's `<time datetime>` is **kept** as `publishedAt` as well as being read for the sale's
  missing year — see *An article had no date at all* below for why a card that could only say
  `Announced 2 d ago` made two-month-old news the freshest thing on the screen.

  `startsAt` stays null on every row, sale or not: a news item is an article, which is the rule the
  RSS adapter is built on. `feed.ts`'s `actionableAt` is what stops that filing the one row with a
  deadline under *announced, no dates yet* — it reads `startsAt` where there is one and `onSaleAt`
  otherwise, so the announcement is grouped, sorted and expired by the morning it is about. Nothing
  else in the feed moves, `onSaleAt` being set only where a source stated it in advance.

- **python.org** is an iCal feed — 874 VEVENTs, mostly historical, so `collect.ts` drops anything
  already past. Geography is deliberately *not* filtered at collection: what is collected is a fact
  about the world, so PyCon US is in the corpus whether or not anybody would fly to it, and the card
  says which country it is in. What reaches *this account* can be narrowed by the country picker on
  its card — see *And the country picker* below. RFC 5545 line unfolding is the one parsing bug
  worth naming: miss it and every long `SUMMARY` truncates at 75 octets, which looks like the feed
  having short titles.
- **RSS feeds** leave `startsAt` null on purpose. A feed item is an *article*: putting its `pubDate`
  in `startsAt` would file every post as happening today and then let `soon` fire about it. The
  `pubDate` is kept as `publishedAt`, which is a different field answering a different question —
  how old is this news, not when is the event.

  It is also the one adapter that **names its own publication**. `toRecord` takes `sourceName` from
  the adapter's label, which is right for the four sources that are one place — a Teatr Wielki night
  comes from Teatr Wielki — and wrong for this one, where the label is `Watched feeds`: the name of
  a *mechanism*, stamped identically on a history magazine, a festival's blog and a running
  publication. `EventRecord.sourceName` always meant the publication (its own comment gives
  `historia.org.pl` as the example) and the adapter simply never supplied it, so `RawEvent` gained an
  optional `sourceName` and `parseFeed` sets `feed.label`. Three things were wrong until it did: a
  card could not say where a piece came from, three unrelated magazines were one line wherever a
  source is named, and **the classifier was told the least useful thing
  available** — `sourceName` is in its prompt *and* its hash precisely because a theatre publishes
  nights and an organiser's blog publishes prose, and `Watched feeds` says neither. `Maraton
  Warszawski` nearly answers the `kind` question on its own.

  The hash is the cost, and it is worth naming: `classifyHashOf` reads `sourceName`, so every feed
  row's stored hash stops matching once and those rows re-classify over the next run or two. That is
  a few dozen calls, and they are the rows whose verdicts stood on the worst evidence.

  The entry platform deliberately does **not** do this, although `parseListing` already has the page
  in hand. Its several pages are disciplines of one platform rather than different publications, and
  their labels are `displayUrl` URLs rather than names — so it would put a URL on every race card,
  re-hash several hundred rows, and tell the model nothing it did not have. A race comes from
  Elektroniczne Zapisy whichever listing page it was on.
- **elektronicznezapisy.pl** is the second bespoke scrape, and it is there because a race is not
  repertoire and Ticketmaster does not sell one. Organisers publish, but each on its own WordPress —
  the RSS route would have been a line in `FEEDS` per club and still no dates. An **entry platform**
  is the one place a race is a row: it exists to be signed up to, so the listing carries a stable
  numeric id, a day, a place and a link that becomes the form. Two things about that row shape the
  adapter. The **city is inside the title**, as `Miasto, "Nazwa"`, so `splitPlace` reads it per row
  rather than the page stamping one on; the split is greedy on the left because `Kurejwa, gm.
  Grajewo` is one village. And **`signup.html` is a second page**, which is what makes an `onsale`
  transition real here where it can never be for Ticketmaster — a race is announced with its date
  months before entries open, and the button appearing is the event.

  The fetch is deliberately **not** narrowed to `?city_id=12`, which the platform offers and which
  would have halved the rows. A Warsaw baked into the *fetch* is one reader's preference written
  into a corpus every account shares, and the day the question becomes Kraków there is nothing
  stored to answer it with. So the collector takes the national listing and every row says its own
  town, which the card prints.

  That is also what makes this **by some way the longest source in the feed** — a hundred-odd races
  nationally against ten items from a WordPress feed — and since the interests went there is no
  `cities: ['Warszawa']` to narrow it with. The switch on its card is the answer, and it is the
  first one to reach for if the feed is too long to read.

- **Ticketmaster** can never produce an `onsale` transition — its listing *is* its ticket page. That
  is correct, not a gap. No API key is a configuration state, not a failure, so it returns `[]`.

`eventSources/{id}` records health, and **zero is a failure only when the source used to return
something**. Without that table the theatre could redesign, the scrape return `[]`, and the app go on
looking perfectly healthy while never announcing another opera — the most likely way this fails and
the least likely way anyone notices.

`functions/src/smoke.live.test.ts` runs every adapter against the real network under `LIVE=1`
(skipped otherwise, so CI and an offline laptop are unaffected). It is what caught both the
haystack bug and the opera over-tagging, back when there was a keyword matcher for either to break;
it now prints what each source collected and what the feed makes of it. Run it after touching an
adapter.

### The Sources tab, and why the URLs had to move

The feed answers what is on. `/apps/events/sources/` answers *and how would I know if that were
wrong* — every page the collector requests, as a link, so the claim is checkable rather than stated.
The Alerts tab's health table already named sources; it never said what a source **is**, and a
`teatr-wielki` row reading `ok, 64 events` told you nothing about which pages produced them — that
count was the season scrape, and the row now reads `ok, 10 events` off one news page.

**The catalogue is in `src/utils/events/sources.ts`, not beside the adapters.** That is this app's
one-matcher-two-runtimes argument reaching a second fact: the browser cannot import a Cloud
Function, so a list of URLs next to the scrapers would have had a copy in the island, correct until
the first time a feed moved. So the adapters now *import* their targets — `FEEDS` drives the RSS
adapter, `RUNNING_LISTINGS` the entry-platform scrape, `TEATR_WIELKI_NEWS` the theatre one, and
`PYTHON_ORG_ICAL` and `TICKETMASTER_ENDPOINT` the other two — and the tab lists the same objects the
collector fetches. `functions/src/sources/index.test.ts`
asserts `SOURCES` and the catalogue still name the same five things: the drift is one-sided and
silent otherwise, a new source collecting events the tab claims nothing produces.

Two rules that file keeps, and they are the same rule twice — **it holds facts, not words**:

- **No secret ever appears in it.** It compiles into the browser bundle, so the Ticketmaster entry
  is the query *without* its `apikey`, which the adapter appends at the point of the request. A URL
  is a page to show; a key is not. `sources.test.ts` greps the rendered URLs for it rather than
  trusting the next person to remember.
- **No prose either.** It also compiles into a Cloud Function, which has no locale. The sentence
  describing each source lives in `Events/translations.ts` behind `sourceNames.ts`, whose two
  tables are `Record<SourceId, keyof Translation>` — so a new source is a compile error until
  somebody names it and says what it covers. It shipped the other way round for one build and the
  Polish page printed four English paragraphs.

`sourceNames.ts` is shared with the **Alerts** tab, which now draws its health rows under the same
names. Two tabs naming one source differently is worse than either name. A source's catalogue
`label` stays its *server-side identity* — the string a health row and a "this source has stopped
working" push are written under — and is what an id nothing describes falls back to.

Four facts per card, and they are four different questions:

- **The pages**, from the catalogue. Static: no network, no pull, no collector run, so the tab says
  something useful offline and on an account whose first collection has not happened. Each carries
  what that *page* stamps on everything it yields — its tags, its city, its country. That is on the
  screen because a tag a page stamps feed-wide is a claim about every row behind it, and this app
  has made that mistake from three directions (the Jewish Culture Festival's feed, `tagsFor`'s
  fallthrough, Ticketmaster's `classical`). Being able to read a source's blanket tags off the page
  they come from is what makes the fourth one catchable.
- **Health**, from `eventSources`. Three states and not two: never run is not ran-and-found-nothing,
  and only one of them is a reason to go and look at the page.
- **How much of the corpus is its.** A source can be green, be read, and be contributing nothing you
  would miss — which is not a failure, does not belong in the health table, and is what you look at
  before deciding a scrape is worth its fixture. Drawn as a chip rather than more grey text after a
  separator: spaced apart the two statuses read as one run-on sentence, and a `·` between them
  orphans onto the second line at 320px, where it reads as a bullet.
- **What a model was asked about its rows, and how much has come back** — `extraction.ts`, and the
  section below.

And **one control**: the switch, which is the only thing on this tab that writes anything and,
since the interests went, the only filter left in the app. *The switch on each source* has it.

There was a fifth fact — the interests reaching each source, each with what it kept of that
source's rows, drawn read-only and editable in place. It went with the interests themselves, and so
did the question it answered. The argument it was built on is what per-source filtering now does
structurally: **a filter is written once and judged in one place, which is beside the rows it
decides about.**

A health row the catalogue does not describe gets its own short list under *Also reporting* rather
than a special case for the id we happen to know about. `classifier` lands there correctly — it
reports beside the scrapes because it fails the way they do, and it is not a page — and so would a
scrape deleted from the catalogue and still collecting, which is the one worth seeing.

`displayUrl` is why a link's text is the URL and still fits: the whole point is checking it, so a
friendly name would be one more thing to take on trust — but python.org's calendar is a
103-character Google Calendar id that takes three lines of a 320px panel to say nothing, so a long
one collapses to its host and last segment. The `href` is always whole. Language-neutral by
construction, which is what lets it live in the portable file at all.

Behind the sign-in gate like every other tab. The catalogue alone would render fine signed out, but
most of the card would be empty and one tab behaving unlike the other three is worse than the
consistency is worth. No PWA work was needed: `APP_TIERS['events']` already claims the whole
subtree, so the tab precached itself.

### What a model was asked about a source's rows

`extraction.ts`, drawn under each card. Two passes exist — the classifier over the corpus and the
newsroom reader over the articles — and the block says, **for this source's rows only**, how many
each has answered and how many carry each field it writes.

**Which pass owns a row is a fact about the row, not about the scrape**, so it is counted rather
than described. `needsClassifying` skips anything tagged `newsroom` and `readNewsroom` reads
nothing else, which means a source that starts tagging its pages moves between the two passes with
no code changing anywhere — and a per-source table claiming otherwise would be wrong with nothing
to catch it. `modelPasses` splits on `isNewsroomItem` for that reason, and leaves out a pass with
no rows: four of the five sources produce no newsroom articles, and four empty headings saying so
would be four sentences about nothing.

Three things it is careful about:

- **A pass is "answered" by its stamp, never by a verdict field.** The classifier call asks three
  questions and may come back with two, so counting `reach` would report a model that declined to
  guess a country as half stopped, and the queue would never look empty. It counts `classifiedAt`
  and `newsroomReadAt` — which is the same argument `classificationCoverage` was written with, one
  screen along and per source.
- **A field the source states itself is marked as such.** Every Teatr Wielki and Ticketmaster row
  arrives with a `country` from the page, so `country 40` beside `12 of 40 answered` is two numbers
  that look like they cannot both be true. `ExtractedField.shared` is what says they can.
- **A pass with rows and nothing answered is drawn, at zero.** That is the state the whole block
  exists for: an unclassified row **passes** every rule the classifier feeds, so a stopped
  classifier shows up as more noise rather than as an empty feed, and there was previously nowhere
  in the app to see it per source. A count stuck at zero against a full scrape is the picture.

The stored field name is printed in a monospaced face beside the sentence describing it, for the
reason a page's link text is its URL: the words make it readable, the name makes it checkable
against a document in the console or against `types.ts`. Not VT323 — that face draws `l`, `1` and
`I` alike, which is the Pipeline tab's one surviving lesson about reading strings character by
character.

### The interests that reached a source, and what replaced the block

`filtering.ts` drew a second block under each card: how many of that source's rows reached the feed
at all, then the interests that kept something, each with its own count, drawn read-only by the
same `InterestRules` component the Interests tab used — and editable in place, through
`useEventInterests`, so there was one writer and one sync queue. It is gone with the interests
(Sep 2026) and the reasoning it was built on is worth keeping, because it is the reasoning *for*
per-source filtering rather than against it.

The block existed because an interest was written once and applied everywhere — "klezmer concerts"
is not a fact about a feed — but could only be **judged** in one place, beside the rows it decided
about. A list of interests on a tab of its own says what you asked for; it cannot say that the tag
you narrowed on is stamped by no source you watch, or that the one interest reaching a magazine
keeps sixty-seven of its sixty-eight articles. Both of those were failures this app actually had,
and both were invisible from either side alone. So a filter written globally had to be drawn
locally, under every source it touched, with one open form slot for the whole tab because the same
filter appeared under five cards and two open copies would have been two drafts of one document.

Filtering per source removes the join rather than displaying it. What decides whether a row exists
is the adapter and the pages it reads; what decides whether this account hears about it is one
checkbox on that source's card. Neither is written in one place and read in another, so there is
nothing to reconcile on screen — which is why the card is down to `n collected` beside the switch.

Two things it taught that outlived it:

- **Counted over the feed pull, not the whole corpus** — what is upcoming or undated. That was the
  honest set for "what does this get me from here", and it is the set the `n collected` chip still
  counts, which is why this tab needs no second query. `pullAllEvents` went with the Pipeline tab.
- **A count that can contradict another count on the same card is worse than no count.** The two
  numbers came from one pull for that reason, and `n collected` is still counted over the same
  rows the extraction block counts over.

### The switch on each source, and the two things it does not do

The facts above answer "is this source worth its fixture?" and left you with nowhere to put the
answer. A pipeline is tuned by running it, an adapter that turns out to be noisy is fixed in a
fixture and a deploy, and in between the phone keeps ringing — so each card carries a checkbox, and
`src/utils/events/sourcePrefs.ts` is what it writes.

It was built as a blunt instrument beside a fine one. **It is now the only one**, which is a good
deal more weight than it was designed to carry and is worth knowing before changing anything here:
a source is in the feed and on the lock screen, or it is neither.

**It is this account's preference, not an instruction to the collector.** `events/` is one shared
corpus scraped from public pages and `eventSources/` is the health of the scrape; both are facts
about the world rather than about a reader, and neither may change because one account got tired of
a feed. So a silenced source is still fetched, still counted in the *"n collected"* chip
beside it, and still reports health — zeroing that count would make a silenced source look
identical to a dead one on the one screen where the difference is the question. What stops is it
reaching this account's feed and this account's lock screen. Turning it back on therefore loses
nothing, which is the property that makes the switch worth reaching for at all.

**And it is not a view filter.** The Feed's own controls — a city picker, two rows of label
toggles, a view switcher — were per-device preferences that could never stop a notification, and
they are all gone (see *The feed has no filters* below). This switch deliberately can stop one,
which is most of its point, so it is an account setting that syncs: `users/{uid}/eventSettings/sources`,
beside the push settings, read by `useEventSourcePrefs` and by `loadAccount` in the collector. One
document rather than a collection of five, because these are five booleans and not five records;
`mergeSourcePrefs` settles each switch by whichever device flipped it later, so the phone silencing
one feed and the laptop silencing another is not a conflict at all. A dead heat goes to **off** —
of the two ways to be wrong, the quiet one is undone by a tap.

Three rules keep it honest, and the third is the one that is invisible until it bites:

- **A silenced source simply is not in the feed.** It used to be drawn in the `Everything` view
  under a `Source off` chip, on the grounds that a row absent from one view and present in another
  with nothing saying why reads as the matcher disagreeing with itself. That view is gone and the
  argument came with it: there is one list now, and what the switch is currently keeping out is
  the `n collected` chip on the card that carries it.
- **The empty feed says who emptied it.** The switch is on another tab, and a source silenced from
  a phone empties a laptop that has narrowed nothing — so the empty state links to Sources with a
  count. It is now the *only* line in that empty state, the other filters having gone.
- **Switching a source back on does not replay its backlog.** A fortnight off is a fortnight of
  rows newer than `armedAt`, so the one other clock `isFresh` has would let the lot through at once
  — the exact flood the box was reached for. A switch records *when it was flipped*, and
  `announceFloor` makes that a second clock: re-enabling arms that source from the moment of the
  tap, exactly as arming push arms the account from the moment of the tap. (There was a third,
  `interest.createdAt`, which did the same job for adding an interest. It went with them.)

`soon` and `presale` are deliberately not floored, only `announced` and `onsale` — the two that ask
`isFresh`. A date-based reminder is not an announcement: a race next week is next week whenever its
row happened to be collected, and hearing about it is why anybody switches a source back on. While a source is off, nothing is produced for
it and **nothing is latched**, so no notice id is consumed and the reminders survive the silence.

#### And the town picker beside it

Added Sep 2026 at the owner's request — *only the races in Warszawa* — and it is the switch's
second setting rather than a filter of its own: `SourceSwitch.city`, on the same document, merged
by the same flip time, read through **`sourceAdmits`** by both `buildFeed` and `noticesFor`. The
corpus is untouched; the fetch is still national, for the reason `?city_id=12` was turned down.

- **Options are the towns the rows name** (`townsOf`, grouped by `foldCity`), and the picker only
  appears on a source the catalogue marks **`townPicker`** — today only `elektroniczne-zapisy`.
  It first shipped on any source whose rows named two towns, which put one on python.org's
  worldwide conference calendar; being able to is not a reason to offer it.
- **Matching is folded and takes a district**: `WARSZAWA`, `Warszawa, Bemowo` and `Warszawa-Wawer`
  are Warszawa; `Warszawianka` is not.
- **A row with no town passes.** A title that lost its `Miasto, "Nazwa"` shape is stored with no
  city, and hiding it would make a parse failure look like a quiet week. Same rule as the
  classifier's fields.
- **Choosing or clearing a town moves `at`**, so `announceFloor` re-arms from the tap: widening back
  to every town does not announce the backlog the filter had been keeping quiet. Rows outside the
  town latch nothing, so their `soon` reminders survive the narrowing.

Checked against the data when it shipped (23 Sep 2026): all 152 stored race rows had a city, three
of them `Warszawa`, and the platform's own `?city_id=12` listing returned exactly the two of those
still upcoming — no Warsaw race hiding under a district or a venue name.

#### And the country picker

Added Sep 2026 at the owner's request — *filter python events by country* — as the switch's third
setting, built on the town picker's exact shape: `SourceSwitch.country`, on the same document,
merged by the same flip time, read through the same `sourceAdmits`. The catalogue flag is
**`countryPicker`**, set only on `python-org`; every other source is in Poland by construction and
would be offered a picker with one option.

- **Options are the codes the rows carry** (`countriesOf`), busiest first — a conference calendar
  names a couple of dozen countries, not a hundred towns, so the list is read down. `ONLINE` is an
  option like any other. Compared exactly: the stored form is already a code, nothing to fold.
- **A row with no country passes**, and here that is literally the classifier rule: python.org's
  countries come from the model, so an empty one is a row it has not reached. A stopped classifier
  shows up as a foreign conference in the feed, never as a feed that went quietly empty.
- **Choosing or clearing a country moves `at`**, same as a town. Every setter goes through
  `withFilters`, so flipping the switch, choosing a town or choosing a country never drops the
  other narrowing.

**And the reach picker beside it**, asked for the same day — `SourceSwitch.reach`, catalogue flag
**`reachPicker`**, python.org only. Two things about it are deliberate:

- **It is a floor, not an exact match.** *National or international* and *International only*;
  `local` is not offered, because a floor of local is no filter and nobody wants only the meetups.
  `reachAtLeast` reads the order off `REACHES`.
- **With a country also chosen, the two are OR-ed**, which is the `places` rule below brought back
  on purpose: `PL` + *International only* means "in Poland, plus anything worth flying to", where
  AND would keep the handful of international conferences held in Poland. Each axis still passes
  a row it has no verdict for. The hint under the picker says "or" out loud, because it is the one
  thing about the control nobody would guess.

### Where an event is, who it is for, and whether it is one

Three fields a model writes, and **none of them filters globally any more.** They were built as
filters and the rules that read them went with the interests (Sep 2026); the exceptions since are
`country` and `reach` on python.org, opt-in per source (*And the country picker* above). What is left is what they
say on the card, which was always half the point — see *The filter has to be falsifiable from the
outside* below, which is about exactly that. The history is kept because these fields are still
written on every run, still cost model calls, and the reasons for their shapes are the reasons not
to simplify them.

The feed's first real complaint was four PyCons — Cameroon, Africa, Greece, NL — none of them
attendable, all of them matched by `python`/`pycon`. The app had **no axis for where** at all beyond
`Interest.cities`, which was any-of over free text: saying "in Poland" would have meant listing
every Polish city, against a `cityOf` that guesses at the second-from-last comma-separated field.

A country whitelist alone does not answer it either, and that is the whole shape of this feature.
The question is not *which country* but **does this pull people in from outside** — PyCon US and
EuroPython are worth knowing about and PyCon NL is not, and nothing in a listing distinguishes them.
They can be in the same country in the same year. So two fields, and only one of them is scrapable:

- `EventRecord.country` — ISO-2, or `ONLINE`. Supplied by the adapter **where the source knows it
  for free** (`teatr-wielki` is in Warsaw, `ticketmaster` is queried `countryCode=PL`, each `FEEDS`
  entry is a Polish publication), and by the classifier otherwise. One field, never two derivations:
  the string-splitting heuristic that `cityOf` is was deliberately not written a second time.
- `EventRecord.reach` — `local` / `national` / `international`. A judgement, and the one thing here a
  language model decides.

`countries.ts` used to normalise both sides to codes, over a hand-written table of a hundred and
thirty English and Polish names, because the matcher compared `Interest.countries` against
`EventRecord.country` and a stored `Polska` would have been a filter that never fired with an empty
feed as its only symptom. Nothing parses a country out of free text now — the classifier is asked
for a code and `classify.ts` checks the shape itself — so that file is down to `ONLINE` and
`countryLabel`, which is what prints `PL` or `?` on a chip.

**The `places` rule they fed was one rule with two ways to pass**, and it is written down here
because it is the shape to come back to if a filter ever returns: `Interest.countries` and
`Interest.internationalAnywhere` were joined by **OR**, not AND. Country in the list passed, and an
`international` reach passed wherever it was held. AND-ed the way `tags` and `cities` were, it read
"in Poland *and* international", which keeps nothing — where "conferences in Poland, plus the ones
worth flying to" is one thought, which is why the checkbox sat inside the countries field rather
than beside it.

**An unclassified event passed**, per axis, and that rule outlived the filter in a different form:
nothing is excluded for want of a verdict, so the classifier being down brings the noise back
visibly rather than emptying the feed. A silently empty feed is the one outcome here that looks
exactly like everything working. Per axis, because a record can know where it is and not yet who it
is for: every scraped Polish row is `PL` from the moment it lands, with `reach` arriving later.

#### And whether it is an event at all

The second complaint had the same shape and a different axis. The running interest surfaced three
sponsor posts and a set of pacer times about the 48th Warsaw Marathon — *"Marki DIP Hot i DIP Rilif
Partnerem 48. Maratonu Warszawskiego!"* — four cards, above the one row that is the race. They were
not near misses: every one of them is genuinely about running, genuinely in Warszawa, and genuinely
matched. They are simply **articles rather than events**, which is the trade the RSS adapter names
in its own header and had until then paid in full.

So a third field, `EventRecord.kind`, from the same call:

- `listing` — the thing itself. A night, a race, a conference; something with a door.
- `announcement` — an article whose news *is* an event: entries opening, a date fixed, next
  season's calendar published.
- `coverage` — everything else written about events. Sponsor posts, results, race reports,
  interviews, gear, recaps.

**Three values and not a boolean**, and that is the whole care in this feature. The RSS adapter
exists because most of what a festival or an organiser publishes never reaches a ticketing API, and
"the 2027 tournament calendar is out" is frequently the only notice an event gets — it carries no
date of its own, groups under *announced, no dates yet*, and firing `announced` for it is right.
Collapsing that into "article" alongside the sponsor posts would drop exactly the items the adapter
was written for, and it would do it invisibly.

For the same reason **no adapter supplies this**, unlike `country`. The one that could — the feed,
whose items are articles by construction — is precisely the source whose items are sometimes the
event. A blanket `coverage` on `SourcePage` would be a rule that is right four times in five and
silently wrong about the fifth, which is what makes this a judgement rather than a field.

**`Interest.includeCoverage` was the opt-in, and it is nothing now.** It was off by default and was
the one filter here that ran without being asked for. With the interests gone the owner's call was
to let coverage through rather than to hard-code the old default: a rule nobody can turn off is
worse than the four cards it saves, and those four cards come from a ten-item WordPress feed whose
switch is one tap away. `announcement` was never touched by it either way, which is why nothing
about the theatre's news changed.

So the field is now read and not obeyed: the card draws a kind chip on anything that is not a
`listing`, which is what tells an article among the listings apart from a row nobody has judged.
There is deliberately no chip saying "yes, this is an event" — a label on every card in the corpus
is a label nobody reads twice.

#### The classifier runs in exactly one place

`functions/src/classify.ts`, in the Cloud Function. The browser never calls a model and neither does
the matcher; what crosses into `src/utils/events/` is the *result*, as two ordinary fields. So the
feed and the collector still answer "does this match?" with one pure function and `portable.test.ts`
has nothing new to police. `gemini-2.5-flash-lite` via `@google/genai`.

**It is never asked about a newsroom item**, and that is the one exception in the corpus.
`needsClassifying` returns false for anything tagged `newsroom`, because those rows have their own
model pass — the reader below, asking the only question anyone acts on there — and they arrive
already placed by the page (`Warszawa`, `PL`). What it cost to ask anyway was two model calls per
article and a second verdict to keep in step with the first; what it costs not to is that these
rows carry no `kind` at all — the Sources tab counts them under the newsroom reader rather than the
classifier, which is what they are. Nothing is filtered out by it: unclassified passes both
`passesKind` and `passesPlaces`, deliberately.

**Nor about the running listings**, the second exception, and a per-source one: the catalogue entry
for `elektroniczne-zapisy` says `unclassified: true`, and `skipsClassifier` is how all three readers
see it — `needsClassifying` never queues those rows, `mergeRecord` stops carrying their old verdicts
forward (set undefined, so the next upsert deletes them), and `modelPasses` leaves the classifier
block off that source's card. Every row there is a race, its town is in the row and `PL` is stamped
by the page, so the pass answered nothing but `reach` — for the longest source in the feed, at a
model call per row. Another source opts out with the same one line.

**There is no API key.** Vertex AI on Application Default Credentials, which in this runtime is the
function's own service account — the code already runs inside the project the model is billed to, so
a credential to prove that would be one to store, rotate and leak. It also keeps the classifier off
the deploy path: a secret named in a function's `secrets` array must exist before the CLI will deploy
anything at all, and the commit that first added this feature failed CI on precisely that. No key is
not the same as no permission, though: the function has an identity, and whether that identity may
call Vertex AI is a second fact and whether the API is on for the project a third — deploying ships
code and grants nothing. Both may already hold (the default compute account has historically carried
`roles/editor`), so the order is **check `eventSources/classifier` on the Alerts tab first**, and
only then the two `gcloud` commands the README spells out. They are **deliberately not run from
CI**, though they could be: that needs `projectIamAdmin` on the deploy identity, which is the right
to grant itself anything, a permanent widening of the pipeline bought to save a command run once. A project the classifier
cannot reach is a configuration state, not a failure; a role it was never granted is a red
`eventSources/classifier` row, and the feed goes on working either way.

Four things about it are load-bearing:

- **The reply is keyed by the id the model echoes back, never by position.** A reply one element
  short would file every verdict after the gap against the wrong event, silently, producing a corpus
  of confident wrong countries with nothing anywhere to say so.
- **`classifyHash` is a digest of only the fields the prompt shows.** Over the whole record it would
  include `updatedAt`, which moves every run — so nothing would ever match its stored hash and the
  entire corpus would be re-labelled every six hours. It is written even for a partial verdict, or an
  event the model has no country for goes back in the queue for the rest of its life. `sourceName`
  is in both the prompt and the hash: it is most of the answer to whether a row is an event or an
  article about one, since a theatre publishes nights and an organiser's blog publishes prose.
- **`mergeRecord` carries the classification fields forward.** `batch.set` replaces the whole
  document and `stripUndefined` drops absent fields, so a field no source has heard of is *deleted*
  on the next upsert unless it is named there. Same reason `firstSeenAt` is named there.
- **`CLASSIFIER_VERSION` is the only lever for re-labelling**, bumped in the code when the prompt
  changes. There is deliberately no button: "the prompt changed" is a fact about a build, and a
  re-run nobody can date afterwards is worse than no re-run. It is at **2**, bumped when `kind`
  joined the prompt — so the whole corpus re-labels over the few runs after that deploy, at 400 an
  hour. Nothing is filtered on the result, so a corpus mid-relabel costs chips on cards rather than
  rows in the feed, which is a good deal less pressing than it was when the bump shipped.

The order in `runCollection` is `fetch → upsert → read → classify → notify` (the `read` step is the
newsroom reader, one section down). It used to be the point rather than an implementation detail:
`notifyAccount` decided pushes with the same `matchReason`, an unclassified event passed the places
rule, and notifying first would have pushed about exactly the national conferences the filter
existed to stop pushing about. With the filter gone what the order buys is smaller and still worth
keeping — the card behind a notification can say where the event is by the time the tap arrives,
and the classifier is the expensive step either way. It also made `upsertEvents` return the **merged**
records, which the notifier now receives instead of freshly built ones — so `firstSeenAt` is the
real one (`announced` no longer fires every run for every match, held back only by the notice latch)
and `onSaleSeenAt` is visible to the planner for the first time, which is what `onsale` always
needed to work at all.

`eventSources/classifier` carries its health beside the scrapes, but **not** through `recordHealth`:
that reads "nothing after previously returning something" as a failure, which for a classifier is
the normal steady state — once the corpus is labelled there is nothing to do, and a green row has to
be able to say so.

#### A second model pass reads the newsroom

`functions/src/readNewsroom.ts`. The classifier above answers three questions about every row in
the corpus; this answers a fourth about the dozen rows a source tagged `newsroom`, and it is
deliberately **not** a field in that same prompt.

The reason it exists at all is that `parseSaleAnnouncement` — the regex that reads "Sprzedaż
biletów od 1 września, g. 11.00" out of a teaser — will go on working right up until the press
office writes "sprzedaż rusza w poniedziałek", or "bilety dostępne od 1.09", or the same thing in
English. At that point the scrape is still green, the news list still yields ten rows, and the app
silently stops warning about the one thing it was built to warn about. A model reads the sentence
however it is phrased.

**Two things come back, and it used to be four.** `isTicketSale`, a boolean, and `saleOpensAt`,
which becomes `EventRecord.onSaleAt` for `presale` to count down to. That is the pass.

It answered a five-way `newsroomKind` as well (`ticket-sale` / `programme` / `practical` /
`institutional` / `other`), plus a `newsroomEventAt` and an English `summary`, and all three are
gone at `READER_VERSION` **3**. Four of the five kinds were only ever *read* — nothing counted
down to them, nothing filtered on them, and their whole effect was a chip on a card and a row of
filter buttons over one theatre's news list. A taxonomy is also a materially harder question
than a boolean, which is the second reason: the point of this pass is the one fact on that page
with a deadline, and everything else it was asked was competing for the same judgement.

What that costs, stated plainly because it was a deliberate loss and not an oversight: an article
about a festival held in July is undated again, so it sits under *announced, no dates yet* until it
scrolls off the news list, where `newsroomEventAt` used to expire it. See *An article had no date
at all* below — `publishedAt`, the half of that fix that needs no model, is untouched and still
does most of the work.

**The measurement, because a prompt change is otherwise a matter of opinion.** Against fifty real
articles off this page — a year's worth, fetched with their bodies — the two that announce a sale
come back with the right day and hour, and none of the other forty-eight is claimed. The near
misses are the ones worth naming, since each carries a date and the word *bilet*: a parking
discount running "od 12 czerwca", an apology for a sale that had already opened, a tour whose
ticket details were "podamy wkrótce", and two education programmes whose tickets were already on
sale. They are enumerated in the prompt as false cases for exactly that reason.

Kept apart from `classify.ts` on three axes, and it is worth keeping them straight before anybody
merges the two prompts to save a call:

- **Scope** — 1,150 rows against a dozen, and since Sep 2026 the two sets are disjoint: the
  classifier skips `newsroom` rows outright (`needsClassifying`) and this pass reads nothing else.
  One prompt asks every concert in Poland whether it is a job advert. (`kind` is in the big prompt
  precisely because it *is* a corpus-wide question; this one is not.)
- **Version** — `CLASSIFIER_VERSION` re-labels the whole corpus. `READER_VERSION` is its own lever
  over its own hash, so tuning the sale-date wording costs ten calls rather than eleven hundred.
- **Blast radius** — a wrong `reach` costs a card in the feed. A wrong sale date is a notification
  on the wrong morning.

#### It was reading the teaser, and the date is in the body

This pass shipped being shown the news list's own row — a title and a one-line teaser — and that is
where it was failing, silently, at the one job it has. **The 2026/27 season's sale date was never
seen by this app.** It was announced on 15 April 2026 in an item titled *Wkrótce ogłoszenie nowego
sezonu!*, whose teaser reads "Niebawem ogłosimy długo wyczekiwany sezon artystyczny 2026/27" and
whose body reads "21 maja 2026, godz. 11:00 — Start sprzedaży biletów". The regex had no sentence
to match, the model had no sentence to read, the news list went on returning ten healthy rows, and
the season opened unannounced.

So `articleText` (in `sources/html.ts`) fetches the page behind the row, narrowed to its one
`<article>` element — the whole document would be a thousand words of identical chrome around the
needle. Block tags become newlines first, which is not cosmetic: the theatre writes its schedules
as table cells, and flattened without breaks `godz. 11:00Start sprzedaży biletów` joins two facts
that were never adjacent.

It is fetched at **read** time, not at scrape time, which is what keeps it nearly free — an article
is read once, when `newsroomHashOf` says the list row is new or changed, so the steady state is one
fetch per new article rather than ten per run. A page that will not load returns `''` and the
reading falls back to the teaser, which is what it always had.

`ReadOutcome.fetched` counts the bodies, and it is a health signal rather than bookkeeping: a fetch
that quietly stops working degrades this pass to exactly the teaser-only reading described above —
same green health, same ten rows, no date. The live smoke test asserts `fetched === read`.

**The article is untrusted text handed to a model whose answer schedules a notification**, which is
a shape nothing else in this app has — and fetching the body widens what a stranger's CMS can put
in front of it. So: the verdict is a boolean, and a `saleOpensAt` is stored **only when the verdict
was `true`, it parses to a real calendar day, it lands in the future, and it lands inside two
years**. A past date is refused rather than kept-and-ignored, because a past `onSaleAt` counts as
tickets being on sale and would mint an "On sale now" push about a shut box office. The worst a
prompt buried in an article can win is a `ticket-sale` tag on its own row and a date inside the
next two years, on a feed one person reads.

Five mechanics are load-bearing:

- **`newsroomHashOf` deliberately does not read tags**, where `classifyHashOf` does and must.
  The reader *writes* a tag, so a tag-reading hash would differ from the one just stored the
  instant a verdict landed, and every article would be re-read on every run for ever.
- **It deliberately does not read the body either**, and that one is a trade rather than a rule.
  Hashing the body means fetching every article every run to find out none of them moved — ten
  requests an hour to someone else's server to learn nothing. The list row is the theatre's own
  summary of its article, so an edit worth re-reading almost always shows in the title or teaser;
  what is given up is a silent edit adding a sale date to a body while leaving the teaser alone.
  `READER_VERSION` is the lever if that proves wrong.
- **The reader runs before the classifier**, not after. It writes a tag and `classifyHashOf` reads
  tags, so the other order re-labels every article it touched, once, for nothing. Both passes see
  the finished tag list in one run. The order is now `fetch → upsert → read → classify → notify`.
- **`mergeRecord` carries `onSaleAt` forward**, which it did not before and which would have lost
  the entire feature. `raw.onSaleAt` is undefined for an article the regex could not phrase-match,
  `stripUndefined` drops it, and the date the reader learnt would be deleted on the next run — six
  hours later, silently, with the notice never fired. Same list, same argument, as `firstSeenAt`
  and the classifier's fields.
- **`tagsWithTicketSale` derives the tag at merge time**, rather than the reader appending to
  `tags` and hoping. `batch.set` rewrites `tags` wholesale from what the source said, and the
  source has not heard of a date the reader found; deriving the union in one place is what stops
  the reader racing the upsert and what makes a re-read idempotent.

  **It is keyed on the date, not on the boolean.** `ticket-sale` is what `presale` counts down to,
  so it has to mean *there is a deadline on this row* — a `true` whose date the guards refused is a
  card with nothing to count down to. Both writers stamp it: the adapter's regex where it fired,
  the reader where it did not, and which pass established the deadline is not something anything
  downstream should have to know.

**The regex is kept and wins where it fires.** It read the theatre's literal sentence with a tested
regex, and a model is not asked to second-guess a stated fact — the same rule as `country`. It is
also what keeps the sale reminder working on a project the model cannot reach, which is a
configuration state this app treats as ordinary.

`mergeRecord`'s `hasTickets` had to change with this, and the old reading was wrong in a way that
only this feature could expose: it was `onSaleAt !== undefined`, which was right only while every
`onSaleAt` came from Ticketmaster and was months past. **On sale means purchasable now**, so a
future date does not count — otherwise learning that a season opens in three weeks would fire
`onsale` immediately and consume the latch `presale` needed.

#### An article had no date at all, and the feed was reading that as freshness

The screenshot: **OGRODY MUZYCZNE 2026**, a festival at the Royal Castle courtyard, published by
the theatre on 6 July, met by the collector in September, and shown as a new `programme` under
*announced, no dates yet* — captioned *Announced 2 d ago*. Every field on that card was correct.
The row simply had no date anywhere on it, and two months of staleness had nowhere to show.

Two halves, and only one of them needs a model.

**`EventRecord.publishedAt`, which both sources were already reading and throwing away.** The news
list states it in `<time datetime="2026-07-06">` — the adapter parsed it, used it to resolve the
year the sale sentence omits, and dropped it. Every RSS item carries `pubDate` (or `published`,
`updated`, `dc:date`) and the same was true there. So the only date the card could print was
`firstSeenAt`, which is **when this app arrived**, not when the news broke: a news list holds ten
items and a feed twenty, so the first run that reaches one is reading a back catalogue, and every
row in it shares a `firstSeenAt` to the millisecond. Three consequences, all now fixed by a fact
the source states outright:

- the card prints `Published 61 d ago` where it used to print `Announced 2 d ago` (`relativeTime`
  stops at days, which for this is precise rather than coarse);
- `announcedAt` orders the undated group by it, so the group is ordered by something at all;
- the reader's prompt carries it per row, which is a **better anchor than `today`** for a yearless
  "6 lipca" — resolving that against September rolls a July festival into next year, which is the
  same failure one layer along.

It is emphatically **not `startsAt`**, and that is the rule the RSS adapter is built on: an article
is not an event happening on the day it was written. It is also **not read by `isFresh`** — an
article discovered late is still news to a reader who has never seen it, and gating `announced` on
publication age is a notification rule, not a display one. `mergeRecord` names it with `country`'s
shape: incoming wins, stored fills in, so a row that scrolls off page one keeps its date.

**`EventRecord.newsroomEventAt` was the other half, and it has since been removed.** The date of
the thing being written about is in the prose, and a model read it into a field of its own that
`actionableAt` grouped, sorted and expired by — so an article about a finished festival dropped out
of the feed the way a past concert does. It went when the reader was cut to its one question (see
*A second model pass reads the newsroom* above): nothing counted down to it, and it was one more
judgement competing with the sale date for the same call.

So an article whose event is over is undated again, and sits under *announced, no dates yet* until
it scrolls off the theatre's news list — which is at most ten items, so it is bounded. What did
**not** go is `publishedAt`, which is the half of this fix needing no model at all, and which does
most of the work: the card says `Published 61 d ago` rather than `Announced 2 d ago`, and the
undated group is ordered by something real.

#### A verdict has to be falsifiable from the outside

A geography filter was otherwise unprovable: a thing that stopped appearing and a thing that was
never announced look identical, which is the whole reason this half existed. **There is no filter
now, and the argument survives it in a weaker but still real form** — a card that says where an
event is can be argued with, where a card that says nothing leaves the classifier's whole output
unexaminable from the app.

**Where that proof lives moved twice.** The Feed originally carried three view states — `Matched` /
`Filtered out` / `Everything` — with the middle one listing events that satisfied everything an
interest asked about their *content* and were turned away only on `kind` or `places`, a country
tally under it and a `{classified} of {total} labelled` line beside that. It worked, and it put an
inspection tool on the screen that is read every day: three buttons, two filter rows and a city
picker above a list whose whole job is to be short. That moved to the Sources tab, per source; then
the interests went and `{kept} of {rows} reach your feed` went with them, leaving `n collected`
beside the switch and the model-coverage count per pass, which is the honest remainder — nothing
between a source's rows and the feed except the switch, so there is nothing left to report as kept.

What stayed on the card, because it is a fact about the row rather than an inspection:

- **The country-and-reach chip, on every card.** It used to say whether something was here because
  the filter judged it right or because it had not been judged at all. Nothing is judged now, so
  what it says is simply where the event is — and `?` / *not labelled yet* is still its own state,
  and is now the **only** place in the app where a stopped classifier is visible on a row. The
  per-source count in `extraction.ts` is the other half of that, and the aggregate one.
- **The kind chip, when the row is not a `listing`.** An article among the listings says it is one.
  There is deliberately no chip saying "yes, this is an event": a label on every card in the corpus
  that nobody reads twice.

A wrong verdict is now a wrong word on a card rather than a row that vanished, which is the quiet
dividend of nothing filtering on it: `CLASSIFIER_VERSION` is the lever, and there is no per-event
override — see the section below, which is about the last time somebody wanted one.

### Ignoring one event, and why there is no longer such a thing

There was an `Ignore` button on every card, a `users/{uid}/eventIgnores` collection reconciled by
`versioned.ts`, an `Ignored (n)` view to undo it from, and a read of that collection in
`loadAccount` so the collector obeyed it too. All of it went in Sep 2026, at the owner's request,
and the reasoning is worth recording because the feature was carefully built and the arguments for
it were sound. It was the first of three removals in a fortnight — this, the Pipeline tab, then the
interests — and they are the same decision three times: a per-reader control is worth less than it
costs on a list this short.

What it was for: the rules could turn away a **kind** of event (`excludeKeywords`) or a **place**
(`countries`), and neither could say *yes, this is exactly what I asked for, and I am not going to
that one*. What it cost: a second synced collection, a second push queue, a second hook mounted on
the Feed, a fourth view on the feed to undo from, a chip on a card in a view that existed to explain
it, and a required field on `PlanContext` that every future caller had to think about. For a feed
whose whole list is a screen or two, the cheaper answer to a row you are not going to is to read
past it — which is the answer to a whole *source's* worth of rows you are not going to, too, except
that there the switch is cheaper still.

Three things it left behind, each deliberate, and each one a rule the later removals kept:

- **`adoptOwner` still memoises its answer rather than its guard.** It was changed for the ignores —
  two hooks mounting on the Feed, whoever asks second reading `previous === uid` and keeping the
  previous account's rows over an emptied store — and the second caller is now `useEventSourcePrefs`,
  which mounts on the Feed and on the Sources tab. The case is live and the rule stands.
- **Data a removed feature wrote is not deleted.** Nothing reads `users/{uid}/eventIgnores`, the
  catch-all rule still covers it, and a migration that deletes user data to tidy a schema is a worse
  idea than a collection nobody opens. `users/{uid}/eventInterests` is left the same way, and so are
  the `events-interests` localStorage keys — a browser holding those simply holds two strings nobody
  reads, exactly as it does for `events-feed-city` and `events-feed-kinds`.
- **The push queue's `key` argument** was the one thing here that did *not* survive. It existed
  because two collections holding ids from different spaces (a `uuid()` and a
  `slugKey(fingerprint)`) sharing one queue is a write that never leaves the device under a Synced
  badge. The interests were the last collection a client wrote; the queue went with them, and
  `useEventSourcePrefs` writes one document with a merge rather than draining a queue at all. If a
  second client-written collection ever returns, that parameter is the lesson to re-read.

### The feed has no filters

The Feed toolbar held a city picker (`events-feed-city`), a row of `kind` toggles
(`events-feed-kinds`), the three view states above and an `Ignored` view. It holds a count and
nothing else, and `buildFeed` returns upcoming rows from enabled sources and nothing else: one
`FeedOptions` field (`sources`), no `FeedMode`, no `rejectedBy`, no `offSource`, no
`narrowSections`, no `cityOptions`, no `kindOptions`, and since the interests went no `FeedItem`
either — a section is an `EventRecord[]`, because there is no longer a "why is this here" to carry
beside each row.

**The reasoning is the one those controls were built on, followed one step further.** Each was
documented as "a view preference on one device, never a `FeedOptions` field, never anything
`PlanContext` hears about" — precisely because a filter that hides rows must never quietly stop a
notification. But a per-device narrowing that hides rows *is* a thing that decides, months later and
with nothing on the screen saying so, which concerts a reader sees; the empty-state hints, the
`withSelected` zero-count options and the "which narrowing emptied this" sentences were all paid to
keep that honest. And both durable forms already existed and already reached the collector:
`Interest.cities` for the city, `Interest.includeCoverage` for the kinds. The controls were a second
spelling of two interest fields, on the one screen that is read every day.

That last sentence is the one the interests' removal changed, and it should be said plainly rather
than explained away: **the durable forms those controls duplicated are gone too.** Narrowing to
Warszawa was a tap, then an edit to an interest, and is now neither — the whole national race
listing is in the feed or the source is off. Three tours of one show in three cities are three
cards. That is the trade the owner asked for, and the switch on the Sources tab is what it is
answered with.

`cityKey` and `CITY_ALIASES` went with it. They existed because the matcher's `cities` rule
compared two spellings — folding made `Kraków`, `KRAKOW` and `Krakow` one string, and only the
alias table joined `Warsaw` to `Warszawa`, Ticketmaster's English and Polish catalogues listing the
same hall under both. Nothing compares two city spellings now: each row states its town and the card
prints it. The rule the table was built on outlived it next door — **a wrong alias is worse than a
missing one** is what `lines.ts` keeps for Metro Watch's stations, where it is sharper still.

`events-feed-city`, `events-feed-kinds`, `events-interests` and `events-interests-unsynced` are all
gone from `EVENT_KEYS` and from `CACHED_PER_OWNER`; nothing migrates them, and a browser holding the
old keys simply has some strings nobody reads.

### The Pipeline tab is gone, and where its job went

`/apps/events/pipeline/` listed the **whole corpus** — interests ignored, past rows included — with
eight comboboxes over it and a row that opened into its own JSON, grouped by the pass that wrote
each field. It was removed in Sep 2026 at the owner's request ("not useful"), and what it was
genuinely for moved onto the Sources tab, per source. The interests followed a fortnight later; see
*The interests are gone* above, and note that the feed listing the whole corpus is now the feed's
ordinary state rather than a separate tab. `_redirects` 301s both locales' paths to
`/apps/events/sources/`, bare and slashed, because an installed app precached the route.

What went with it: `EventsPipeline.tsx`, `utils/events/pipeline.ts` (`FIELD_STAGES`, `stageBlocks`,
the facets, `businessOf`), `utils/jsonView.ts`, `useEventCorpus`, `pullAllEvents`, and about 90
translation keys in two locales.

**What it did that nothing else did, and what answers those questions now:**

- *"Has a model looked at these rows?"* — the `kind`/`reach`/`field` facets, corpus-wide. Now
  `extraction.ts`, per source and per pass, which is strictly better: the old coverage number was
  over everything, so a single scrape whose rows were the unlabelled ones looked exactly like a
  healthy corpus.
- *"What is my filter doing to them?"* — nothing did this, actually; the tab showed the corpus and
  the feed showed the survivors, and the join was done in the reader's head. `filtering.ts` did it
  per source for a fortnight, and then there was no filter to report on: the feed and the corpus
  are the same list, minus what is past and minus a switched-off source.
- *"What exactly is stored on this row, and which pass wrote it?"* — **this is the loss**, and it is
  a real one. There is no longer any way to read a fingerprint, a `classifyHash` or a
  `newsroomHash` from the app; that is the Firestore console again, which is what the tab was built
  to avoid. (`haystack` is not on that list any more: it went with the matcher that read it.) It is
  the price of the trade and it should be stated rather than explained away. If it
  comes back, it belongs behind a disclosure on a source's card — one row's JSON, reached from the
  source it came from — rather than as a fifth tab over a corpus.

Two things it taught that are still true elsewhere, and are written up where they now apply:

- **An empty selection means no constraint, never "matches nothing".** It came from the facets,
  where each axis was counted over what the *other* axes left; `match.ts` then stated it for a
  keyword-less interest, and that was the first test in `match.test.ts`. Both are gone and the rule
  is the one to re-read before writing any filter here again — reading empty as unsatisfiable makes
  a control silently dead, with nothing in the UI to say why.
- **Somebody else's text must reach the DOM as text.** `jsonView.ts` returned `{kind, text}` tokens
  rather than an HTML string for `dangerouslySetInnerHTML`, because every string in that panel was a
  scraped title or a sentence a model wrote about an article it was handed. Nothing in the app
  renders raw JSON today. If anything ever does, do it that way.

### Deploying it

`firestore.rules` gained `events/` and `eventSources/` — top-level collections are outside the
`users/{uid}` wildcard, so a feed that reads nothing usually means the rules have not gone out.

**Rules and functions deploy from CI** (`.github/workflows/firebase-deploy.yml`) — the site is
`node.js.yml`'s on every push, and the backend is this workflow's. A `terraform` job runs **before** the
deploy job in that workflow; see *The project layer* below. It is path-filtered to `functions/`,
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

The functions need the Blaze plan, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`TICKETMASTER_API_KEY` as secrets, and the public key **also** in `korczak-xyz/.env.production` as
`PUBLIC_VAPID_PUBLIC_KEY` — committed, because it is the half of the pair meant to be published and
the build needs it. The classifier needs no secret at all — see above.

The two copies must stay equal, and nothing checks that they do. `VAPID_PUBLIC_KEY` in Secret
Manager signs the pushes; `PUBLIC_VAPID_PUBLIC_KEY` in the bundle is what the browser subscribes
with. If they diverge, subscriptions are created against one key and pushed against another, and
every send fails with no error the user or the site can see.

A secret named in a function's `secrets` array **must exist for the deploy to succeed at all** — the
CLI stops with `In non-interactive mode but have no value for the secret …` — which is what the
Ticketmaster `none` sentinel was invented for, and which a `GEMINI_API_KEY` walked into on the very
commit that added the classifier. That is the argument for authenticating as the function rather
than with a key wherever the option exists: a secret is not only something to rotate, it is
something a deploy can fail on. Where one is genuinely needed, set it to `none` until there is a
real value; `secretReader` reads the sentinel back as undefined.
The VAPID public key can never change: rotating it invalidates every subscription on every device,
silently. Full sequence in `functions/README.md`.

### The project layer is Terraform, the app is the Firebase CLI

`terraform/` holds what the GCP project must have switched on and granted: the API list, the role
grants, the secret **containers**, `sendTestPush`'s public invoker binding, the `gcf-artifacts`
cleanup policy, the two Firestore backup schedules, and the nightly export. It exists because
two deploys in a row failed for reasons that were not in the code
— a secret container that did not exist stopped the CLI deploying anything, and whether the
classifier's identity could reach Vertex AI was a question you answered by running commands.

**The ownership line is the whole design, and nothing may cross it.** Terraform owns the project;
the Firebase CLI keeps owning the functions, `firestore.rules` and `firestore.indexes.json`. Two
owners of one resource is permanent drift, where every `apply` reverts the last `deploy` and back
again with neither tool wrong — which is why the functions are not in Terraform even though they
could be.

Five things there are load-bearing, each written up in `terraform/README.md`:

- **Secret values are not in Terraform.** State stores them in the clear, and `VAPID_PRIVATE_KEY` in
  a state file is worse than the problem being solved. Only containers — their *absence* is what
  broke the deploy. Adding a secret is a line in `secrets.tf` plus one
  `firebase functions:secrets:set`.
- **`google_project_iam_member`, never `_binding` or `_policy`.** Only `_member` is additive.
  `_binding` is authoritative for a whole role and `_policy` for the whole project: applying one
  drops every binding not written in the file, including the ones that let CI back in.
- **`disable_on_destroy = false` on every API**, or deleting a line — or a typo renaming a resource
  — disables that API and takes live functions down to fix a text file.
- **Backups are schedules, not the database.** `firestore.tf` declares a daily kept 7 days and a
  weekly kept 14 weeks — the API's maximums, and one of each kind is the per-database limit. The
  `google_firestore_database` resource is deliberately absent: reaching in for point-in-time
  recovery would make Terraform an owner of the thing every other tool reads and writes. So a
  restore is a *new* database with a day's granularity, never an in-place undo. What is really
  being protected is `users/{uid}/babySleep` — the events and transit collections rebuild
  themselves on the next collector run; the sleep log is typed in by hand and exists nowhere else.
- **A backup and an export are different features, and both are here.** The schedules in
  `firestore.tf` live inside Firestore and answer "undo our mistake". They are worth nothing if the
  Google account goes, since the database and its backups vanish together. `firestore-export.tf` is
  the other half: Cloud Scheduler calls `firestore:exportDocuments` directly — no function, it is
  one POST — into a 30-day bucket. `outputUriPrefix` is the bare bucket on purpose, because that is
  what makes the API name a fresh folder per run instead of overwriting one. An
  `objectViewer` account exists so the exports can be pulled back out; its key is minted by hand and
  never enters Terraform state. What does the pulling, and where it runs, is out of scope for this
  repo and intentionally not written down in it. **Since 10 Sep 2026 the reader account is out of
  scope too** — the one this file declared was removed with the puller that held it, and the
  account reading the bucket now was made by hand in the console. So an empty plan no longer means
  this bucket has exactly the grants Terraform writes down; it is the one place that is true.
- **The gate is "no plan may destroy anything"**, enforced in the workflow over the whole directory,
  plus `prevent_destroy` on the secrets, the registry and both backup schedules — deleting a backup
  schedule deletes the backups it made. This repo commits straight to `main`, so
  there is no pull request at which somebody reads the plan; that check is what stands in for it.
  The acceptance test after the first apply is an **empty plan** — a non-empty one means the files
  describe something other than the project, and `apply` would change it.

The one-time bootstrap (a state bucket and the roles the deploy account needs) cannot be automated
away: an account cannot grant itself what it lacks, and a GCS backend cannot create its own bucket.
Until it is run the terraform job logs a warning and skips, so the app deploys exactly as before.
Note the trade it carries, taken deliberately: the roles go on the **existing deploy account**, so a
pipeline firing on every push to `main` holds `projectIamAdmin` — the right to grant itself
anything. The narrower alternative, a separate `terraform@` account, is recorded in that README as
the way out rather than as what is done.

Push works only from an app installed to the Home Screen — not from a Safari tab, ever. That is what
the `needs-install` state on the Alerts tab exists to explain, and why it is checked before
permission: on iOS in a tab there is nothing useful to say about permission, and a button that
silently does nothing looks exactly like a bug in the app.
