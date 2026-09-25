---
name: audio-guide
description: The audio guide at /apps/audio-guide/ - the map and its pins, the Go backend, the sources every narration is grounded in and the checks on them, the keys and where they live, what a tap costs, the iOS audio unlock, and the narration language.
paths:
  - "audio-guide-function/**"
  - "audio-guide-pins/**"
  - "terraform/audio-guide*.tf"
  - "**/hooks/useAudioGuideKeys.ts"
  - "**/utils/audioGuide/**"
  - "**/components/AudioGuide/**"
  - "**/hooks/useAudioGuide.ts"
  - "**/hooks/useNearbyAttractions.ts"
  - "**/hooks/useUserPosition.ts"
  - "**/styles/audioGuide.css"
  - "**/pages/**/apps/audio-guide.astro"
  - "**/assets/icons/audio-guide.svg"
---

## Audio Guide

At `/apps/audio-guide/` — a map of where you are standing, with a pin on everything OpenStreetMap
thinks is worth looking at. Tap one and a model writes up to a minute from what Wikipedia,
Wikidata and OSM say about it, a voice reads it, and it plays. Ported from `oskarissimus/audio-guide-v2` (a Vite app of hand-written DOM, deployed to
GitHub Pages) in Sep 2026.

The front half moved first; the backend followed a few days later, and it is still Go.

### The backend is `audio-guide-function/`, and the only Go in the repository

`audio-guide-function/function.go` is the function that used to be `function/function.go` in
`oskarissimus/audio-guide-v2`, deployed to GCP project `prompt-compressor-1` in `us-central1`. It
now deploys to **`korczak-xyz-501720`, `europe-central2`, as `generate-audio`** — beside the Node
functions, but not among them:

- **The Firebase CLI cannot deploy it.** It does Node and Python. So it has its own job,
  `audio-guide` in `firebase-deploy.yml`, which runs `gofmt`, `go vet` and `go test` and then
  `gcloud functions deploy`. It needs `terraform` like `deploy` does, and runs beside it.
- **The CLI will not delete it either.** `firebase deploy --only functions --force` prunes only
  functions carrying its own `deployment-tool` label, and a gcloud deploy carries none. Nothing
  about the Node codebase can reach this function, and nothing in this job can reach that one.
- **It holds no keys.** They are the reader's, and arrive in `X-OpenAI-Key` and
  `X-ElevenLabs-Key` on every request — see the next section. No Secret Manager, no fallback key
  of its own; its only env vars say where its records go (*Every guide leaves a record*, below).
  A missing key, or one a provider refuses, is a **401**; everything else a provider says no to
  is a 502.
- **`--max-instances=5`** is a ceiling on what a stranger can use it for — the providers are
  paid with the caller's keys, but the instance time is ours.
- **Not in Sentry.** The four Node functions report to `korczak-xyz-functions`; this one logs each
  provider failure with `log.Printf` to Cloud Logging and nothing else. Adding `sentry-go` is the
  obvious next step if its failures ever need to be seen rather than looked up. (Its *timings* do
  reach Sentry, carried by the page — see *Every wait is measured*.)

What it does, in order: gathers sources (`sources.go`) - Nominatim's address beside the place's
Wikidata item, then up to two Wikipedia articles and one about whoever a memorial commemorates;
asks `gpt-4o-mini` to pick facts out of those, each with a verbatim quote (`grounding.go`);
checks the quotes; asks it again for a script written for a speech synthesiser from the facts
that survived (numbers as words, abbreviations expanded - the prompt is emphatic about it,
because "1889" read aloud is "one thousand eight hundred and eighty-nine"); has ElevenLabs'
`eleven_multilingual_v2` read it; and answers with the MP3 and the links its facts came from. If
Nominatim failed it sets `X-Location-Warning`, which is why the player sometimes carries a notice.

### The guide says only what its sources say

Until late Sep 2026 the model was given a name and a category and asked for "truly fascinating,
little-known facts" that would make a visitor say "I didn't know that!", at temperature 0.7, and
then for a "warm, engaging" script at 0.8. For anything smaller than a cathedral it knew nothing,
and the prompt asked for exactly what it could not know - so it invented it, fluently, in the
voice of a tour guide. Every piece below exists to close one route by which that happened.

- **The sources.** The page keeps the place's *story tags* from Overpass (`STORY_TAGS` in
  `overpass.ts`: `wikipedia`, `wikidata`, `subject:*`, dates, architect, inscription, other names,
  a handful of `name:xx`) and sends them with the tap, with the element's `osm` key. The function
  turns them into sources: the OSM tags themselves (only when there is a real fact among them -
  `historic=memorial` and a name is not a story), the Wikidata item's statements (inception,
  architect, style, heritage designation... with entities named in one more request), and
  Wikipedia articles. Articles are read **local language first** - the country comes from
  Nominatim's `country_code` - because the Polish article on a Warsaw church is usually several
  times the English one; the model translates. A memorial's `subject:*` article is labelled as
  being about the subject, **not** the place, and the prompt says what that allows.
- **Geosearch, strictly.** When OSM links no article, Wikipedia's `geosearch` within 250 m of the
  pin is read, and a hit is taken **only on a name match** (`namesMatch`: equal once folded, or
  every word of the shorter name - at least two words - in the longer, abbreviations like "św"
  allowed). The nearest article to a wayside shrine is usually the parish, the street or the
  district, and any of them would be read out as if it were the shrine. **Do not loosen this into
  "nearest article" or a fuzzy score** - a near miss is how the guide ended up about another town.
- **The quotes are checked in Go, not by the model.** The facts call returns JSON
  (`response_format: json_object`, temperature 0.1): each fact, the id of the source it came from,
  and a verbatim quote. `verifyFacts` keeps a fact only if its quote - normalised for case,
  whitespace, quotation marks and dashes, at least ten characters - is in the text of **the source
  it cites**, and only if every number in the fact is in the quote (a century in Roman numerals,
  "XVII wieku", counts for 17). A year is what a model most likes to invent and what a listener
  most likes to repeat. A dropped true fact costs a sentence; a kept false one is the whole bug.
- **The script sees only the surviving facts**, at temperature 0.3, and is told that any name,
  date, number or claim it adds is an error. The old "share the most interesting facts" prompt is
  where founding legends used to grow.
- **The length follows what is known.** Three or more verified facts: 80-150 words. One or two:
  35-70 (`tierFor`). None - no sources at all, or none of the facts survived - is a **422 with
  `code: "no_sources"`**, and the app says in its own words that nothing reliable is written
  about the place. No sources means no OpenAI call either; no surviving facts means no script and
  no voice. The app shows no Retry for it: asking again finds the same nothing and pays for it.
- **The reader sees the sources.** `X-Guide-Sources` carries the URLs of the sources a kept fact
  came from (percent-encoded, space-separated, exposed through CORS), and the player links them
  under the title: "Źródła: Wikipedia (pl) · Wikidata".

### Every guide leaves a record, for fact-checking afterwards

The quote check catches a quote that is not in its source. It cannot catch a fact that paraphrases
its quote into something else, a script that drifts from its facts, or a true fact thrown away —
those need somebody reading afterwards with everything the model saw. So since late Sep 2026
**every tap the model answers writes one JSON object** to `gs://korczak-xyz-501720-audio-guide-records`
(`record.go`, bucket in `terraform/audio-guide.tf`): the place and its tags, the labelled
location, **every source in full**, `proposedFacts` (all the facts call returned) beside
`verifiedFacts` (what survived), the tier, the script, the outcome (`narrated`, `no_sources`,
`no_verified_facts`, `script_failed`, `audio_failed`) and `release`, the short commit that
deployed the function — so a record can be read against the prompts that produced it.

- **Named by day**: `2026/09/24/143012-way-123-1a2b3c4d.json`. `gcloud storage ls
  gs://korczak-xyz-501720-audio-guide-records/2026/09/24/` is one day's guides in order.
- **No sources is recorded too**, as `no_sources` with the place, the labelled location and an
  empty `sources` — nothing to fact-check, but without it a walk's records named only the places
  that were narrated, and "which pins had nothing written about them" is a question the owner
  asks (added 25 Sep 2026; before that only the `no sources for "..." (node/...)` log line kept
  them). A 422 after a model call (nothing survived) is recorded as `no_verified_facts` — what
  was dropped is half of what this is for.
- **No keys, no account, no audio.** The function never learns who tapped. It does record where,
  which is why the bucket enforces public-access prevention.
- **It never fails a guide.** It is written by a `defer` after the answer, on its own 10-second
  deadline; a refusal is logged (`generate-audio: record ...`) and the reader never knows. With
  `GUIDE_RECORDS_BUCKET` unset — tests, a local run — nothing is written.
- **Written with the function's own identity**, a metadata-server token and one POST to the GCS
  upload API, not the storage client library: every other request in this package is plain
  `net/http` too. The identity holds `objectCreator` on this bucket and nothing more, because the
  function answers anybody — a stranger can add records, never read, change or remove them.
- **No delete rule**, Nearline after 30 days. Before-and-after is the question, so the before
  has to survive; a record is tens of kilobytes.

This is not a cache, and *What is not kept* below still holds: nothing reads a record back into
a guide.

Every Wikimedia request carries the app's User-Agent, because anonymous-looking clients are
refused outright ("You are making too many requests"), and a refusal is **logged**
(`generate-audio: wikimedia ...: status 429`): from the outside, a Wikimedia that has stopped
answering this function looks exactly like every place in the world having nothing written about
it. **If the guide starts answering "nothing reliable" everywhere, read those log lines first.**

**The address goes to the model labelled, with the coordinates always beside it**
(`describeLocation`). The original sent `Rybałtów, Ursynów, Warszawa, Polska` bare, and the model
read the street as a village: a tap on the church of St Padre Pio in Kabaty, on ulica Rybałtów,
got a guide to "a church in Rybałtów". Nominatim's `quarter` (Kabaty) is kept too — the suburb is
often only the borough. The facts prompt also says to stay on this exact place and say less rather
than borrow from a namesake. Do not go back to a comma-joined address. (Since the sources arrived
the address matters less - it no longer has to stand in for knowledge - but it is still how the
model tells a source about this church from one about its namesake.)

The model and the voice are the original's. Two behaviours changed in the move itself: where the keys come from (next section), and this: a provider failure used to be a bare
`Failed to generate audio`, with the provider's reason thrown away — so the `quota` branch of
`classifyNarrationFailure` could never fire. The 502 now carries the provider's own sentence
(`Failed to generate facts: OpenAI 429: You exceeded your current quota…`), pulled out of
OpenAI's `error.message` or ElevenLabs' `detail.message`, which the app shows verbatim under a
translated one. **If the guide starts failing everywhere and nothing here changed, that quote is
the diagnosis.** A network error or timeout says only that, never our own plumbing.

### The keys are the reader's, typed in the app like sloper's

OpenAI and ElevenLabs, in localStorage under `audio-guide-config` and in
`users/{uid}/audioGuide/config` — the same arrangement as sloper's and the backseat driver's, down
to the shape: `keys.ts` (pure), `keyStorage.ts`, `keyCloud.ts`, `useAudioGuideKeys`. Everything
`.claude/rules/backseat.md` says under *The keys* applies here unchanged and is the reason for each
piece: last write wins wholesale on one `updatedAt`, `pulledRef` gates the push, `settled` is
written on purpose, and the account-side borrow runs **after** the three sync branches. Read it
before simplifying any of them.

**The one difference is where the keys go.** The other two apps call providers from the page. A
guide is four steps and a minute of MP3, so here the page hands both keys to the Go function in
two headers on each tap, and the function uses them for that request and keeps nothing. That is
also why the function may answer anybody: a stranger posting to it pays for their own guide.
`Access-Control-Allow-Headers` must name both headers or every tap fails its preflight;
`Access-Control-Max-Age: 600` spares the second tap a preflight.

**A first visit borrows**, per key, first from sloper and then from the backseat driver — in the
browser (`sloper-config`, `sloper-api-config`, `backseat-config`) and, for a device with nothing
local, from `users/{uid}/sloper/config` and `users/{uid}/backseat/config`. Per key rather than per
config because the backseat driver only asks for ElevenLabs when one of its voices is picked. They
are **copies**, and the sheet says so under the fields: revoking a key means clearing it in each app.

The sheet (`KeysSheet.tsx`) sits over the map. It opens by itself once, when the account has
answered and a key is still missing — not before, or a phone whose keys are on their way would be
asked for them for half a second — and whenever a tap is made without both keys (no request is
sent: it would only come back 401 after the progress bar) or a provider refuses one.
Its fields commit on blur, not per keystroke, since each commit is a Firestore write.

`classifyNarrationFailure` checks for quota wording **before** the 401: ElevenLabs reports an
exhausted quota as a 401, and telling somebody to re-paste a key that is merely out of credit is the
wrong advice.

The old deployment in `prompt-compressor-1` is no longer called by anything here. It still holds
that project's own keys and will be redeployed by `audio-guide-v2`'s workflow on its next push;
deleting it there is the last step of the move, and nothing in this repository can do it.

### Every tap spends money, and the app is behind the account gate

A tap is two model calls and a minute of synthesised speech, billed to the reader's own keys — and this is a public page on a site with real traffic, where the old app
was a toy on GitHub Pages. So since Sep 2026 the whole island sits behind `AudioGuideGate`: it
opens for **approved** accounts only (`auth.user`, see `.claude/rules/accounts.md`), says "waiting
for approval" to a pending one, and offers sign-in, with a `redirect` back here, to everybody else.

It gates the island, not the tap. The map and the pins are nearly free to us, but behind the gate are a
geolocation prompt and a pins request on every pan, and neither is worth spending on somebody
who is then told they cannot have a guide. `AudioGuideApp` — everything with a hook in it — is not
mounted until the gate opens. The gate draws the app's own frame (empty stage, footnote) so the
page is the same height on both sides of it.

**The gate is not security, and since the keys moved into the app it does not need to be.** The
function answers anybody who posts, but it spends only the keys it is sent. What the gate now
buys is the account the keys are kept in, and not showing a geolocation prompt to somebody who
has no keys and no account to put them in.

What keeps an approved session survivable is still that nothing fires on its own: no guide is
generated by panning, by loading the page, or by any crawler, because the only path to that
function is a deliberate tap on a pin. That is a property worth preserving deliberately. **Do not
add "generate a guide for the nearest thing" on arrival, or prefetching for pins about to come into
view.** Both are obvious improvements and both turn a page load into a bill.

### The tap is a user gesture, and that is load-bearing

`utils/audioGuide/player.ts` holds ONE `<audio>` element for the life of the page, and starts it
on a 44-byte silent WAV inside the tap that asks for a guide. Every narration afterwards is a new
`src` on that same element.

This is not a tidiness measure. Safari will not play a media element that was never started from
inside a user gesture, and the narration arrives about twenty seconds after the tap — far outside
one. A `new Audio(url)` created when the fetch resolves rejects with `NotAllowedError`: the guide
downloads, the player appears, the button works, and nothing is ever heard. On a phone there is no
console to see it in.

The original unlocked an `AudioContext` instead, which is a different permission and does not
unlock an `<audio>` element. So: **`unlock()` is called first in `select()`, synchronously, and
nothing may be awaited before it.** The same trap is written up in `.claude/rules/backseat.md` for
the speech engine there.

The compass has the same shape and was ported broken. `DeviceOrientationEvent.requestPermission()`
is gesture-only on iOS and the original called it from inside the geolocation callback, which is
not one; the arrow then pointed north for the whole walk with nothing to say why. Here it is a
button, and the button appears **only where the permission exists** — on Android a button that
did nothing would be worse than none.

### The map is Leaflet, and React does not touch it

`MapPane.tsx` creates the map once and updates it imperatively. Markers are **diffed** against a
`Map<key, marker>` rather than cleared and re-added: panning a block changes a handful of a
hundred pins, and a redraw drops the selection and restarts the pulse on the pin currently
generating.

Three things about the pins that look like details and are not:

- **`key` is `${type}/${id}`, not `id`.** OSM reuses the same numeric id across nodes, ways and
  relations, so a node and a way in one viewport can collide — and the loser of that collision
  silently never gets a marker.
- **`MAX_MARKERS` is 100** and a dense old town answers with several hundred. Every pin is a
  `DivIcon`, which is real DOM with a label in it; this is the number at which a phone still pans
  smoothly.
- **The icon is anchored on the speaker glyph, not on the middle of the pill.** The point is the
  place; a pill centred on it puts its icon half a label away from the building it names.

Where the pins come from changed twice in Sep 2026, and the order matters for reading the code.
Until then every pan and zoom was a fresh Overpass query for exactly the visible rectangle, half a
second after the map stopped, with nothing remembered. First the answers were cached by square;
then the question stopped being asked live at all — see *The pins are built weekly* below. The
cache is what both sources feed:

- **The pins are cached by map square** (`utils/audioGuide/tiles.ts`). The world is cut into the
  zoom-15 slippy-map grid (~750m squares in Poland) and each answer is filed under the squares it
  covered, **empty ones included** — an empty square is an answer. A new viewport draws whatever
  its squares already hold on the same frame, and fetches only the squares it is missing. Zooming
  in and panning back are free. The cache is in memory, 1500 squares, least recently looked-at
  forgotten first — pins, unlike narration, are a few bytes each.
- **An attraction is filed under the one square its point falls in**, so a building astride a
  boundary is one pin. When more than `MAX_MARKERS` are in view, the ones drawn are the nearest to
  the middle of the screen (`nearestToCentre`), not the first in the answer.
- **Below zoom 13 nothing is asked for** (`MIN_ZOOM`); cached pins still show, with a chip saying
  to zoom in.

`useNearbyAttractions` debounces the network by 250ms (the cache is read without waiting) and
aborts the in-flight request when the map moves somewhere that needs another.

### The pins are built weekly, for the whole world

The app asks one question — named museums, attractions, galleries, viewpoints, artwork, historic
things and places of worship in a box, with the story tags — and the public Overpass instance took
seconds to tens of seconds to answer it, when it answered at all (a 17-second 200 after a 504 was a
normal morning). So since late Sep 2026 the question is answered **for the whole planet once a
week** and the browser reads the answer as a static file:

- **`audio-guide-pins/build.py`** downloads the planet (~95 GB, from the FAU mirror), cuts it down
  with `osmium tags-filter`, and in one pyosmium pass applies the rest of the Overpass query
  (`matches`: the `["name"]`, the anchored tourism values) and gives each way and relation the
  centre `out center` would — the middle of its bounding box. It files every place under the
  **zoom-13** tile its point falls in (4×4 of the cache's squares) and writes one gzipped tile per
  non-empty tile into a **PMTiles** archive. A tile is `{"elements": [...]}`, the shape of an
  Overpass answer, so `transformAttractions` reads both and there is one definition of a pin.
  Checked on a Warsaw extract against a live Overpass answer for the Old Town: every difference was
  an edit made between the two data dates.
- **`storyTags.json`** is the one list of kept tags, imported by `overpass.ts` and read by the
  builder. Two copies would drift, and a tag added to only one would be on Overpass pins and
  silently missing from every archive pin.
- **It runs on Cloud Batch**, on a spot `e2-highmem-4` with a 250 GB SSD boot disk, started by
  Cloud Scheduler on Saturdays at 04:07 Warsaw (`terraform/audio-guide-pins.tf`). About an hour
  and a half, about a dollar a month. **The job carries its own code**: Terraform base64s
  `run.sh`, `build.py`, its requirements and `storyTags.json` into the job's environment, so the
  apply *is* the deploy, and the builder's unit tests (`audio-guide-pins` in `firebase-deploy.yml`)
  gate the `terraform` job. To build now rather than on Saturday: `gcloud scheduler jobs run
  audio-guide-pins-weekly --location=europe-central2`, then `gcloud batch jobs list
  --location=europe-central2` and the job's log in Cloud Logging.
- **Published to `gs://korczak-xyz-501720-audio-guide-pins`**, public to read, CORS open for
  `GET`/`HEAD` with `Range`. An archive is immutable under its dated name
  (`pins-20260926-020700.pmtiles`, cached a year); **`latest.json`** names the current one, cached
  five minutes. The builder uploads the archive, then switches the pointer, then deletes all but
  the new one and the one before — a page opened before the switch is still reading the old one.
  Not an age-based lifecycle rule: after a month of failed builds that would delete the only one.
  Not behind korczak.xyz: the Worker's per-file asset limit is far below a world archive, and
  giving it a `main` to proxy one would take every page out from under `_headers`.
- **A build that finds fewer than 500,000 places refuses to publish** (`PINS_MIN_PLACES`). The
  world has millions; fewer is a truncated planet or a broken filter, and publishing it would empty
  the map everywhere at once.

**How a failure is seen, on each side.** The builder reports its own failure to Sentry
(`korczak-xyz-functions`, fingerprint `audio-guide-pins.build.failed`) — a spot VM taken back is
retried by Batch instead (exit 50001) and reports nothing. The page reports an archive more than
21 days old as `audioGuide.pins.stale`, an error and so a Sentry event in `korczak-xyz`: that is
the alarm for a schedule that stopped firing at all, which the builder cannot report because it
never ran. **If pins look out of date, look for those two issues first.**

**Overpass is the fallback, not gone** (`utils/audioGuide/pins.ts`, `useNearbyAttractions`). No
`latest.json` (not built yet, bucket unreachable), or any archive tile that fails to read, and the
whole missing range goes to Overpass exactly as before. A failed pointer fetch is not remembered,
so a page that opened in a tunnel goes back to the archive on the next pan. What is still true of
Overpass when it is used:

- **The query asks for `["name"]` on every clause** and leaves out `tourism=information` —
  `historic` alone is mostly unnamed walls and boundary stones. **Do not put a count limit on
  `out`** (`out center qt 300`): a truncated answer would be filed as the whole truth for its
  squares, and they would stay short of pins until the tab closed. The same goes for the archive's
  tiles, which is why the builder writes every place and the map caps what it *draws*.
- **It retries only a busy server** — 429 or 504. **A 504 is not "the box was too big".** It was
  read that way at first, and a reader looking at one city block was told to zoom in: the public
  instance answers 504 when its queue is full, whatever was asked. A query that genuinely outgrows
  `[timeout:25]` or its memory comes back as a **200** with a `remark`, and that — checked by
  `ranOutOfRoom` — is the only thing that says zoom in. It is not retried.

What the archive gives up is freshness: a pin is up to a week old plus the planet's own few days,
where Overpass was minutes. For churches and monuments that is nothing, and the narration still
reads OSM, Wikipedia and Wikidata live when the pin is tapped.

The tile layer is cross-origin, and the service worker never intercepts cross-origin requests. So
**the app has an offline tier and is still useless offline**: the precache exists so the home
screen icon opens the app rather than `/offline`, which matters in exactly the place someone has
no signal — abroad, in front of the thing they wanted a guide to.

Leaflet's attribution **stays in the bottom right**, and the dock is lifted clear of it
(`.ag-dock { bottom: 26px }`). It is a licence notice the tile usage policy requires, and the
bottom right is where the player and the progress panel sit, so without that lift they cover the
one notice we are obliged to show. (Until late Sep 2026 it was moved to the top right instead,
which put it under the full-screen button.) Leaflet's control
corners are `z-index: 1000`, which is the number the overlays have to clear — 800 puts them under
the attribution.

**Full screen is a class first and the Fullscreen API second.** The button in the bar pins
`.ag-app` over the viewport with `ag-app-full`, and only then asks for `requestFullscreen` where
it exists, which on Android hides the address bar as well. iPhone Safari has no element
fullscreen at all (only `<video>`), so there the class is the whole feature. Do not make the layout
depend on `:fullscreen`, or the iPhone gets a button that does nothing. Leaving the browser's own
fullscreen leaves ours too. A `ResizeObserver` in `MapPane` calls `invalidateSize`, because
Leaflet otherwise only re-measures on a window resize, and a container that grows without one
leaves the map grey in the new space. While it is on, `html.ag-full` strips a dragged window's
transform, because `position: fixed` inside a transformed ancestor is fixed to that ancestor. In full screen there is no gray margin and no bezel, the map runs to the screen's edges, and the bar
keeps only the exit button, floated over the map's top right corner, and the language, keys and
compass controls are hidden. They are set up before a walk, and a full screen exists to give their
row to the map.

### Every wait is measured

The pins and the guides were both still slow after the tile cache went in, and nothing could say
where the time went: a slow load is not an error, so Sentry saw nothing, and Cloud Run's request
log has only a total. So since late Sep 2026 every wait the reader sits through leaves one
structured measurement. **Look at these before changing anything for speed** — the guesses they
replace were wrong once already (the 504 that was read as "zoom in").

**On the page**, via `recordMeasurement` in `src/lib/sentry.ts` — a Sentry *log*, not an event, in
project `korczak-xyz`, Explore → Logs, filtered by message. Numbers and categories only: no
coordinates, no place names, and the free-text narration language only as `English`, `Polski` or
`other`.

| Message | One per | What it splits the wait into |
|---|---|---|
| `audioGuide.pins.load` | Pins load, archive or Overpass, however it ends (`outcome`: `ok`, `aborted`, `busy`, `too-big`, `failed`) | `source` (`archive`, or `overpass` with `archive`: `none`/`failed` saying why not) and `tilesRead` for an archive answer; `totalMs` from the map stopping to pins drawn = `debounceMs` + `requestMs`; of the last attempt `waitMs` (to headers: Overpass's queue and query) and `downloadMs`; `backoffMs`, `attempts`, `statuses` (`504,200`); `bytes`, `elements`, `found`, `shown`; `tilesInView`, `tilesMissing`, `tilesRequested`; `cachedViews` (viewports the cache answered alone since the previous request); `zoom`, `nth` and `sinceMountMs` (the first request is the one somebody is staring at), `network` |
| `audioGuide.narration` | tap that sent a request (`outcome`: `played`, `autoplay-refused`, `abandoned`, or a `GuideFailure`) | `totalMs` from tap to sound = `responseMs` (to headers) + `downloadMs` + `playStartMs`; the function's stages as `serverSourcesMs`, `serverNominatimMs`, `serverWikidataMs`, `serverArticlesMs`, `serverGeosearchMs`, `serverFactsMs`, `serverScriptMs`, `serverTtsMs`, `serverTotalMs`; `overheadMs` = `responseMs − serverTotalMs`, what the function cannot see (preflight, network, an instance booting); `cold`; `bytes`, `sources`, `status`, `retry`, `category`, `tags`, `language`, `network` |
| `audioGuide.position.first` | page visit | `ms` to the first fix or denial — the map sits on the fallback centre until then — `outcome`, `accuracyM` |

`abandoned` is the one to watch: it is somebody who tapped elsewhere or closed the panel before the
guide came, and its `totalMs` is how long they lasted.

**In the function** (`timing.go`), each POST is timed by stage and reported three ways: a
`Server-Timing` header (exposed through CORS; it is what the page reads for the `server*Ms`
fields), one JSON line on stdout that Cloud Logging files as a structured payload, and `timings` in
the guide record. The log line is the only one covering **every** POST — a 400, a 401, a 422
before any model call — with `outcome`, `status`, `ms` by stage, `cold` (the instance's first POST)
and `instanceAgeS`, the counts (`sources`, `sourceChars`, `proposedFacts`, `verifiedFacts`,
`scriptChars`, `audioBytes`), `wikimediaRefusals`, and `release`:

```
gcloud logging read 'resource.labels.service_name="generate-audio" AND jsonPayload.event="generate-audio.timing"' \
  --project=korczak-xyz-501720 --freshness=7d --format='value(jsonPayload.outcome,jsonPayload.ms.total,jsonPayload.ms.facts,jsonPayload.ms.tts,jsonPayload.cold)'
```

The stage names are shared by both halves; renaming one in Go loses its history in Sentry.
`progress.ts`'s "~22 seconds" was measured by hand once — `serverTotalMs` and `responseMs` are
what to recalibrate it from.

### The narration language is not the page language

`utils/audioGuide/language.ts`, one localStorage key, `audioGuideLanguage` — the same key the old
app used, so anybody who had chosen one keeps it.

They are separate settings on purpose and conflating them is wrong in both directions: somebody
reading the Polish site in Kraków may want English for the visitor beside them, and somebody
reading the English site in Warsaw may want Polish. It is **free text**, not a code list, because
the value goes into a prompt — "Deutsch", "Español" and "Cymraeg" are all things the model can
honour, and a dropdown of two would be a shorter list than what it can do. The two named options
are the site's own two languages, and the voice is multilingual, so nothing else changes with it.

The value is trimmed and capped at fifty characters on the way **out** of storage as well as in.
The backend rejects anything longer outright, and a stale value from an older build would
otherwise fail every tap with nothing to say why.

### The progress bar is a clock and says so

The backend answers once, with an MP3; the four steps it goes through are invisible from here.
`progress.ts` therefore walks a bar over the measured ~22 seconds and names the step it is
probably on, stopping at **95%** — a bar that reaches the end and sits there says "done" about
something that is not — and stopping the labels at the last stage rather than inventing a fifth.
Past 30 seconds it says so in words.

Do not be tempted to make it truthful by streaming progress from the function. It would mean
holding a connection open for the whole generation to report three transitions, and the reason the
bar is there at all is that a phone showing nothing for twenty seconds gets tapped again.

### What is not kept

No narration. None is cached, in memory or anywhere else. (The pins are, in memory — see *The map
is Leaflet* — which is a different thing: bytes, not megabytes, and nearly free to fetch again. The
script and its sources are *recorded* server-side for fact-checking — see *Every guide leaves a
record* — but no guide is ever served from that record.)
Re-tapping the pin you are listening to replays it; coming back to it later pays for it again.

A cache is the first thing anyone proposes here and it is the wrong shape: the audio is megabytes
per guide, the origin's ~5 MB localStorage budget is shared with the typing trainer's
`typedHistory`, and the thing people do with an audio guide is walk away from it. The object URL
behind the current guide is revoked the moment another pin is tapped — `heldUrl` in
`useAudioGuide` exists so that can happen without reading state that may already have been
replaced.
