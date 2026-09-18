---
name: sloper
description: The video generation wizard at /apps/sloper/ - the five-stage wizard as one island, saved projects and the bucket behind them, the four API keys and where they are kept, the streaming scene parser, the canvas pass every picture goes through, and the one Cloud Function that runs FFmpeg.
paths:
  - "**/utils/sloper/**"
  - "**/components/Sloper/**"
  - "**/hooks/useSloperConfig.ts"
  - "**/hooks/useSloperProject.ts"
  - "**/hooks/useSloperRun.ts"
  - "storage.rules"
  - "terraform/storage.tf"
  - "**/styles/sloper.css"
  - "**/pages/**/apps/sloper.astro"
  - "**/assets/icons/sloper.svg"
  - "functions/src/sloper/**"
---

## Video Generation Wizard

At `/apps/sloper/` — a topic goes in, a narrated MP4 comes out, paid for with the reader's own
API keys. Migrated from `oskarissimus/sloper` (a Vite SPA on GitHub Pages plus a FastAPI/FFmpeg
container on Cloud Run) in Sep 2026; `sloper-migration-log.md` at the repo root is the record of
what moved where and what did not move at all.

**The name it shows and the name it is spelt with are two different things.** It was called the
Slop Video Generator until Sep 2026; what changed is the `Sloper` / `sloper.desc` pair in
`src/i18n/index.ts` and nothing else. The route is still `/apps/sloper/`, the files are still
`utils/sloper/` and `components/Sloper/`, the Firestore document is still
`users/{uid}/sloper/config` and the localStorage key is still `sloper-config` — renaming any of
those trades somebody's saved keys, or a working bookmark, for a tidier spelling. The rule the
`/games/` → `/apps/` move wrote down applies here in full: a display name is free to change, a
path or a storage key is not.

Two halves, same as Event Watch: `korczak-xyz/src/utils/sloper/` and `src/components/Sloper/` are
the client, `functions/src/sloper/` is the one thing a browser cannot do.

### Why it is one page and one island

sloper was a `HashRouter` over five routes. Here the five stages are five values of one `stage`
in `useSloperRun`, and that is **still forced rather than preferred** even now that sittings are
saved: a genuine navigation tears the island down mid-generation, which cancels requests that have
already been paid for, and no amount of Firestore brings a half-drawn picture back. The step rail
is the whole of the navigation; a step you have not reached is a `<span>`, not a link, and nothing
in the rail ever points forwards — a step is unlocked by finishing the one before it, and `output`
only while there is a video to show.

The rail sits down the left with the sheet beside it and a band naming the step over it, which is
a setup wizard's shape on purpose: this app really is five steps in a row, and that is the one
layout that answers where you are, what is behind you and how much is left without being read.
Three things about it are load-bearing rather than decorative:

- **The rail is `sticky`, not fixed.** Twelve scene cards is several thousand pixels of scroll,
  and the only navigation there is must not be at the top of it. Sticky keeps it in its grid
  column, so on a phone — where there is no column to spare — it simply stops sticking and the
  five steps wrap into a row above the sheet.
- **The marker cell carries the state, not the colour.** A tick, an arrow or the step's number,
  in a cell one character wide; the navy bar behind the current step confirms it. Same rule as
  the charts, and it is what makes the rail legible to somebody who cannot tell the bar from the
  panel.
- **The rail's labels and the band's title are two registers of one step**, `stepScenes` against
  `scenesTitle`. The rail is short because five of them are read as a column at a glance; the
  band says it at length because it is the only heading that screen has. They are not duplicates
  to be collapsed.

One thing that fact still rules out, and it is the one people reach for first:

- **Still no localStorage for a sitting.** Twelve 1024×1536 images and twelve narrations is tens
  of megabytes against an origin budget of ~5 MB shared with the typing trainer's `typedHistory`.
  One sitting would evict a book. `storage.ts` holds one small key and nothing else, and that is
  as true after projects as before them — none of the saving below goes near localStorage.
  Installing the app does not change it either: an installed app shares the origin's budget, it
  does not get its own.

### A sitting is a project now, and it is saved

There used to be a second bullet above this one reading **"No resume. Reloading mid-run starts
again."** It was true for six weeks and the reason given for it was the localStorage budget in the
bullet that survives — which was the right reason for rejecting *that* store and not a reason to
have no store at all. Firestore and Cloud Storage are not that budget, so the objection is answered
rather than overruled, and nothing the old bullet protected has been given up: the other apps on
this origin still have their ~5 MB to themselves.

Signed in, everything a run produces is written down as it is produced. Signed out, nothing is —
the wizard behaves exactly as it did, one sitting, in memory, lost on reload — because there is
nowhere to put a project that belongs to nobody. That is the honest state, not a degraded one.

**The split is the design, and it is not a detail to tidy.**

| | holds | why there |
|---|---|---|
| `users/{uid}/sloperProjects/{id}` | name, date, stage, prompt, scenes, one row per asset, a keyless settings snapshot | kilobytes; it is listed and queried |
| `gs://korczak-xyz-501720-sloper` | the processed JPEGs, the MP3s, the finished MP4 | megabytes; it is fetched by URL |

A Firestore document is capped at 1 MiB. A twelve-scene script is perhaps 8 kB; one processed
picture is a few hundred kB and base64 adds a third to it. So the document holds a **path** per
asset and the bucket holds the bytes — which is also what makes the Open window cheap, since
listing projects reads documents and not one byte of image.

Six things about it are load-bearing:

- **The id is eleven characters of base64URL, in `?p=`.** `projectId.ts` says why at length: a URL
  is pasted into messages and read off second screens, a v4 UUID is 36 characters of which thirty
  are ceremony, and eleven symbols of a 64-symbol alphabet is 2^66 values. `crypto.getRandomValues`
  and `byte & 63`, never `Math.random()` — the cost of a collision is not a leak, it is one sitting
  silently overwriting another's scenes.
- **It is `replaceState`, never `pushState`.** Minting a project is not a navigation, and a Back
  button that stepped between stages of one wizard is precisely what the single-island design is
  for.
- **A project is minted on leaving the settings step, not on load.** Minting on load would put a
  row in the list for every idle visit, and the list is meant to be the videos you made rather than
  the times you opened the page.
- **The document is written whole, with `setDoc` and no merge.** One browser holds one sitting, so
  there is nothing to merge with; a partial write would leave a scene list and an asset list
  disagreeing about how many scenes exist, which is the one inconsistency the assembler cannot
  survive. This is *not* the config document's last-write-wins — that one is contested between
  devices and this one is not.
- **The cheap half is debounced, the expensive half is not.** Scenes, stage and prompt go on a
  1.2-second quiet timer (a write per keystroke is a bill and a rate limit) and `pagehide` flushes
  it. A picture, a narration and the video are uploaded the moment they exist, so a crash costs at
  most a second of typing and never anything that was paid for.
- **A failed upload costs the saved copy and nothing else.** The asset is already in memory and
  already paid for, so `putBlob` returning null does not fail the run. What it does cost is stated
  honestly on the way back: `hydrateAssets` demotes a stored "complete" with no path to "failed",
  so reopening offers Retry rather than drawing an `<img>` at nothing.

**Reopening does not fetch the bytes**, with one exception. A download URL is all an `<img>` or an
`<audio>` needs, so pictures and narrations come back as URLs with `data: null`; the blobs are
fetched one at a time by `blobForAsset`, and only when the assembler asks — which is what lets a
sitting paid for on a laptop be finished on a phone. The exception is the **video**, fetched
eagerly on open, because it is the finished article and the reason to reopen at all.

**Reopening never lands on the assembly stage.** A project saved while the video was uploading has
no video, and landing there would re-run a thirty-megabyte upload before anybody asked. It lands on
the assets screen, where the button to assemble is the next thing on the page.

**Start Over stopped being destructive**, which is the other thing this changed. It used to be the
only button on the site that threw away an hour of paid-for work; it now drops the id out of the
address bar and leaves the project in the account, and the confirm text says so (signed out it asks
the old question, because signed out the old answer is still true).

**The menu has one item and that is not a placeholder.** Project ▸ Open… , and a modal listing
name, date, stage, scene count and the topic. Rename, Delete and Duplicate are decisions nobody has
made; the two-word name is generated at mint time rather than taken from the topic, because the
project is minted *before* a topic is typed and a name that changes under somebody after they have
learnt it is worse than one that never meant anything.

**No API key ever goes in a project document.** `settings` is a `SloperConfig` with `apiKeys`
stripped by `projectSettings`, and that is the same rule the section below is built on: the keys
have one home per account, and a second copy per project is a second place to miss when somebody
revokes one.

**That snapshot is put back when a project is opened**, and it is not decoration. A project
reopened after the video size was changed would otherwise assemble at the new size, FFmpeg
letterboxing twelve pictures drawn for the old one — so the settings a video was made with come
back with it. Being keyless is what makes that safe: `update` shallow-merges, so restoring how a
video was made has no opinion at all about which keys are current. The cost, taken knowingly, is
that opening an old project moves the live settings (and therefore the account's config document)
back to what that project used.

### The bucket, and the two resources behind it

`korczak-xyz-501720-sloper`, in `terraform/storage.tf`. Three things are worth knowing before
touching it.

- **It is not `korczak-xyz-501720.firebasestorage.app`.** That is the name the console's SDK
  snippet prints for a default bucket, and `PUBLIC_FIREBASE_STORAGE_BUCKET` sat pointing at it for
  weeks — for a bucket nobody had ever pressed the button to create. A `.app` name is a
  domain-named bucket and cannot be declared outside the console; a plain project-prefixed one can,
  and the SDK does not care which it is handed.
- **Two Terraform resources, not one.** `google_storage_bucket` makes it exist;
  `google_firebase_storage_bucket` (the only reason `google-beta` is in this project at all) is
  what lets the Firebase SDK address it and `storage.rules` apply to it. Without the second, an
  upload gets a 404 from a bucket that plainly exists.
- **No lifecycle rule, deliberately, unlike the export bucket next door.** A nightly export is a
  copy of something that still exists; these objects are the only copy of a picture somebody paid
  for. An `age = 90` here would quietly empty a project somebody came back to after a busy quarter
  — the exact failure the feature was built to stop. If the bill ever matters, the answer is a
  Delete button in the Open window, not a timer.

**`firebase.json` names the bucket, and it is the only entry in that file that names anything
project-specific.** The `storage` key takes an object or an array; given a bare object the CLI
resolves the project's *default* bucket and fails the whole deploy with *"Firebase Storage has not
been set up on project …"*. There is no default bucket here and there cannot be one — that is a
`.firebasestorage.app` name only the console's "Get Started" button mints, which is a click nobody
can put in git. The array form names the bucket Terraform made and the lookup never happens. This
cost one red deploy on the way in; the bucket was created and registered correctly and the CLI
refused to look at it.

`storage.rules` mirrors `firestore.rules`: owner-only under `users/{uid}`, denied everywhere else,
with a 64 MiB cap (twice what the assembler accepts either way, so it cannot refuse anything the
app can legitimately make). It deliberately has **no household share** — the sleep log and the
shopping list are shared because a household is one household, and a grant made for a shopping list
must not reach into somebody's drafts.

### It is installable, and the reason is not offline

This used to read "no PWA tier and no manifest", on the grounds that an installable app here is a
thing you reach for away from a desk and this one's whole state dies with the tab. **That was
answering the wrong question** — it weighed installing only as a way to work offline, which this
app will never do, and ignored everything else an install is. It is in `PWA_APPS`, in `SCOPED`, in
both `APP_TIERS` lists and on both pages' `pwa` prop as of Sep 2026. One of the old paragraph's
three facts has since become false — there *is* a resume now, see the section above — and the
other two hold: a run still needs a network, and a sitting still dies with the tab for anybody
signed out. The conclusion was already right before either changed.

What the install actually buys, none of which needs a network:

- **Its own window.** No tab strip, no address bar, no URL to lose. The wizard is five stages and
  several thousand pixels of scroll on a phone, and the rail down the left is the only navigation
  there is; every row of browser chrome comes out of the sheet beside it.
- **Its own scope.** `/apps/sloper` and nothing else, so a stray link leaves the app rather than
  navigating away from a run in progress. That is less expensive than it was — a signed-in run is
  saved as it goes — and still expensive, because what a navigation kills is the requests in
  flight, and those are the ones already being billed for.
- **Its own icon and identity.** Four API keys live in this app's `localStorage`; reaching them
  through thirty tabs is how a sitting gets abandoned.

It is a full app in the registry with **one deliberate exception**: it is not in `PUSH_APPS`, and
it has nothing to notify about — a run finishes while you are watching it or not at all.

**The tier is two documents and ~55 kB gz, the smallest on the origin, and it is not there for
offline video.** Nothing in a run survives a dead network. It is there because the stage the app
opens at is the key-and-model form, which is backed by `localStorage` and works with no network at
all: without the tier the home screen icon opens `/offline`, and there is no reaching the settings
of an app that will not open. The model dropdowns stay empty until there is a network; that is the
honest state and the provider's own error says so.

`beforeunload` is still armed on exactly the same condition, `run.busy`, and installing neither
strengthens nor weakens it. What changed is only the sentence it shows: signed out it says the
pictures and the voice are in this page alone, and signed in it says the finished ones are already
in the account and what leaving costs is the requests in the air. Both are true of `busy` and
neither is true of anything else, which is why there is one condition and two strings.

The old paragraph here ended **"do not reach for a resume because the app now has an icon"**, and
that was right about the reasoning and has been overtaken by the store. The part of it that still
holds is the part about localStorage: an installed app shares the origin's ~5 MB rather than
getting its own, so the answer was never to put a sitting in it. The answer was a bucket.

### The keys, and the trade being made

Four of them — OpenAI, DeepSeek, Google, ElevenLabs — in `localStorage` under `sloper-config`,
and, for a signed-in account, in `users/{uid}/sloper/config` under the existing
`users/{uid}/{document=**}` rule. **No rules change was needed and none should be added**: that
catch-all already makes the document private to its owner.

Storing keys at all was the ask this migration was for, and the reasoning should not be quietly
reversed by somebody tidying:

- They are **already in the clear in the page's memory** every time it calls OpenAI. Encrypting
  them at rest buys nothing — anything the page can decrypt with, script on this origin can too.
- The only design that keeps them out of the browser is one where **a server of ours holds them
  and makes the calls**, which is a strictly larger thing to own and puts this site on the hook
  for somebody else's OpenAI bill.
- They are metered, per-provider and revocable, which is what makes the first two acceptable.

**The sync is last-write-wins, wholesale, on one `updatedAt`.** There is no reconciler and no
per-field revision like the sleep log's, and a field-by-field merge is not an improvement waiting
to happen — it is the specific bug to avoid. Merging by field means a key **cleared** on the
laptop is resurrected by the phone's copy on its next load, for ever. That is the one outcome
that must not happen to a key somebody deliberately revoked, so clearing is an ordinary edit with
a newer timestamp and it propagates.

`pulledRef` in `useSloperConfig` gates the push, not `user`: pushing before the pull has answered
races the account's own copy against whatever this browser had, and the edit that loses is the one
somebody just typed. A pull that finds **no document** is not "the account has no config" — it is
a first sitting, and this browser's copy is the only one there is, so it is pushed up.

### Typing a key is how a key is checked

There is no "validate" button for three of the four, because listing a provider's models *is* the
validation call: a key that fills the dropdown is a key that works. It is debounced 500 ms in
`ConfigStage`, because a key typed rather than pasted arrives one character at a time and forty
401s is a rate limit.

ElevenLabs is the exception — it has no model list worth showing, so it is the one key checked
explicitly, and only when Start is pressed (`validateElevenLabsKey`).

The auto-pick reads the current model through a **ref**, not a dependency. In the dependency array
it re-runs the fetch every time the dropdown changes, which is what the fetch itself does when it
picks one, and the two take turns for ever.

A provider's own error text is shown **verbatim and untranslated**. It is the string you would
paste into their support page; the sentence around it is translated, the quote is not.

### The scenes arrive before the model has finished writing

`parseSceneBuffer` in `llm.ts` is the only hand-written parser here and the streaming screen
stands on it. The model is asked for a JSON array of `{script, image_description}`; waiting for
the closing `]` is thirty seconds of blank screen, so the buffer is scanned for **complete
objects** and each becomes a card the moment it is whole.

It cannot use `JSON.parse` — the buffer is invalid until the last character — so it walks braces
itself, tracking strings and escapes. That is not defensive coding: an `image_description` is
prose written by a model, and `{`, `}` and escaped quotes turn up in prose. Counted naively, the
first brace inside a string closes the object one character early and nothing parses again.

It is called on **every chunk over the whole buffer** and re-parses what it has already parsed;
callers keep their own count and slice past it. That is quadratic in the scene count and does not
matter — the ceiling is 100 scenes of a few hundred characters.

`sceneSystemPrompt` and the parser are one thing. A prompt that stopped naming those two keys
would produce a stream nothing reads, with no error anywhere; `llm.test.ts` asserts the prompt
names them.

### Every picture goes through a canvas, and each step fixes a real failure

`processImage` in `images.ts`, in this order, and the order matters:

| step | what it prevents |
|---|---|
| flatten transparency onto white | a PNG with alpha becomes **black** under yuv420p, so a logo arrives as a black rectangle |
| lift below mean luminance 50 | slop image models love a near-black frame; the scene after it will not be, and the cut reads as a fault |
| re-encode as JPEG | the one that decides whether the video can be made at all — twelve 1024×1536 PNGs do not fit in 32 MiB |

Flattening comes first so the brightness reading is of pixels the video will actually show; the
JPEG pass comes last so its saving is not thrown away by a re-encode after it.

**The requested size is almost never what a model serves.** DALL-E 3 offers three sizes and none
of them is the 1024×1536 the video settings default to, and Gemini takes a ratio rather than
pixels — so `normalizeImageSize` picks the nearest supported one and FFmpeg letterboxes the
difference (`force_original_aspect_ratio=decrease` plus `pad`). `estimateImageCost` mirrors that
normalization deliberately: a price quoted for 1024×1024 against a request that will be sent as
1024×1792 is worse than no price.

### How long each picture is held

The narration's own length, never a setting. ElevenLabs' `/with-timestamps` returns a
character-level alignment, `wordsFromAlignment` folds it into words, and **the last word's end
time becomes the scene's `imageDuration`**. A walk that closes words on spaces alone drops the
final word, and the scene is then held for however long the second-to-last word ended — which
cuts the narration off mid-sentence. `tts.test.ts` guards exactly that.

`previous_text` / `next_text` are not optional niceties. Each scene is a separate request, so
without them the model reads every scene as a standalone sentence and the cuts sound like six
people reading six cards. Neither is billed.

### The queue, and why a rejection must free its slot

`ConcurrencyLimiter` is split out of the image module so it can be tested without a canvas (there
is no jsdom in this project). Twelve scenes fired at once earns a 429 from both providers. The
ElevenLabs width is a **setting** because their ceiling is per plan; the image width is a constant
because DALL-E's is per key and twelve has never been what hit it.

Two properties are load-bearing and both are tested: a rejected job frees its slot (otherwise the
first 429 stops the other eleven, which looks exactly like a generation still in progress), and a
task that throws **synchronously** rejects the promise `add` returned rather than escaping the
pump (an escape leaves that promise pending for ever — a card stuck on "Working" with nothing to
retry).

`startAssets` uses `allSettled` and catches per asset, never `all`: one refused image must not
abandon eleven paid-for narrations, and each rejection is recorded against its own asset, which
is what the Retry button reads.

### The one thing that is not in the browser

`assembleVideo`, a gen-2 HTTPS function in `functions/`, deployed by the same pipeline as the two
collectors. A Cloud Run container was the other option and was rejected: the existing path (WIF →
terraform → `firebase deploy`) already reaches `functions/`, and a container would have meant a
new registry, a new build and a new workflow for one endpoint.

- **`onRequest`, not `onCall`**, because the payload is tens of megabytes of binary and `onCall` is
  JSON — base64 would put a third on top of a body already at the platform's ceiling. `onCall`'s
  free `request.auth` goes with it, so the bearer token is verified by hand in `handler.ts`.
- **Busboy over `req.rawBody`.** Cloud Functions reads the whole body before the handler runs;
  anything streaming the request is too late.
- **32 MiB, both ways.** It bounds the upload *and* the MP4 coming back — a response over it is
  truncated by the platform, which reaches the browser as a corrupt file rather than an error. So
  the finished video is measured before it is sent. `assemble.ts` keeps the same limit on the way
  in, so most of this is never reached.
- **`ffmpeg-static`, and therefore no `ffprobe`.** The Python backend probed the finished file for
  a duration; the duration reported here is the sum of the scene durations the client sent, which
  is what the video was built to, to within the rounding `-shortest` trims.
- **`concurrency: 1`, `maxInstances: 3`, 2 GiB, 540 s.** libx264 takes every core it is given, so
  a second concurrent assembly on one instance makes both slower and doubles peak memory and
  `/tmp`; the instance cap is what stops a burst becoming a bill.
- **`metadata.ts` is Pydantic's replacement.** FastAPI validated the request body for free and a
  Cloud Function does not, and these numbers become `ffmpeg` arguments: a width of `1e9` is an
  out-of-memory kill, a `NaN` duration reaches `-t` as the literal string. Dimensions are forced
  even because yuv420p subsamples chroma 2×2 and libx264 refuses an odd one.

**`handler.test.ts` is the cross-runtime test and is the reason to keep `parseMultipart`
exported.** The part names and the file ordering are a contract written down twice in two
languages with no shared type; that test builds a body with the platform's own `FormData` — the
same serializer `fetch` uses — and reads it with the real parser. A parser that returned the files
in another order would produce a video whose narration drifts one scene further out of step with
every cut: correct-looking output that is wrong, which is worse than a crash.

### Deploying it

Nothing new in the pipeline — `functions/**` is already in `firebase-deploy.yml`'s path filter, and
`storage.rules` was added beside `firestore.rules` in both the filter and the `--only` list. Three
things are worth knowing:

- **`terraform/functions.tf` carries the public invoker binding**, beside `sendTestPush`'s and for
  the same reason: a gen-2 function is a Cloud Run service underneath, so it must be
  `google_cloud_run_service_iam_member`, and the service name is the function name **lowercased**
  (`assemblevideo`). "Public" means reachable, not unguarded — the handler returns 401 without a
  Firebase ID token.
- **It is a two-pass landing on a project where the function does not exist yet.** The terraform
  job runs *before* the deploy job, so a binding on a service that has never been created fails
  the apply and blocks the very deploy that would create it. Land the function first, let it
  deploy, then land the binding. This is the same two-pass `terraform/README.md` describes for the
  bootstrap, and it is a one-off: once `assemblevideo` exists the ordering is right for ever.

- **`storage:rules` deploys in the same step as `firestore:rules`, and its bucket is Terraform's.**
  That is why the existing job order is already right rather than needing a second pass: the
  `terraform` job creates the bucket and registers it with Firebase, and only then does the deploy
  job have somewhere to put the rules. The first landing of this feature is therefore one pass,
  unlike `assembleVideo`'s.

`PUBLIC_SLOPER_ASSEMBLE_URL` exists only for the emulator. In production the URL is derived from
`PUBLIC_FIREBASE_PROJECT_ID`, because a gen-2 function answers on the same `cloudfunctions.net`
host as a gen-1 one and one fewer variable is one fewer thing to get wrong.

`PUBLIC_GOOGLE_DRIVE_CLIENT_ID` is unset, so the "Send to Google Drive" button does not render.
That is the correct state until an OAuth client exists: a client id naming an origin Google has
not been told about produces a consent popup that closes with an error, which is worse than no
button. Downloading is unaffected either way.

### What was left behind

- **The FastAPI backend, the Dockerfile, `cloudbuild.yaml` and the Cloud Run deploy.** Replaced by
  the function above; the FFmpeg pipeline itself is a faithful port, same four steps and same
  flags.
- **Playwright's `video-generation.spec.ts`.** It drove the SPA against fixture providers through
  `VITE_*` env vars that do not exist here. What it covered is covered instead by the unit tests
  named above plus a mocked walkthrough — every provider intercepted at the network layer — which
  is recorded in the migration log rather than committed, there being no browser-test harness in
  this repo to commit it to.
- **`react-router-dom` and the four React contexts.** See the first section.
- **Tailwind.** `styles/sloper.css` is the whole look, on the site's own retro tokens.
