---
name: transit
description: Metro Watch at /apps/transit/ - the two WTP feeds, the line/station tables the whole app turns on, the one extractor, the two notification kinds, and the raw archive.
paths:
  - "**/utils/transit/**"
  - "**/components/Transit/**"
  - "**/hooks/useTransitFeed.ts"
  - "**/hooks/useTransitSegments.ts"
  - "**/hooks/useTransitSettings.ts"
  - "**/styles/transit.css"
  - "**/pages/**/apps/transit.astro"
  - "**/pages/**/apps/transit/**"
  - "functions/src/transit/**"
  - "**/assets/icons/transit.svg"
---

## Metro Watch

At `/apps/transit/` — four tabs (Now, My route, Alerts, Raw) over Warszawski Transport Publiczny's
two RSS feeds, with web push when something happens on the stretch of metro the reader actually
rides. Signed-in only, for Event Watch's reason: the watching happens on a server and the
notifications have to know where to go.

Same two halves as Event Watch, same argument. `korczak-xyz/src/utils/transit/` and
`src/components/Transit/` are the client; `functions/src/transit/` is a second scheduled Cloud
Function that collects, reads and sends. `functions/tsconfig.json` compiles the first of those into
the deploy bundle by path, so the collector and the app answer *"does this touch my route?"* with
one function rather than two that agree until the first bug fix.

### It may import from `../events/`, and only that

`transit/portable.test.ts` is `events/portable.test.ts` with one allowance: a module here may
import from `../events/`. That is not a loophole, it is the same rule applied twice — everything in
that directory is proven portable by its own copy of the test, so importing from it cannot smuggle
in a DOM global or a Firestore client. It is how `foldText` and `slugKey` are shared rather than
written again, which this repo's own reasoning says would stay identical only until the first fix.

### The directory's own `tsconfig.json` is part of that portability

`src/utils/transit/tsconfig.json` extends nothing, and that is its entire job. Vite resolves a
tsconfig by walking **up** from the file it is transforming, so without one here the walk reaches
`korczak-xyz/tsconfig.json` and its `extends: "astro/tsconfigs/strict"` — resolvable only where the
site's `node_modules` are installed, which on the runner that installs `functions/package.json`
alone they are not. The directory shipped without that file and `functions/src/transit/*.test.ts`
died with `Failed to load tsconfig 'astro/tsconfigs/strict': Tsconfig not found`, naming a source
file that had nothing wrong with it.

The cost was not a red build, it was a deploy: the tests run **before** `firebase deploy` in
`firebase-deploy.yml`, so the same commit's Firestore rules never reached the project and the app
came up reading `transitItems` it had no permission to see — `Missing or insufficient permissions.`
on a screen whose backend looked fine. Event Watch escaped it only by accident: `functions/` imports
*types* from `../events/` at runtime, and a type import is erased before anything is transformed.

Both `portable.test.ts` files now assert the file exists and extends nothing, so this is caught in
the directory that caused it rather than in a runner that installs half the repo.

### The title is the gate, and it is what makes this nearly free

**Every item in both feeds is headlined with WTP's own list of affected lines** — `Utrudnienia w
komunikacji: 189, 401, 402`, `Zmiany w komunikacji: M1`, `Utrudnienia w komunikacji: 742, M1`. That
list is the cheapest filter this app has, and `linesInTitle` is the whole of it: whether an item is
worth a language model is decided from a string the feed gave away for free, so a fortnight of bus
roadworks costs nothing at all. The metro is two lines out of some three hundred and produces
roughly eight communiqués a month.

Read from the **title only**. A metro communiqué's body names the replacement bus lines, and a
body-wide scan would pull those in as affected lines; the headline is the operator's own statement
of what the item is about.

The token guard (`^[A-Z]?[A-Z0-9-]{1,5}$`) is what stops prose after a colon reading as a fleet of
lines. Without it, `Komunikat: zmiana organizacji ruchu na Woli` matches everything.

### `lines.ts` is world knowledge, and the order is the data structure

The station tables are the one piece of hard-coded fact in the app, and they have to be: *"trains do
not stop at Rondo ONZ"* is only a fact about somebody's commute once you know Rondo ONZ lies
**between** Rondo Daszyńskiego and Świętokrzyska, and no amount of reading the prose supplies the
order of a line. So a station is an index, a watched stretch is an interval, and the question is an
overlap test.

**This is a fact about the world on the day it was written, and the world changes.** M2 is still
being extended westward. When a station opens, adding it to the array is the whole change — the
matcher, the extractor's prompt and the segment editor all read this file. `lines.test.ts` holds
the properties that keep it honest: every name folds to itself, no two stations on a line share a
comparison key, Świętokrzyska is the only interchange, and the seeded legs still resolve.

`ALIASES` is deliberately short and every entry is one WTP actually writes (`rondo ONZ`, `pl.
Wilsona`, `Nowy Świat - Uniwersytet`). **A wrong alias is worse than a missing one** — the rule
`CITY_ALIASES` keeps for the events app, sharper here: a missing alias costs one unrecognised name,
which `impactOf` resolves upward into an alert you did get, where an alias pointing at the wrong
station puts a closure on the wrong half of the line and produces confident silence.

### Absence of evidence is resolved upward, never downward

The rule the whole app is arranged around, and the one thing not to "simplify".

`impactOf` returns `route` — the loud kind — for a metro communiqué it cannot read: one still in the
extraction queue, one the model failed on, or one naming a station this build cannot place. It is
**not** filed as line-level and it is **not** dropped, because an unreadable notice about M1 is not
a notice about somebody else's line; it is one whose stations are unknown.

Get this backwards and the day the extractor breaks is the day the app stops mentioning that the
metro is shut, while continuing to look perfectly healthy. That is this app's version of the
silently empty feed Event Watch is arranged to prevent, and it is worse, because a missed opera is
a missed opera and a missed closure is standing on a platform.

The cost is bounded and worth naming: a handful of over-priority alerts on a line the reader rides,
on the days the model is down. `ImpactVerdict.certain` travels with the verdict so the card and the
push body say which kind of answer this is — the banner leads with *"Nie udało się odczytać
szczegółów"* rather than shouting about nothing, because a loud alert that turns out to know
nothing teaches the reader that the loud kind is unreliable.

Three states, and the card draws all three, because **"no station is closed" and "nobody has
looked" must never blur together**: `closedStops` absent is unread, `closedStops: []` is read and
nothing closed, and `extractHash !== contentHash` is read and since edited.

`muted` is deliberately **not** read in `impactOf`. A verdict is a statement about the world; muting
is a statement about what should ring, and it belongs to `notices.ts`. Folded in, the feed would
disagree with itself — a card saying the route is clear while the stop list on the same card named a
station in the middle of it. A route match on a muted leg falls back to *line* level rather than to
nothing: muting a leg is not the same as not watching the line.

### A leg is an interval, and the way home is two of them

`SEED_SEGMENTS` is Rondo Daszyńskiego → Świętokrzyska on M2 and Świętokrzyska → Imielin on M1. Two
rows rather than one because it is two rides with a change at Świętokrzyska, and that is not a
modelling nicety: it is the difference between being told about a closure at Rondo ONZ (first leg)
and one at Wilanowska (second). A segment cannot span two lines, and `normalizeSegment` refuses a
pair that does not lie on one — a stretch from Rondo Daszyńskiego to Imielin is not a journey.

The editor shows **every station in a leg**, not just its endpoints. The interval *is* the rule, and
a row showing only its ends would leave the reader guessing whether Rondo ONZ counts, which is
exactly the question this app exists to answer without guessing.

Seeded rather than assumed: `withMissingSeeds` is keyed by id and never edits an existing row, so a
deleted seed stays deleted and a rewritten one keeps the reader's version.

### The content hash is in the alert id, and that is a feature

`alertIdFor` is `${slugKey(guid)}|${kind}|${contentHash}` — three parts where Event Watch's notice
id has two. WTP **edits a live communiqué** as a closure develops, and *"the closure now reaches
Imielin too"* is news about an article you were already told about. Keyed on the guid alone that
update is latched away by the alert already claimed for the original text.

The hash is over the **source prose**, never over the extractor's output (`contentHashOf`, folded,
so a whitespace edit in the CMS costs nothing). A model that phrased its summary differently on a
re-read must not be able to ring the phone.

The same hash is `needsExtracting`: unchanged text, no second model call. That is what keeps this
app's bill near nothing.

`contentHashOf` is FNV-1a rather than a crypto digest, deliberately: `createHash` is a Node builtin
and would push the module out of the browser bundle, taking the Raw tab's "this reading is out of
date" badge with it. Two independently seeded passes, because one 32-bit pass collides often enough
to matter when a collision is a missed alert.

### How this source fails, and why an empty feed is an error

**wtp.waw.pl is behind AWS WAF, and a challenged request returns `HTTP 202` with a body of zero
bytes.** `response.ok` calls that a success; an RSS parser reads it as a feed with no items; the app
would report that nothing is wrong with the metro on precisely the days it cannot see. Verified
against the live site while this was written — from a datacentre address, every plain request came
back exactly that way.

So `notAFeed` treats a non-feed body as an **error**, never as an empty feed, on three independent
checks (the `x-amzn-waf-action` header, a body too small, a body containing no `<rss`/`<feed`), and
`FeedFetch` records the status, the byte count and the first 500 bytes of what did arrive. Three
consecutive failures send a push saying the app cannot see. `functions/README.md` has what to do if
that starts firing; nothing in this repository should learn to solve a WAF challenge.

Note the consequence for `recordFetch`: unlike Event Watch's `recordHealth`, **zero items is not
treated as a failure here**. A WTP feed genuinely can hold nothing new, and the failure this source
actually has is precise and named — adding a vaguer signal beside it would only make the precise one
harder to read.

**The fixtures are reconstructions, not captures**, and `functions/src/transit/fixtures/README.md`
says so at length. Titles, links and dates are real (read off the public timeline of the community
bot that reads these same two feeds); the prose is representative. They prove the parser reads the
envelope and that the WAF-shaped failures are caught. They cannot do what the Teatr Wielki fixture
does — notice the day the markup changes. Replace them with a real capture at the first opportunity.

### The extractor runs in exactly one place

`functions/src/transit/extract.ts`, `gemini-2.5-flash-lite` on Vertex AI over Application Default
Credentials — no API key, for the reasons `classify.ts` sets out. What crosses into
`src/utils/transit/` is the *result*, as ordinary fields.

Four things about the prompt are load-bearing:

- **The station list is in it, per line.** Without it the model returns whatever the prose called a
  place — `odcinek Centrum – Wilanowska` as one string, `stacje na Ursynowie` — and nothing places
  any of that. With it, the instruction is an expansion over a fixed vocabulary.
- **Ranges must be expanded.** Polish notices state a closure as a stretch at least as often as they
  list stations, and a stretch this app cannot expand is a closure it cannot put on a route.
- **`closedStops` is free strings, not a schema enum**, though all 38 names would fit in one. An
  enum forces every answer onto a name this build knows — turning *"a station I have never heard
  of"* into *"the nearest one I was offered"*, silently. The unknown name is what tells `impactOf`
  it cannot clear the item, and that signal is worth more than the tidiness.
- **Dates are guarded on drift.** A model asked for a date it was not given will occasionally supply
  one; a closure six months either side of its own announcement is an invention, and storing it puts
  a card on screen claiming a disruption that ended before it began. The item's own `pubDate` is in
  the prompt because the prose gives times without dates (*"od godz. 20:00"*).

The answers stay in **Polish**. Station names are Polish, the reason is a phrase lifted from the
source, and `Centrum – Wilanowska · awaria taboru` reads the same in both locales. Translating it
would put a second reading between the reader and the operator's own words, which is what the Raw
tab exists to let them check.

`EXTRACTED_LINES` is a **deploy-time** decision, not a per-account one: the corpus is shared, so what
gets read is a shared cost. What each reader configures is the route. Widening it to the trams is
one edit plus a station table per line, and it multiplies the model spend by the lines added.

The order in `runTransitCollection` is `fetch → archive → upsert → extract → notify`, and the last
two are in that order for the reason Event Watch classifies before notifying: `impactOf` escalates an
*unread* metro item, so notifying first would send an uncertain high-priority alert about every
communiqué seconds before reading it — and the latch would then stop the correct, quieter alert ever
being sent. The archive is written **before** the upsert because it exists to answer "what did the
feed say" on the run where something went wrong, and a run that dies during the upsert is such a run.

The extractor is shown the corpus, not only this run's fetch. A feed holds twenty items, so a
communiqué that failed yesterday has scrolled off it and would never be retried — reading the metro
items back out of Firestore is what makes the queue drain rather than accumulate.

### The raw archive, and why it keeps what it could not read

`transitRaw` holds every item of both feeds exactly as it arrived, parsed or not, keyed by the same
id as the `TransitItem` it produced — so an edited communiqué overwrites its own row rather than
accumulating one per fetch. An archive that kept only what was understood could not answer the
question it exists for.

This is the tab that makes the rest of the app arguable rather than only obeyable: a card says *"no
stops at Politechnika, Pole Mokotowskie, Racławicka"* on the authority of a model reading four
sentences of Polish, and the only way to check that is to read the four sentences.

`RETAIN_DAYS` is 45 against a 14-day feed window, so nothing the app can draw is missing its source.
The sweep is capped per run, so the first one after a long gap cannot eat the run's budget.

### Two schedules, and why not one

`collectTransit` runs **every 10 minutes**; `collectEvents` runs every six hours. An opera season
moves on a scale of days; *"is the metro broken right now"* is worth nothing if the answer is five
hours old. Both WTP feeds are read every run — the planned-changes feed does not need that
freshness, but reading it costs one more request against a feed returning the same twenty items, and
a second schedule would be a second thing to reason about for nothing.

`maxPerRun` is 6, twice Event Watch's. The metro-only filter has already cut this to two lines the
reader rides, so what is left is genuinely about their commute — and collapsing six of those into a
summary would throw away the station names that are the whole content.

### What is shared with Event Watch, and what deliberately is not

- **`pushSubs` is shared.** One origin, one service worker, one endpoint per device. A second
  collection would be a second copy of the same rows going stale independently, and the stale one
  would be pushing at an endpoint Apple stopped honouring months ago.
- **`PushPanel` is shared**, extracted out of `EventsAlerts` for this. Every state it names is a fact
  about the *platform* — iOS refusing push outside an installed app, a denied permission — so the two
  apps are literally in the same state at the same moment, and two panels wording that differently
  would be two answers to one question. Its strings stay in `Events/translations.ts`: one mechanism,
  one wording.
- **`armedAt` is not shared**, and `useWebPush` grew a `stampArmedAt` option so it cannot be. It
  means "nothing already in *this app's* corpus may fire", and the two apps are switched on at
  different moments over different corpora. Left shared, pressing *Turn on notifications* here would
  arm Event Watch too and the next run would announce a fortnight of opera to somebody who asked
  about the metro. The transport app stamps its own, in `useTransitSettings`, and **only once push
  is actually `ready`** — a press that ends in a denied permission has armed nothing, and a corpus
  marked armed with no subscription behind it silently consumes the whole backlog the first time a
  device does subscribe.
- **`transit.css` imports `events.css`** rather than copying it. The two apps are the same kind of
  thing and two stylesheets describing one visual language would drift at the first change to
  either. What is genuinely this app's own is short: the line badges, the station chips, one border.
  The line colours are the one place in this app colour does work, and it never does it alone — the
  badge always contains the line's name in text, which is `charts.md`'s rule in miniature.

### Deploying it

`firestore.rules` gained `transitItems/`, `transitRaw/` and `transitFeeds/` — top-level collections
are outside the `users/{uid}` wildcard, so an app that reads nothing usually means the rules have
not gone out. `firebase-deploy.yml` gained `korczak-xyz/src/utils/transit/**` to its path filter,
because `functions/tsconfig.json` compiles that directory in.

No new secret and no Terraform change: `collectTransit` uses the same VAPID pair and reaches Vertex
AI as the function's own service account, exactly as the classifier does. **No `firestore.indexes.json`
change either** — every query here is a range plus an order on the same field, which the automatic
single-field indexes cover.
