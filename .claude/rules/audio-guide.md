---
name: audio-guide
description: The audio guide at /apps/audio-guide/ - the map and its pins, the Go backend and its cutover, what a tap costs, the iOS audio unlock, and the narration language.
paths:
  - "audio-guide-function/**"
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
- **The keys are Secret Manager secrets**, `OPENAI_API_KEY` and `ELEVENLABS_API_KEY`, mounted with
  `--set-secrets` — where the old workflow put them into plain env vars from GitHub secrets.
  Terraform owns the containers and, in `secrets.tf`, the per-secret `secretAccessor` grant for
  the runtime account: the Firebase CLI makes that grant itself for Node functions, gcloud does
  not, and the default compute account's `roles/editor` does not include it.
- **`--max-instances=5`** is a spending ceiling, not tuning.
- **Not in Sentry.** The four Node functions report to `korczak-xyz-functions`; this one logs each
  provider failure with `log.Printf` to Cloud Logging and nothing else. Adding `sentry-go` is the
  obvious next step if its failures ever need to be seen rather than looked up.

What it does, in order: reverse-geocodes the coordinates with Nominatim; asks `gpt-4o-mini` for
facts about the named place at that address; asks it again for a 80–150 word script written for a
speech synthesiser (numbers as words, abbreviations expanded — the prompt is emphatic about it,
because "1889" read aloud is "one thousand eight hundred and eighty-nine"); has ElevenLabs'
`eleven_multilingual_v2` read it; and answers with the MP3. If Nominatim failed it sets
`X-Location-Warning`, which is why the player sometimes carries a notice about accuracy.

The prompts, the model, the voice, the validation limits and the CORS headers are the original's,
unchanged. **One behaviour did change in the move**: a provider failure used to be a bare
`Failed to generate audio`, with the provider's reason thrown away — so the `quota` branch of
`classifyNarrationFailure` could never fire. The 502 now carries the provider's own sentence
(`Failed to generate facts: OpenAI 429: You exceeded your current quota…`), pulled out of
OpenAI's `error.message` or ElevenLabs' `detail.message`, which the app shows verbatim under a
translated one. **If the guide starts failing everywhere and nothing here changed, that quote is
the diagnosis.** A network error or timeout says only that, never our own plumbing.

### The cutover, and where it stands

The values of the two keys are not in this repository, not in Terraform state, and could not be
copied across: nothing here can read `prompt-compressor-1`. So the move is three steps, and
**until the third, the app still posts to the old deployment** — `BACKEND_URL` in
`utils/audioGuide/narration.ts` is the one line that decides which backend a tap spends.

1. The keys go in by hand, once, from wherever they are kept:
   ```sh
   printf %s "$OPENAI_KEY"     | gcloud secrets versions add OPENAI_API_KEY     --data-file=- --project=korczak-xyz-501720
   printf %s "$ELEVENLABS_KEY" | gcloud secrets versions add ELEVENLABS_API_KEY --data-file=- --project=korczak-xyz-501720
   ```
   Until both have a version, the `audio-guide` job warns *Audio guide not deployed* and skips
   — `--set-secrets` against an empty container fails the deploy outright, and a red job would
   hold nothing back that a warning does not. `none`, the repo's placeholder value, is read as
   unset, so a placeholder answers 500 (`config` in the app) rather than posting "none" as a key.
2. Re-run *Deploy Firebase* (`workflow_dispatch`), and post one real request to
   `https://europe-central2-korczak-xyz-501720.cloudfunctions.net/generate-audio`.
3. Flip `BACKEND_URL` to that address. Then — and only then — delete `generate-audio` in
   `prompt-compressor-1` and the `OPENAI_API_KEY`/`ELEVENLABS_API_KEY` secrets in
   `audio-guide-v2`, whose workflow would otherwise redeploy it on its next push.

### Every tap spends money, so the app is behind the account gate

A tap is two model calls and a minute of synthesised speech, billed to whoever's keys the backend
holds — and this is a public page on a site with real traffic, where the old app
was a toy on GitHub Pages. So since Sep 2026 the whole island sits behind `AudioGuideGate`: it
opens for **approved** accounts only (`auth.user`, see `.claude/rules/accounts.md`), says "waiting
for approval" to a pending one, and offers sign-in, with a `redirect` back here, to everybody else.

It gates the island, not the tap. The map and the pins are free to us, but behind the gate are a
geolocation prompt and an Overpass request on every pan, and neither is worth spending on somebody
who is then told they cannot have a guide. `AudioGuideApp` — everything with a hook in it — is not
mounted until the gate opens. The gate draws the app's own frame (empty stage, footnote) so the
page is the same height on both sides of it.

**The gate is not security, and the function is still open.** It removes the only page that
spends it; the URL is in the bundle and answers `*` to anyone who posts. Closing it for real means
the function verifying a Firebase ID token, which the move to `korczak-xyz-501720` is what makes
possible — that is where the accounts are. It is not done yet. Sending the token from the app
first would break the preflight: the function answers `Access-Control-Allow-Headers:
Content-Type` and nothing else, so an `Authorization` header fails every tap. The server side
(allow the header, verify the token, check approval) has to ship first.

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

Overpass is a free, shared, IP-rate-limited endpoint. `useNearbyAttractions` debounces the
viewport by 500ms, aborts the in-flight request when the map moves again, and retries **only** a
429 — a 504 means the box was too big to answer and will be too big again, so the reader is told
to zoom in instead.

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

Nothing. No narration is cached, in memory or anywhere else. Re-tapping the pin you are listening
to replays it; coming back to it later pays for it again.

A cache is the first thing anyone proposes here and it is the wrong shape: the audio is megabytes
per guide, the origin's ~5 MB localStorage budget is shared with the typing trainer's
`typedHistory`, and the thing people do with an audio guide is walk away from it. The object URL
behind the current guide is revoked the moment another pin is tapped — `heldUrl` in
`useAudioGuide` exists so that can happen without reading state that may already have been
replaced.
