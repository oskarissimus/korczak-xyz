---
name: events
description: Event Watch at /apps/events/ - the scraped corpus, the one matcher compiled into both browser and Cloud Function, web push, the geography classifier, and the Terraform project layer.
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

### Where an event is, and who it is for

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
  entire corpus would be re-labelled every six hours. It is written even for a half-verdict, or an
  event the model has no country for goes back in the queue for the rest of its life.
- **`mergeRecord` carries the classification fields forward.** `batch.set` replaces the whole
  document and `stripUndefined` drops absent fields, so a field no source has heard of is *deleted*
  on the next upsert unless it is named there. Same reason `firstSeenAt` is named there.
- **`CLASSIFIER_VERSION` is the only lever for re-labelling**, bumped in the code when the prompt
  changes. There is deliberately no button: "the prompt changed" is a fact about a build, and a
  re-run nobody can date afterwards is worse than no re-run.

The order in `runCollection` is `fetch → upsert → classify → notify`, and it is the point rather
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

#### The filter has to be falsifiable from the outside

A geography filter is otherwise unprovable: a thing that stopped appearing and a thing that was
never announced look identical, which is the whole reason this half exists. So the Feed's one
`Show everything` link became three states — `Matched` / `Filtered out` / `Everything` — where the
middle one lists events that satisfied everything an interest asked about their *content* and were
turned away only on `places`.

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
- **The tally** over the rejected list says what shape the removal has. Four countries once each
  reads very differently from forty rows filed under one, which is a classifier getting a country
  wrong at scale.
- **The coverage line** (`{classified} of {total} labelled`) is the half the rejected list
  structurally *cannot* show: an unclassified event passes the places rule, so it is never in that
  list, and a classifier that has quietly stopped looks exactly like a filter with nothing to remove.

The model's own sentence (`reachReason`) is printed under each rejected card, so a verdict can be
argued with rather than only obeyed. There is no per-event override: a wrong rejection is corrected
with a second interest naming the event, a wrong admission with the `excludeKeywords` that already
exist.

The countries also join the interest row's rule summary (`@PL`, and `+international` for the OR
clause) — left off, an interest quietly dropping four conferences a week would look exactly like one
that constrains nothing, which is this feature's own failure mode reappearing one screen along.

`SEED_INTERESTS` is untouched: `withMissingSeeds` is keyed by id and never edits an existing row, so
an account's own `Python & dev` is set by hand in the editor, which is also the first real test of
the toggle.

### Deploying it

`firestore.rules` gained `events/` and `eventSources/` — top-level collections are outside the
`users/{uid}` wildcard, so a feed that reads nothing usually means the rules have not gone out.

**Rules and functions deploy from CI** (`.github/workflows/firebase-deploy.yml`) — the site is
Netlify's on every push, and the backend is this workflow's. A `terraform` job runs **before** the
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
`TICKETMASTER_API_KEY` as secrets, and the public key **also** in Netlify's build environment as
`PUBLIC_VAPID_PUBLIC_KEY`. The classifier needs no secret at all — see above.

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
