---
name: audio-guide
description: The audio guide at /apps/audio-guide/ - the map and its pins, the Go backend, the keys and where they live, what a tap costs, the iOS audio unlock, and the narration language.
paths:
  - "audio-guide-function/**"
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
thinks is worth looking at. Tap one and a model writes a minute about it, a voice reads it, and it
plays. Ported from `oskarissimus/audio-guide-v2` (a Vite app of hand-written DOM, deployed to
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
  `X-ElevenLabs-Key` on every request — see the next section. No Secret Manager, no env vars, no
  fallback key of its own. A missing key, or one a provider refuses, is a **401**; everything else
  a provider says no to is a 502.
- **`--max-instances=5`** is a ceiling on what a stranger can use it for — the providers are
  paid with the caller's keys, but the instance time is ours.
- **Not in Sentry.** The four Node functions report to `korczak-xyz-functions`; this one logs each
  provider failure with `log.Printf` to Cloud Logging and nothing else. Adding `sentry-go` is the
  obvious next step if its failures ever need to be seen rather than looked up.

What it does, in order: reverse-geocodes the coordinates with Nominatim; asks `gpt-4o-mini` for
facts about the named place at that address; asks it again for a 80–150 word script written for a
speech synthesiser (numbers as words, abbreviations expanded — the prompt is emphatic about it,
because "1889" read aloud is "one thousand eight hundred and eighty-nine"); has ElevenLabs'
`eleven_multilingual_v2` read it; and answers with the MP3. If Nominatim failed it sets
`X-Location-Warning`, which is why the player sometimes carries a notice about accuracy.

The prompts, the model, the voice and the validation limits are the original's, unchanged. Two
behaviours changed in the move: where the keys come from (next section), and this: a provider failure used to be a bare
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

It gates the island, not the tap. The map and the pins are free to us, but behind the gate are a
geolocation prompt and an Overpass request on every pan, and neither is worth spending on somebody
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

Overpass is a free, shared, IP-rate-limited endpoint, and it is also what made the pins slow:
until Sep 2026 every pan and zoom was a fresh query for exactly the visible rectangle, half a second
after the map stopped, with nothing remembered. Now:

- **The pins are cached by map square** (`utils/audioGuide/tiles.ts`). The world is cut into the
  zoom-15 slippy-map grid (~750m squares in Poland) and each answer is filed under the squares it
  covered, **empty ones included** — an empty square is an answer. A new viewport draws whatever
  its squares already hold on the same frame, and asks Overpass only for the rectangle of squares
  it is missing. Zooming in and panning back are free. The cache is in memory, 1500 squares, least
  recently looked-at forgotten first — pins, unlike narration, are a few bytes each. Zoom 15 and
  not coarser because the first answer is the one somebody waits for, and a coarser grid makes it
  several times the screen.
- **An attraction is filed under the one square its point falls in**, so a building astride a
  boundary is one pin. When more than `MAX_MARKERS` are in view, the ones drawn are the nearest to
  the middle of the screen (`nearestToCentre`), not the first in the answer.
- **The query asks for `["name"]` on every clause** and leaves out `tourism=information`.
  `transformAttractions` drops the unnamed anyway, but `historic` alone is mostly unnamed walls
  and boundary stones — in an old town that was most of the response, serialised and sent for
  nothing. **Do not put a count limit on `out`** (`out center qt 300`): a truncated answer would be
  filed as the whole truth for its squares, and they would stay short of pins until the tab closed.
- **Below zoom 13 nothing is asked for** (`MIN_ZOOM`); cached pins still show, with a chip saying
  to zoom in.

`useNearbyAttractions` debounces the network by 250ms (the cache is read without waiting), aborts
the in-flight request when the map moves somewhere that needs another, and retries **only** a
busy server — 429 or 504. **A 504 is not "the box was too big".** It was read that way at first,
and a reader looking at one city block was told to zoom in: the public instance answers 504 when
its queue is full, whatever was asked. A query that genuinely outgrows `[timeout:25]` or its memory
comes back as a **200** with a `remark` (`runtime error: Query timed out…`), and that — checked by
`ranOutOfRoom` — is the only thing that says zoom in. It is not retried; it would be too big again.

The tile layer is cross-origin, and the service worker never intercepts cross-origin requests. So
**the app has an offline tier and is still useless offline**: the precache exists so the home
screen icon opens the app rather than `/offline`, which matters in exactly the place someone has
no signal — abroad, in front of the thing they wanted a guide to.

Leaflet's attribution is **moved to the top right** in `audioGuide.css`. It is a licence notice the
tile usage policy requires, and the bottom right is where the player and the progress panel sit;
on a phone that left the one notice we are obliged to show underneath them. Leaflet's control
corners are `z-index: 1000`, which is the number the overlays have to clear — 800 puts them under
the attribution.

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
is Leaflet* — which is a different thing: bytes, not megabytes, and free to fetch again.)
Re-tapping the pin you are listening to replays it; coming back to it later pays for it again.

A cache is the first thing anyone proposes here and it is the wrong shape: the audio is megabytes
per guide, the origin's ~5 MB localStorage budget is shared with the typing trainer's
`typedHistory`, and the thing people do with an audio guide is walk away from it. The object URL
behind the current guide is revoked the moment another pin is tapped — `heldUrl` in
`useAudioGuide` exists so that can happen without reading state that may already have been
replaced.
