---
name: events
description: Event Watch at /apps/events/ - the scraped corpus, the one matcher compiled into both browser and Cloud Function, web push, the classifier that says where an event is and whether it is one, and the Terraform project layer.
paths:
  - "**/utils/events/**"
  - "**/components/Events/**"
  - "**/hooks/useEventFeed.ts"
  - "**/hooks/useEventInterests.ts"
  - "**/hooks/useWebPush.ts"
  - "**/styles/events.css"
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

At `/apps/events/` — four tabs (Feed, Interests, Alerts, Sources) over a shared corpus of scraped
listings,
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

The `running` tag is the one place that rule is knowingly bent, and it is written down here so the
next person does not "fix" it. `RUNNING_LISTINGS` is a running-only listing, so the tag is exactly
what those pages are; the **Maraton Warszawski feed carries it too**, and that feed is a magazine —
so the keyword-less `Running in Warszawa` seed reaches its sponsor posts along with the route
announcements. Taken deliberately, for two reasons: a WordPress feed holds ten items, so this is a
card or two rather than the sixty-seven that made the Klezmer case a disaster; and an announcement
with no date yet — entries opening, next year's date fixed — is the earliest anything about a race
is knowable, which is what the app is for.

The card or two turned out to be four in a row — three sponsor posts and a set of pacer times, above
the race itself — and the answer was **not** to narrow the tag, because that would have cost the
announcements too. It is `EventRecord.kind`, below: the same call that says where an event is now
also says whether the row is one, and the tag goes on meaning what those pages are.

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
  (capped separately at 10, a budget it shares with `presale`): tickets going on sale is the thing
  that was asked for, and it is not noise.

`soon` uses **`max`** of the matching interests' `leadDays`, not min — leadDays means "how much
warning I want". One notice per kind per fingerprint, never one per interest: the interests are *why*
it fired, not *what* fired.

#### `presale`, and why `onsale` was never enough

`onsale` fires when a ticket link **appears**, which is a thing that can only be observed after it
has happened. For a Teatr Wielki season that is the wrong side of the event entirely: the sale opens
at 11.00 on one morning and the house is half sold by lunchtime, so a notification that arrives on
the next six-hourly run is a notification about seats somebody else has.

The date, though, is **known weeks ahead**. `presale` counts down to `EventRecord.onSaleAt` exactly
as `soon` counts down to `startsAt`, on the same `leadDays`. Four things about it:

- **`onSaleAt` must be in the future.** Nearly every Ticketmaster row carries the date its sale
  opened, usually months ago; without the guard the feature's first run is a hundred warnings about
  the past.
- **It is deliberately not gated on `isFresh`**, unlike `announced`. A date-based reminder is not
  an announcement. An interest added today has to be able to warn about a sale announced last week,
  which is the only reason anyone would add it.
- **Notices are ranked by `noticeAt`, not by `startsAt`.** A sale announcement is an article and has
  no `startsAt`, so sorting on that field alone files every one of them behind every dated notice in
  the run — and then the ticket budget keeps whatever the tail happened to hold instead of the sale
  that opens first.
- **It shares `maxOnSalePerRun` with `onsale`** rather than getting a budget of its own. They are one
  category of noise, and a source that starts stating sale dates across its whole catalogue must not
  walk past the cap by arriving under a second name.

`Interest.leadDays` now means two things at once — how long before the curtain, and how long before
the sale — and that is on purpose rather than an economy. Both answer "how much warning do I want
about this kind of thing", and a second field would have to be filled in on every interest by
somebody who has never wanted the two to differ.

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

It is derived in `toRecord` beside the haystack and the fingerprint rather than in the running
adapter, so a second source of races cannot get it subtly different — the Maraton Warszawski feed
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
**nothing derived**: the id, the haystack, the fingerprint and the day are computed by `upsert.ts`,
so a new adapter cannot get normalisation subtly different.

- **teatrwielki.pl** is the first bespoke scrape, and the source the app was really asked for. Note
  `/kalendarium/` is useless — a TYPO3 shell whose calendar is drawn by JavaScript, containing
  `data-day` attributes and no events. The **season page** (`/repertuar/sezon-2026/27/`) is plain
  server-rendered markup carrying title, genre, composer, premiere date and a stable slug. Titles
  contain inner tags (`<h2>COPP<span>É</span>LIA</h2>`), so they must be stripped. Individual
  performance nights stay behind the JS calendar; that is an accepted gap, since the question is
  whether Figaro is programmed, not which Tuesday. A **committed HTML fixture** is what turns the
  inevitable redesign into a red build rather than a silently empty feed.

  The **news list** (`/teatr/aktualnosci/`) is fetched beside it, and it is the only page in this
  app that answers a question with a deadline: *when does the sale open*. The theatre states it in
  prose — "Sprzedaż biletów od 1 września, g. 11.00" — a fortnight or more ahead, and
  `parseSaleAnnouncement` reads that sentence into `onSaleAt` so `presale` can count down to it.
  Four things about that read:

  - **There is no year in the sentence.** `parsePolishDate` requires one and rightly refuses to
    guess; here the guess has to be made, and the article's own `datetime` attribute is what makes
    it safe — a sale is announced before it opens, so the answer is the next occurrence of that
    day and month at or after publication. That rolls a December announcement of a January sale
    into the next year without a special case.
  - **The sale wording is required, and the date must follow it.** The same list carries "Od 12
    czerwca 2026 roku nasi Widzowie mogą korzystać z 30% zniżki na parking" — a date after "od",
    about a car park. A reader that took any such date would put that on the calendar as a ticket
    sale.
  - **Every row is kept, not only the ones announcing a sale.** `eventSources` reads zero as a
    failure only where there used to be something, so a page that legitimately yields nothing for
    months could not be told apart from one whose wording moved. Ten articles a run is a health
    signal that stays honest.
  - **`ticket-sale` is applied per row and never stamped on the page**, and only where a date was
    actually parsed. That tag is the whole of the keyword-less `Ticket sales opening` seed, and a
    keyword-less interest has no second filter — page-wide it would hand that interest the
    theatre's job adverts. Fourth direction, same mistake; see the tag rule above.

  The row's `<time datetime>` is now **kept** as `publishedAt` as well as being read for the sale's
  missing year — see *An article had no date at all* below for why a card that could only say
  `Announced 2 d ago` made two-month-old news the freshest thing on the screen.

  `startsAt` stays null on those rows, sale or not: a news item is an article, which is the rule the
  RSS adapter is built on. `feed.ts`'s `actionableAt` is what stops that filing the one row with a
  deadline under *announced, no dates yet* — it reads `startsAt` where there is one and `onSaleAt`
  otherwise, so the announcement is grouped, sorted and expired by the morning it is about. Nothing
  else in the feed moves, `onSaleAt` being set only where a source stated it in advance.
- **python.org** is an iCal feed — 874 VEVENTs, mostly historical, so `collect.ts` drops anything
  already past. Geography is deliberately *not* filtered there: PyCon US may still be worth knowing
  about, and deciding that is the interest's job. RFC 5545 line unfolding is the one parsing bug
  worth naming: miss it and every long `SUMMARY` truncates at 75 octets, which looks like the feed
  having short titles.
- **RSS feeds** leave `startsAt` null on purpose. A feed item is an *article*: putting its `pubDate`
  in `startsAt` would file every post as happening today and then let `soon` fire about it. The
  `pubDate` is kept as `publishedAt`, which is a different field answering a different question —
  how old is this news, not when is the event.
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
  would have halved the rows. Geography is the interest's job, as it is for python.org: a Warsaw
  baked into the *fetch* is one reader's preference written into a corpus every account shares, and
  the day the question becomes Kraków there is nothing stored to answer it with. So the collector
  takes the national listing, every row says its own town, and `Interest.cities` and the feed's city
  picker decide what is Warsaw — through `cityKey`, so `Warsaw` and `Warszawa` are the same ask.

- **Ticketmaster** can never produce an `onsale` transition — its listing *is* its ticket page. That
  is correct, not a gap. No API key is a configuration state, not a failure, so it returns `[]`.

`eventSources/{id}` records health, and **zero is a failure only when the source used to return
something**. Without that table the theatre could redesign, the scrape return `[]`, and the app go on
looking perfectly healthy while never announcing another opera — the most likely way this fails and
the least likely way anyone notices.

`functions/src/smoke.live.test.ts` runs every adapter against the real network under `LIVE=1`
(skipped otherwise, so CI and an offline laptop are unaffected). It is what caught both the haystack
bug and the opera over-tagging; run it after touching an adapter.

### The Sources tab, and why the URLs had to move

The feed answers what is on. `/apps/events/sources/` answers *and how would I know if that were
wrong* — every page the collector requests, as a link, so the claim is checkable rather than stated.
The Alerts tab's health table already named sources; it never said what a source **is**, and a
`teatr-wielki` row reading `ok, 64 events` tells you nothing about which pages produced them.

**The catalogue is in `src/utils/events/sources.ts`, not beside the adapters.** That is this app's
one-matcher-two-runtimes argument reaching a second fact: the browser cannot import a Cloud
Function, so a list of URLs next to the scrapers would have had a copy in the island, correct until
the first time a feed moved. So the adapters now *import* their targets — `FEEDS` drives the RSS
adapter, `RUNNING_LISTINGS` the entry-platform scrape, `seasonPaths` the theatre one, and
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

Three facts per card, and they are three different questions:

- **The pages**, from the catalogue. Static: no network, no pull, no collector run, so the tab says
  something useful offline and on an account whose first collection has not happened. Each carries
  what that *page* stamps on everything it yields — its tags, its city, its country. That is on the
  screen because a keyword-less interest has no second filter, so a blanket tag **is** the whole of
  what reaches it, and this app has made that mistake from three directions (the Jewish Culture
  Festival's feed, `tagsFor`'s fallthrough, Ticketmaster's `classical`). Being able to read a
  source's blanket tags off the page they come from is what makes the fourth one catchable.
- **Health**, from `eventSources`. Three states and not two: never run is not ran-and-found-nothing,
  and only one of them is a reason to go and look at the page.
- **How much of the corpus is its.** A source can be green, be read, and be contributing nothing you
  would miss — which is not a failure, does not belong in the health table, and is what you look at
  before deciding a scrape is worth its fixture. Drawn as a chip rather than more grey text after a
  separator: spaced apart the two statuses read as one run-on sentence, and a `·` between them
  orphans onto the second line at 320px, where it reads as a bullet.

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
two of the three columns would be empty and one tab behaving unlike the other three is worse than
the consistency is worth. No PWA work was needed: `APP_TIERS['events']` already claims the whole
subtree, so the tab precached itself.

### Where an event is, who it is for, and whether it is one

The feed's first real complaint was four PyCons — Cameroon, Africa, Greece, NL — none of them
attendable, all of them matched by `python`/`pycon`. The app had **no axis for where** at all beyond
`Interest.cities`, which is any-of over free text: saying "in Poland" would have meant listing every
Polish city, against a `cityOf` that guesses at the second-from-last comma-separated field.

A country whitelist alone does not answer it either, and that is the whole shape of this feature.
The question is not *which country* but **does this pull people in from outside** — PyCon US and
EuroPython are to be kept and PyCon NL dropped, and nothing in a listing distinguishes them. They can
be in the same country in the same year. So two fields, and only one of them is scrapable:

- `EventRecord.country` — ISO-2, or `ONLINE`. Supplied by the adapter **where the source knows it
  for free** (`teatr-wielki` is in Warsaw, `ticketmaster` is queried `countryCode=PL`, each `FEEDS`
  entry is a Polish publication), and by the classifier otherwise. One field, never two derivations:
  the string-splitting heuristic that `cityOf` is was deliberately not written a second time.
- `EventRecord.reach` — `local` / `national` / `international`. A judgement, and the one thing here a
  language model decides.

`src/utils/events/countries.ts` normalises both sides to codes, and it is load-bearing rather than
tidy: the matcher compares `Interest.countries` against `EventRecord.country`, so a stored `Polska`
would be a filter that never fires with an empty feed as its only symptom. `newInterest` is the one
choke point, the way `sanitizeSettings` is for the chord cards.

#### One rule with two ways to pass, not two constraints

`Interest.countries` and `Interest.internationalAnywhere` are read together, joined by **OR**:

```
countries empty                                    → no constraint
country ∈ countries                                → passes
internationalAnywhere && reach === 'international' → passes
```

AND-ed the way `tags` and `cities` are, it would read "in Poland *and* international", which keeps
nothing. "Conferences in Poland, plus the ones worth flying to" is one thought, and the checkbox
sits inside the countries field for that reason rather than beside it.

**An unclassified event passes**, per axis. It follows the undated-event rule directly above it in
`matchReason` — not excluded, simply no answer yet — and it decides which way this fails when the
model is down: the noise comes back visibly rather than the feed quietly emptying, and a silently
empty feed is the one outcome here indistinguishable from everything working. Per axis because a
record can know where it is and not yet who it is for: every scraped Polish row is `PL` from the
moment it lands, with `reach` arriving later.

#### And whether it is an event at all

The second complaint had the same shape and a different axis. The running interest surfaced three
sponsor posts and a set of pacer times about the 48th Warsaw Marathon — *"Marki DIP Hot i DIP Rilif
Partnerem 48. Maratonu Warszawskiego!"* — four cards, above the one row that is the race. They are
not near misses: every one of them is genuinely about running, genuinely in Warszawa, and genuinely
matched. They are simply **articles rather than events**, which is the trade the RSS adapter names
in its own header and had until now paid in full.

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

`Interest.includeCoverage` is the opt-in, and it is off by default: this is the one filter here
that runs without being asked for. Nobody sets up an event watcher wanting press releases, where
"conferences in Poland" is a preference someone has to state. The interest that *does* want them —
"everything the Maraton Warszawski blog says" — is the unusual one, and the checkbox is how it is
said. `announcement` is never touched by it either way.

The rule sits **before** `places` in `matchReason`, because a reason is the first thing wrong and
"this is not an event" is the stronger statement. A sponsor post about a race in Cameroon fails
both; filed under geography it would be noise in the list that exists to check the country filter.

#### The classifier runs in exactly one place

`functions/src/classify.ts`, in the Cloud Function. The browser never calls a model and neither does
the matcher; what crosses into `src/utils/events/` is the *result*, as two ordinary fields. So the
feed and the collector still answer "does this match?" with one pure function and `portable.test.ts`
has nothing new to police. `gemini-2.5-flash-lite` via `@google/genai`.

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
  hour, and until it has, every article in the feed is unclassified and therefore still showing.

The order in `runCollection` is `fetch → upsert → read → classify → notify` (the `read` step is the
newsroom reader, one section down), and it is the point rather
than an implementation detail: `notifyAccount` decides pushes with the same `matchReason`, an
unclassified event passes the places rule, so notifying first would push about exactly the national
conferences this exists to stop pushing about. It also made `upsertEvents` return the **merged**
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

Four things come back per article, and each has a job:

- **`saleOpensAt`** → `EventRecord.onSaleAt`, which `presale` counts down to. The point of the
  whole pass.
- **`newsroomKind`** → one of five (`newsroom.ts`), which becomes a **tag**. That is the whole of
  "trigger on it": an interest asking for `ticket-sale` is an ordinary interest, and no new
  matching mechanism was needed.

  **Not to be confused with `EventRecord.kind`** one section above, which the classifier sets and
  which is a genuinely different question. `kind` asks *does this row belong in an event feed at
  all* — listing, announcement, or coverage — over the whole corpus. `newsroomKind` asks *what does
  this news item say* — a sale, the programme, visiting, the institution — over the theatre's own
  news. A ticket-sale item is `announcement` on the first axis and `ticket-sale` on the second;
  both are true and neither implies the other. They compose usefully: the theatre's job adverts and
  obituaries are `coverage`, so the default `includeCoverage: false` keeps them out of the feed
  before the newsroom tag ever matters, and what is left for the `Ticket sales opening` seed to
  reach is the handful of items that actually announce something.
- **`newsroomEventAt`** → when the thing the article is *about* happens, which is the one date an
  article cannot have of its own. See *An article had no date at all* below; it is why
  `READER_VERSION` is at **2**.
- **`summary`** → one English line, printed on the card. The counterpart of `reachReason`: the
  verdict beside it is a single word, and without the sentence there is no telling a correct
  reading from a confident wrong one — on rows whose title and teaser are Polish, it is also the
  only thing on the card the reader can check the verdict against.

Kept apart from `classify.ts` on three axes, and it is worth keeping them straight before anybody
merges the two prompts to save a call:

- **Scope** — 1,150 rows against a dozen. One prompt asks every concert in Poland whether it is a
  job advert. (`kind` is in the big prompt precisely because it *is* a corpus-wide question; this
  one is not.)
- **Version** — `CLASSIFIER_VERSION` re-labels the whole corpus. `READER_VERSION` is its own lever
  over its own hash, so tuning the sale-date wording costs ten calls rather than eleven hundred.
- **Blast radius** — a wrong `reach` costs a card in the feed. A wrong sale date is a notification
  on the wrong morning.

**The article is untrusted text handed to a model whose answer schedules a notification**, which is
a shape nothing else in this app has. So: the kind is a closed enum, and a `saleOpensAt` is stored
**only when it parses to a real calendar day, lands in the future, and lands inside two years**. A
past date is refused rather than kept-and-ignored, because a past `onSaleAt` counts as tickets
being on sale and would mint an "On sale now" push about a shut box office.

Four mechanics are load-bearing:

- **`newsroomHashOf` deliberately does not read tags**, where `classifyHashOf` does and must.
  The reader *writes* a tag, so a tag-reading hash would differ from the one just stored the
  instant a verdict landed, and every article would be re-read on every run for ever.
- **The reader runs before the classifier**, not after. It writes a tag and `classifyHashOf` reads
  tags, so the other order re-labels every article it touched, once, for nothing. Both passes see
  the finished tag list in one run. The order is now `fetch → upsert → read → classify → notify`.
- **`mergeRecord` carries `onSaleAt` forward**, which it did not before and which would have lost
  the entire feature. `raw.onSaleAt` is undefined for an article the regex could not phrase-match,
  `stripUndefined` drops it, and the date the reader learnt would be deleted on the next run — six
  hours later, silently, with the notice never fired. Same list, same argument, as `firstSeenAt`
  and the classifier's fields.
- **`tagsWithNewsroomKind` derives the kind's tag at merge time** from the stored kind, rather than
  the reader appending to `tags` and hoping. `batch.set` rewrites `tags` wholesale from what the
  source said, and the source has never heard of `programme`; deriving the union in one place is
  what stops the reader racing the upsert and what makes a re-read idempotent.

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

**`EventRecord.newsroomEventAt`, which no source can supply.** The date of the thing being written
about is in the prose, in Polish, in whatever phrasing the press office chose — exactly what this
pass exists to read. `actionableAt` now reads `startsAt → onSaleAt → newsroomEventAt` (the sale
stays ahead of it: it is the one you can be *late* for), so the feed groups, sorts and **expires**
by it, and an article about a festival that is over drops out the way a past concert does. The
card's date slot prints it in place of the em dash, with the year and no clock.

Three things about it are load-bearing, and the first is the one to argue with:

- **The window is two-sided, and the past is the point.** `saleOpensAt` is refused unless it is in
  the future; a past event date is the answer being asked for. What is left of the guard is ±2
  years, which catches the one failure a model resolving a yearless date actually has — the
  misread year — and nothing subtler. It can afford that because **nothing counts down to it**:
  `noticesFor` reads `startsAt` and `onSaleAt`, so a wrong reading costs a card in the wrong week
  and never a notification on the wrong morning. That is the same trade `reach` makes.
- **Its own field, never `startsAt`.** A reading and a stated fact are kept apart everywhere else
  here (`reach` beside `country`, `newsroomKind` beside `tags`), and `startsAt` is what wakes
  somebody up. Writing a model's date there would hand the notifier a number no test can bound.
- **`mergeRecord` carries it forward**, for the `onSaleAt` reason exactly: no source has heard of
  it, `stripUndefined` drops what is absent, and unnamed it would be deleted six hours after being
  learnt — putting the row straight back under *announced, no dates yet*.

The expiry is worth stating plainly, because it is a model's verdict removing a card: a wrong past
date hides a real announcement, and this app's usual answer to that is the rejected view. It is
accepted here on the precedent already set — `onSaleAt` can itself be model-written and has expired
rows on the day it names since the reader shipped — and because the alternative is worse: a row
kept but sorted by a date nobody trusts is the noise the whole `kind` axis was added to remove.

#### The filter has to be falsifiable from the outside

A geography filter is otherwise unprovable: a thing that stopped appearing and a thing that was
never announced look identical, which is the whole reason this half exists. So the Feed's one
`Show everything` link became three states — `Matched` / `Filtered out` / `Everything` — where the
middle one lists events that satisfied everything an interest asked about their *content* and were
turned away only on `kind` or `places` — the two rules a model decides, and the two that therefore
need a list.

Each row records **which** of the two did it (`FeedItem.rejectedFor`), because the classifier writes
a sentence about each and they are not interchangeable: printing the geography reasoning under a row
removed for being a press release would look like the wrong filter had fired. The tallies split on
the same field for the same reason.

**It is built from the same call the real filter makes.** `matchesInterest` is now
`matchReason(...) === null`, `matchReason` returning the first failing rule, and the rejected view
asks for `'places'`. A second near-miss matcher written beside it would be identical until the first
bug fix — the argument that compiles this whole directory into the Cloud Function rather than
copying it. A reason is *the first thing wrong*, which is what keeps the view readable: an event
that also fails the keywords is not a near miss on geography, and every concert in the country is
also "not a Python conference in Poland".

Three things are drawn, and they answer three different questions:

- **The country-and-reach chip is on every card in every view**, not only the rejected ones. Without
  it there is no telling whether something stayed because the filter judged it right or because it
  has not been judged at all — and `?` / *not labelled yet* is its own state for exactly that.
- **The tally** over the place-rejected rows says what shape the removal has. Four countries once
  each reads very differently from forty rows filed under one, which is a classifier getting a
  country wrong at scale. The kind-rejected rows get a plain count beside it rather than a
  breakdown: only one of the three kinds is ever removed, so there is nothing to break down — but
  it is a separate line, because folded into the country tally a press release would read as a
  country getting it wrong.
- **The coverage line** (`{classified} of {total} labelled`) is the half the rejected list
  structurally *cannot* show: an unclassified event passes both rules, so it is never in that list,
  and a classifier that has quietly stopped looks exactly like a filter with nothing to remove. It
  counts `classifiedAt`, not `reach` — the call answers three questions and may come back with two
  of them, and counting one field would report a working classifier as half stopped every time the
  model declined to guess a country.

The model's own sentence (`reachReason`, or `kindReason` for a row the kind rule took) is printed
under each rejected card, so a verdict can be argued with rather than only obeyed. The kind also
gets a **chip on the card in every view**, but only when it is not `listing`: an article an interest
kept because it asked for articles and one nobody has judged yet are different rows, and this is
what tells them apart. There is deliberately no chip saying "yes, this is an event" — that is a
label on every card in the corpus that nobody would read twice, and the unjudged case is already on
screen as the place chip's `?`. A wrong *rejection* is still corrected with a second interest
naming the event — there is no per-event way to force something back in, and the geography verdict
itself is not editable. A wrong *admission* now has two answers: the `excludeKeywords` that already
existed, and the Ignore button below.

### Ignoring one event

The rules above turn away a **kind** of event (`excludeKeywords`) or a **place** (`countries`).
Neither can say *yes, this is exactly what I asked for, and I am not going to that one*. A keyword
narrow enough to remove a single concert usually removes the next one by the same artist too, and
one exclusion per dismissal turns an interest into a blocklist nobody can read a month later. So
`Ignore` on a feed card is a per-event dismissal, stored as an `Ignore` row in
`users/{uid}/eventIgnores` and reconciled by `versioned.ts` like everything else here.

Four things about it are load-bearing:

- **It is keyed on the fingerprint, not the event id.** Ticketmaster and the Teatr Wielki scrape
  both list the same night and `dedupeByFingerprint` already collapses them, so an id-keyed
  dismissal would come back the day the other copy won the dedupe — the ignore still stored, and
  pointing at a document nothing draws. Same key, same argument, as `noticeIdFor`.
- **It is applied in `buildFeed`, never in `matchReason`.** An ignored event *did* match; that is
  the whole content of the act. Folded into the matcher it would be indistinguishable from one no
  interest ever wanted, and there would be nothing left to build the `Ignored` view from — while
  `portable.test.ts`'s one-matcher guarantee would start covering a per-account fact the collector
  reads from a different collection.
- **`PlanContext.ignored` is required where `FeedOptions.ignored` is optional**, and the asymmetry
  is the point. A feed caller that forgets it shows a row that should be hidden — visible, one tap
  from fixed. The same omission in the collector is a notification at 7am about the concert you
  already said no to, which is the reading of "ignore" that gets a push app deleted. So a new
  caller with no list has to write `NO_IGNORES` out loud.
- **A skipped notice is not latched.** `noticesFor` returns before building anything, so an ignored
  event claims no notice document and un-ignoring restores its notifications. This is the one place
  the app prefers a possible extra send to a lost one, against the rule `notifyAccount` states —
  and only because the send needs a deliberate act by the person who would receive it. Latching
  would silently consume the `soon` reminder for an event brought back precisely because its date
  is wanted after all.

Un-ignoring is a **tombstone**, because not-ignored is the resting state. The id being derived,
re-ignoring necessarily meets its own tombstone — the case `versioned.ts` documents as having once
made a night unloggable for good, handled by its causal rule and by `commit` going through
`applyLocal`. `ignoreEvent` is one entry point for ignore *and* re-ignore for that reason: a caller
minting a fresh row at `rev: 0` would write it straight underneath the delete.

The `Ignored (n)` view is not a nicety. Hiding rows with no list of what is hidden is a filter you
cannot check and cannot undo, which is the argument the `Filtered out` view exists for one section
above; here it is stronger, because the Ignore button lives **on the card**, so the card has to
stay reachable or the dismissal is permanent. The button appears only once `n > 0` — you can only
reach one by pressing Ignore, which puts it on screen in the same render — and its count comes from
a second `buildFeed(..., { mode: 'ignored' })` rather than the length of the ignore list, because an
ignore outlives its event: a concert that has been and gone leaves its row behind forever, and
counting those would offer a view holding nothing. `Everything` still lists an ignored card and
marks it, or a row present there and absent from `Matched` reads as the matcher disagreeing with
itself.

`adoptOwner` changed for this, and the change is worth knowing: it now memoises its **answer**, not
just its guard. Whoever asks second reads `previous === uid`, having watched the first caller write
it, so a plain re-read tells them nothing happened — and they keep the previous account's rows in
memory over a store that has just been emptied. Returning `false` to all but the first was only
safe while there was exactly one caller, which stopped being true the moment the Feed mounted a
second hook. `CACHED_PER_OWNER` gains both ignore keys, and the two push queues are keyed
explicitly (`loadUnsynced(key)`): an interest id is a `uuid()` and an ignore id is
`slugKey(fingerprint)`, so one shared queue would have each hook look up the other's ids, find
nothing, and drop them as already-done — a write that never leaves the device, with a drained queue
and a Synced badge saying it did.

No `firestore.rules` change: `users/{uid}/eventIgnores` is under the `users/{uid}/{document=**}`
catch-all, like `eventInterests`.

The countries also join the interest row's rule summary (`@PL`, and `+international` for the OR
clause) — left off, an interest quietly dropping four conferences a week would look exactly like one
that constrains nothing, which is this feature's own failure mode reappearing one screen along.

`SEED_INTERESTS` is untouched: `withMissingSeeds` is keyed by id and never edits an existing row, so
an account's own `Python & dev` is set by hand in the editor, which is also the first real test of
the toggle.

`Running in Warszawa` is the seed that made a **third** interest shape worth naming, beside the
keyword one and the keyword-less-plus-tag one: `tags: ['running']` narrowed by `cities:
['Warszawa']`, where the place is the whole question. Keywords could not have done it — "Cross
Forteczny" and "Zabierz PIESia do Międzylesia" are both races and share no word with each other or
with `bieg` — and `countries` is the wrong axis for a listing that is national by design.

### Narrowing the feed to one city

The picker in the Feed toolbar, persisted in `events-feed-city`. Three tours of the same show in
Rzeszów, Warszawa and Gdańsk are three cards you cannot go to two of, and the interest that matched
them is right — so this is a **view preference on one device**, not a rule.

That is why `filterSectionsByCity` is a lens over the *output* of `buildFeed` rather than another
`FeedOptions` field, and why `PlanContext` never hears about it: a filter set once and persisted
would otherwise be silently deciding, months later, which concerts are allowed to wake you. The
durable form of "only Warszawa" already exists and the collector already reads it —
`Interest.cities` — and the empty-state hint says so rather than leaving the two to be confused.

Four things about it:

- **The key is `cityKey(city)`, the stored value is the spelling that was chosen.** One value,
  derived one way, so the label on the control and the key it filters with cannot drift — and a
  `Warsaw` stored by an older build still selects the option now labelled `Warszawa`. `cityKey` is
  `foldText` plus **`CITY_ALIASES`**, and the two halves are different problems: folding makes
  `Kraków`, `KRAKOW` and `Krakow` one string, but `Warsaw` and `Warszawa` are two words and no
  normaliser will ever join them. Ticketmaster's English and Polish catalogues list the same hall
  under both, so left apart they were two options each hiding the other's nights.

  The table is deliberately short and hand-written — this file compiles into the Cloud Function
  too, so a gazetteer here is a dependency in the collector, and **a wrong merge is worse than a
  missing one**: two options for one city costs a tap, where two cities filed as one is a filter
  that lies. Only the names this corpus produces are in it. The canonical side is the city's own
  name, which is what `isEndonym` lets the picker prefer to print (`Warszawa` over `Warsaw`,
  however often the English catalogue says it) — and `cities.test.ts` holds the two properties that
  keeps honest: every target folds to itself, and no target is itself an alias.

  **`matchReason`'s `cities` rule uses the same call**, so an interest limited to `Warsaw` reaches
  the nights filed under `Warszawa`, in the browser and in the collector alike. That is not tidiness:
  what an interest means by a city and what the picker groups under it coming apart is the failure
  this whole app is arranged to prevent, one field along.
- **The counts come from the view before the filter**, so each option says what pressing it would
  show. `Anywhere` carries its own count for the comparison: it is larger than the cities' sum by
  however many rows no source placed, and that difference is the only thing on screen saying those
  rows exist. They are not an option of their own — an RSS article is a piece of writing, and
  "somewhere unspecified" is not a place anyone picks.
- **The selected city stays in the list at zero.** A `<select>` whose value is absent falls back to
  its first option, so the control would read `Anywhere` while the feed went on showing one city —
  and a season ending or one bad scrape is enough to cause it. `withSelected` is what keeps that
  state visible and one tap from undone.
- **`ignoredCount` is filtered too.** The count on the `Ignored (n)` button and the list it opens
  are one question asked twice; taken over every city it would offer a view that opens on nothing.

It joins `CACHED_PER_OWNER`. It is a preference rather than data, but it is one that hides rows, and
inherited across a sign-in it would empty a feed nobody in that account had narrowed.

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
grants, the secret **containers**, `sendTestPush`'s public invoker binding, and the `gcf-artifacts`
cleanup policy. It exists because two deploys in a row failed for reasons that were not in the code
— a secret container that did not exist stopped the CLI deploying anything, and whether the
classifier's identity could reach Vertex AI was a question you answered by running commands.

**The ownership line is the whole design, and nothing may cross it.** Terraform owns the project;
the Firebase CLI keeps owning the functions, `firestore.rules` and `firestore.indexes.json`. Two
owners of one resource is permanent drift, where every `apply` reverts the last `deploy` and back
again with neither tool wrong — which is why the functions are not in Terraform even though they
could be.

Four things there are load-bearing, each written up in `terraform/README.md`:

- **Secret values are not in Terraform.** State stores them in the clear, and `VAPID_PRIVATE_KEY` in
  a state file is worse than the problem being solved. Only containers — their *absence* is what
  broke the deploy. Adding a secret is a line in `secrets.tf` plus one
  `firebase functions:secrets:set`.
- **`google_project_iam_member`, never `_binding` or `_policy`.** Only `_member` is additive.
  `_binding` is authoritative for a whole role and `_policy` for the whole project: applying one
  drops every binding not written in the file, including the ones that let CI back in.
- **`disable_on_destroy = false` on every API**, or deleting a line — or a typo renaming a resource
  — disables that API and takes live functions down to fix a text file.
- **The gate is "no plan may destroy anything"**, enforced in the workflow over the whole directory,
  plus `prevent_destroy` on the secrets and the registry. This repo commits straight to `main`, so
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
