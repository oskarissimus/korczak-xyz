---
name: rpg
description: The 3D RPG at /apps/rpg/ (Wanderer / Wędrowiec) - quests written one beat at a time after each decision, the branching the game draws, the chronicle, the blocks places are built from, parseBeat as the boundary, the keys it reads, the demo on the owner's keys with its dollar caps.
paths:
  - "**/components/Rpg/**"
  - "**/utils/rpg/**"
  - "**/pages/**/rpg.astro"
  - "**/styles/rpg.css"
  - "functions/src/rpg/**"
---

# The RPG

Started Oct 2026 as the smallest thing that plays end to end: walk around a village (WASD, mouse
look under pointer lock, Shift to run), talk to a villager, go where the quest sends you, kill or
gather things there, decide. Inspired by The Witcher 3. Meant to be iterated on.

## A quest is written one beat at a time, after each decision

Since Oct 2026 (owner: "a generative feel, like a text RPG with an LLM: branching, our decisions
shape the quests to come, more places and characters, choosing what we do at each step"). A quest
is up to `MAX_BEATS` (4) **beats** (`utils/rpg/quest.ts`): a character somewhere (the village
square, or a place of the beat's own), maybe a job there first, then a situation and two or three
**decisions**. A decision either ends the quest (its reply is the epilogue) or makes the model
write the next beat, with every earlier beat and decision in the prompt. The next beat is asked for
the moment the hunter decides, so it is mostly written while the answer is read and spoken.

**Nothing waits for the model** (owner, Oct 2026: "generating a quest should happen in the
background"). Start drops the hunter into the village at once and the opening is written while
they walk; a decision's next beat is waited for the same way, "Ruszam." only closing the dialogue.
The journal says what is being written (`⏳ Bajarz pisze questa…` / `⏳ Losy się ważą…`) with one
line of the stream under it (`StreamLine`), and the world never pauses for it. `questTokenRef` is
what keeps that safe: a new quest, a resumed one or leaving to the intro bumps it, and an answer
for an older token is dropped rather than put into a world it no longer belongs to.

**A changed journal announces itself** (owner, the same day: "the player could get a notification
that the objective or next steps are updated"). The quest arriving, a new step and a job done each
put a banner in the middle of the view (`📜` and a heading, `notify` in `Rpg.tsx`) and pulse the
journal; it waits for an open dialogue to close before its six seconds start, so a step that lands
while the reply is being read is not missed. A resumed save is not announced. `navigator.vibrate`
buzzes where it exists, which is not iOS.

**The branching's shape is the game's, not the model's** (`planDecisions`): the opening always
forks two ways into jobs of different kinds; beat 2 forks two ways, sometimes with a third that
ends it; beat 3 goes on once or ends; beat 4 only ends, two or three ways. What each decision leads
to — slay (1–4), collect (2–5) or talk (go and meet someone), drawn 40/30/30 by `pickJob` — is
told to the model as given, so a decision's label describes what the next beat really asks. Left
to choose from "collect or slay, 1–5", the models wrote "collect 3" almost every time (owner, Oct
2026: "every quest is find 3 items"), and a model left to decide when a story ends does not end
it. Anything the model picks too uniformly gets the same treatment: draw it here, tell the model.

**Places and characters accumulate for the quest.** Every place a beat names stays standing
(`RpgScene.addPlace`) until the next quest; a beat may return to one by name, or a talk beat may be
in the village. A new place that would overlap one already standing is moved to the nearest clear
slot (`freeSlot` in `place.ts`, centres ≥ 50 m apart). Characters stand on spots in the square or
just inside their place, stay put after their beat, and say their last line if talked to again; a
beat may bring one back by name, and `parseBeat` keeps their gender and clothes. The beat's own
character is the one the marker points at once the job is done.

**The chronicle is what outlives a quest** (`utils/rpg/chronicle.ts`): each finished quest's title,
decisions with their one-sentence consequences, and epilogue, in localStorage per game language,
the last 8. The last 5 go into every beat's prompt as "the world remembers", with the instruction to
let them show and refer to one. Shown on the intro screen with a button to forget it. Not on the
account yet; following the reader between devices is a Firestore document for later.

A generated opening that fails plays the hand-written quest (two beats: the alderman, then the
fisherman at the lake with two endings). A later beat that fails ends the quest on the decision
just made, with the reason in a toast, and it still goes into the chronicle.

## The model writes words and chooses blocks; the engine builds

The model **invents the places** (owner's choice of the first step towards fully generated
quests, Oct 2026). It still writes no geometry: `utils/rpg/place.ts` is the closed
vocabulary — a direction (8) and distance (`near` 50 m, `far` 85 m) from the village, a biome (7),
up to four features (10: pines, dead trees, rocks, pillars, graves, water, campfire, huts,
mushrooms, standing stones), a ground colour, and for the targets a shape (enemies: humanoid,
beast, blob; items: crystal, flower, chest, skull, scroll), a colour and a size. The place is built
when its beat begins (`RpgScene.addPlace`, `components/Rpg/placeBuilder.ts`), seeded by its
name so it is the same place every time; scattered trees on it and on the dirt path to it are
hidden, not deleted, and come back with the next quest. A toast names it on arrival.

`parseBeat` is the boundary: a beat without a character, without as many decisions as the plan,
or without the place and target name its job needs is thrown away; a new place without a name, a
known direction or a known biome counts as no place; unknown features are dropped and the biome's own fill in; a shape that does
not fit the objective (a skull to slay) falls back to that objective's default. The fixed ruins,
forest and lake are gone; the hand-written quest's lake is a `lakeshore` place like any other. A
new block is a word in `place.ts`, a builder in `placeBuilder.ts` and a line in the prompt, in that
order.

The dialogue is a menu of lines the beat already contains, not a chat: talking costs no request;
deciding costs one.

**A story is told, not summarised** (owner, Oct 2026: the lines "sounded like a condensed
narrative, not a person telling their story or asking for something"; depth should come from
parts, from examining things, from other people). A beat's `story` is 2–4 parts, each a question
the hunter asks and 1–3 spoken sentences back, and the prompt asks for a real person: an opening
line or two, then what happened, what they fear or are ashamed of, and only at the end what they
want, with hesitation and concrete detail. Besides that a beat may have up to 2 **clues** —
things lying near the character, built from the item shapes, that E examines (the hunter's own eye,
in Brian's voice) and that each open a question for the character, who then admits something more
— and a **witness**, a second character at the place with their own greeting and one or two
answers. `situation` is still there, the parts joined, for later prompts and the chronicle; an
answer with only a `situation` is played as a one-part story.

**Nothing is offered before it has been said.** A character opens with the greeting and one way
on (the first part's question, or goodbye); each part offers only the next question; the
decisions, the small-talk questions and the questions of clues already examined come with the last
part, and a character asked before the job is done only says the waiting line. Once the story has
been heard, talking again goes straight back to the last part. The first version put the small
talk beside the greeting, and the opening offered "Why did you keep silent so long?" and "Where
was the girl seen?" after one line that mentioned neither (owner, Oct 2026).

**E reaches the nearest thing**, character, clue or thing to pick up (`nearestThing`): with a
witness and clues at a place, a character standing among the herbs swallowed every press.

**Every line is spoken, never narrated.** The prompt says so with a wrong and a right example
(Flash-Lite wrote "Helena weeps and says her daughter-in-law hanged herself" as Helena's own line,
owner, Oct 2026), and `narrated` in `quest.ts` throws away a beat whose greeting, story parts,
waiting line or replies open with the character's name as the subject or report their speech
("mówi, że", "says that") — the next model is asked instead. Decision labels are the hunter's
spoken line, at most 12 words.

## What it looks like

Since Oct 2026 the people are not capsules (owner: "people looking like pills is a bit lame"; of
the options — chasing realism, free assets, AI-generated models, a PS1 filter — he chose free
assets and scanned textures, and no retro filter). Everything is **CC0**, so nothing needs
crediting, and is committed under `src/assets/rpg/`, imported with `?url` so it ships
content-hashed and immutable.

- **People** (`components/Rpg/characters.ts`): Quaternius's *Modular Character Outfits – Fantasy*
  (male/female ranger and peasant, the free tier), *Universal Base Characters* (heads, hair) and
  *Universal Animation Library* (the clips). All on one 65-bone skeleton, so `dress` puts an
  outfit, a head and hair together at run time by rebinding the head's and hair's skinned meshes to
  the outfit's bones, and one mixer moves the whole person. A character's look is drawn from their
  name (`lookFor` in `RpgScene.ts`): outfit (30% ranger), hair, beard, hair colour; their gender
  picks the body; their clothes colour is multiplied into the outfit at 55%, so "a woman in red"
  still reads as red. The hunter is the male ranger with a beard; the sword sits in the right
  hand, placed from the hand's own finger bones (`gripSword`), not tuned by eye.
- **Humanoid enemies** are the bare base body washed in the target's colour, jogging, punching,
  flinching and falling (`Death01`, then gone after 2.2 s; they stop being targets at once). Beasts
  and blobs are still primitives: Quaternius's monster packs were behind a Google Drive quota the
  day this was done.
- **Surfaces** (`components/Rpg/surfaces.ts`): ten Poly Haven colour maps at 512 px, tiled per
  material and cached per tiling (each tiling is its own GPU texture, so taking a place down
  disposes none). A biome's ground colour becomes a tint at full brightness (`hueTint`), because
  multiplying the dark colour itself into an already dark scan made every place a black disc.
- **No environment map**, so anything fully metallic renders black: `dress` caps the outfits'
  metalness at 0.3 and the sword is 0.35.
- **The models never block the game.** A character is an empty `THREE.Group` until the files
  arrive (~5.8 MB for the people, ~4 MB for the world, once); if they fail, everyone becomes the old capsule and the game plays.
- **The world** (`components/Rpg/world.ts`): Quaternius's *Medieval Village*, *Stylized Nature* and
  *Fantasy Props* megakits, cut to three files (`village.glb`, `nature.glb`, `props.glb`, ~4 MB)
  whose top-level nodes are the pieces by source name. Houses are *built*, not loaded: 2 m wall
  modules (door, wide windows, plaster/timber/brick), corner posts, two gables and a tiled roof,
  small 4×6 m or large 6×8 m, facing the square. Trees and ground cover (~2,900 grass, fern,
  bush and flower clumps outside radius 14) are `InstancedMesh` per part; a tree a place clears is
  hidden by a zero matrix, not removed. Kit meshes are `userData.shared`, so `clearPlaces`
  disposes none of them. Quest places use the kit's pines, dead trees, rocks and huts when it has
  loaded and primitives otherwise. The well is still hand-built (inner and outer walls — a single
  open cylinder had its far side culled and read as a hole), and so are graves and campfires.
- **The ground hides its tiling** (`breakTiling` in `surfaces.ts`): one 512 px scan repeated 70×
  read as a chessboard (owner: "you can see how repetitive the texture is"), so the shader samples
  it at two scales, turned, and lets a very slow sample of the same map choose between them and
  shade the patch.
- **Shadow bias** (`-0.0004`, normal bias `0.04`) is what keeps the kit's flat walls free of
  saw-tooth acne; drop it and every house is striped.

The source packs are ~500 MB of 4K PNGs. `scripts/rpg-characters.mjs` and `scripts/rpg-world.mjs`
(where to download them, what is cut: textures to 1024/512 WebP, the Unreal-only UV sets, bodies
cut to head and neck, all but the needed clips and pieces; both read through `scripts/rpg-gltf.mjs`,
which repairs the packs' misnamed texture URIs) and `scripts/rpg-textures.mjs` regenerate the
committed files.

## Keys

Read from the shared account store (`useAccountKeys`, see `account-keys.md`); the game never edits
them. Google first, OpenAI `gpt-4.1` only without a Google key. On Google the models are tried
in order (`modelChain` in `storyteller.ts`): the one picked on the intro screen (`MODEL_CHOICES`,
kept in localStorage `rpg-model`), then `GOOGLE_MODELS`, **strongest first** (owner, Oct 2026: "the
better model first and a fallback; we switch to a cheaper one when we optimise for cost"):
`gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-flash-latest`,
`gemini-flash-lite-latest`, all in JSON mode, then `gemma-4-31b-it` (no JSON mode;
`gemma-3-27b-it` was withdrawn, 404, Oct 2026). Flash-Lite was first until it wrote briefings and
narration.

**Pro is slow, not broken.** Measured Oct 2026: its first token takes 3–40s even on a one-line
prompt, and a whole beat can run past a minute. The first version had one 90s limit for the whole
attempt, and a timeout ended it — no Flash asked, the hand-written quest, after a minute and a
half of "the fates are deciding" (owner: "it takes terribly long"). Now each model has its own
limits (`STALL_MS` 60s without a byte, `MODEL_MS` 180s in all) and running out of either moves to
the next. Every answer is **streamed** (`streamGenerateContent?alt=sse` with
`thinkingConfig.includeThoughts`, OpenAI `stream: true`), so the wait shows Pro thinking instead of
nothing. The proxy in the cloud sandbox cuts any upstream request at 30s, so a whole Pro beat
cannot be tested from there; Flash can.

A 404, a 429 (quotas are per model), a 503, a 400 naming the model or a timeout moves to the next;
so does an answer `parseBeat` cannot play. Anything else — a rejected key above all — ends it. No key or no
usable answer plays the hand-written quest, and **the reason is put on screen** in a toast.

**Every generation is recorded** (`questLog.ts`), because the first version swallowed failures into
a breadcrumb and the only symptom, reported by the owner, was "always the drowners":

- Sentry Logs, `rpg.quest`, one per beat: outcome (`generated`, `no-key`, `unusable`, `failed`),
  provider, model, ms, each try's model and status, which beat, its job (`kind` is `opening` for
  the first), the plan (`slay,talk,end`), the biome (`village` for the square), the targets'
  shape, how many story parts and clues, whether there is a witness, the model picked (`chosen`),
  the first byte's wait, the tokens (`inputTokens`, `outputTokens`, `thoughtTokens`) and `costUsd`.
  Sent signed out too. Never the prompt or the story.
- A beat still being written when the page is hidden or closed is an `rpg.quest` of its own, outcome
  `pending` or `abandoned` with how long it had run (`watchBeat`). The owner waited out a slow Pro
  beat and left, and Sentry had nothing: the only record was made when an answer came.
- A beat that fails (`failed`, `unusable`) is also a Sentry **error**, `rpg.quest.failed`, with every
  model's status and error, so it is in Issues and not only in a log query.
- A production build served anywhere but korczak.xyz reports as environment `preview`
  (`src/lib/sentry.ts`): the end-to-end runs against `astro preview` with a mocked model had been
  landing among the real quests as `production`.
- For a signed-in account, `gs://korczak-xyz-501720-backseat/users/{uid}/rpg/beats/{at}.json`
  (before the beats, `rpg/quests/`): the prompt, the raw answer, every model tried with its error,
  the parsed beat, the release. The
  backseat driver's bucket, because its `users/{uid}/**` rule already covers it; a bucket of the
  RPG's own is a Terraform change for later. Read these before guessing at a bad quest.

**Nothing decides "no key" before the account has answered.** A signed-in reader's keys may be in
`users/{uid}/keys/config` and not yet in this browser, so Start stays disabled until `useAuth` has
resolved and the key sync is `synced` or `error` (signed out: as soon as localStorage is read). The
first version generated the moment localStorage was read, which on a fresh browser was always the
hand-written quest.

## The demo: no key, no account, the owner's keys

Owner, Oct 2026: "a demo, so you can play without your own key and without an account — say at
most $4 per user per day, and $10 a day across everybody so I do not go broke". A reader with no
Google or OpenAI key of their own plays on the owner's, through **`rpgDemo`**, the game's one
server call (`functions/src/rpg/handler.ts`, gen-2 in `europe-central2`, 300s for a streamed Pro
beat). A key of the reader's own always wins; the demo is never asked for one.

**It is the roaster's demo again** (`backseat.md`, *The demo*), and shares its pieces: the switch
and the paying account in `demo/config` (`enabled`, `keyUid`; the RPG's own switch is
`apps.rpg`, on unless `false`), the keys read at call time from that account's
`users/{uid}/keys/config` and never named in an answer, the Warsaw day (`dayKey`), the day-keyed
address hash (`ipKey`, the last `x-forwarded-for` hop), `ALLOWED_ORIGINS`, and no
Firestore rule on `demoUsage` because only the Admin SDK touches it.

**The budget is dollars, not calls** (`utils/rpg/demoLimits.ts`, compiled into both runtimes):
`rpgPerIpUsd` (default 4, at most 20) per address and `rpgDailyUsd` (default 10, at most 50) for
everybody, in `demoUsage/rpg-{day}` and its `ips/{hash}`. A Pro beat costs ten Flash-Lite ones and
a clip costs by its length, so a count would be wrong one way or the other. **Every call reserves
its worst case in a transaction before it is made** — every prompt character as a token plus the
whole 16384-token output budget, at the model's price (`beatReservation`; aliases priced as what
answered them, `PRICED_AS`) — and is **settled** afterwards at what `usageMetadata` says it cost.
So the caps cannot be passed, only approached. A Google refusal costs nothing; a stream cut
before its usage arrived keeps the whole reservation, which errs the owner's way.

- **The prompt is built on the server.** The game sends the `BeatContext`, never a prompt;
  `demoContext` checks it field by field and cuts every string and list to what the game itself
  sends, and `beatPrompt` builds the prompt from that. The model must be on `DEMO_MODELS` (the
  picker's Google ids; a test keeps the two equal). The answer is still parsed by `parseBeat` in
  the browser against the game's own context.
- **The stream is Google's, byte for byte.** The function pipes `streamGenerateContent?alt=sse`
  straight through, so `storyteller.ts` reads a demo beat with the code that reads a keyed one
  (`readGoogle`) and the console and the waiting screen work unchanged.
- **A refusal is 402 for a cap and 503 for closed**, with `reason` in the body — never 429, which
  is what Google says about one model's quota. A cap moves the game to the **next, cheaper model**
  (Pro's worst case is ~$0.20, Flash-Lite's ~$0.04, Gemma's nothing), which may still fit what is
  left; closed ends the attempt. Google's own errors are passed on with Google's status and move
  on as they would on a key.
- **The voice goes through it too**, `{kind:'voice'}`: one line of at most 400 characters in one of
  the three voices, priced before it is made at the list rate (`clipCost`). `DEMO_VOICE_KEY` in
  `voice.ts` stands in for an ElevenLabs key. Only a demo quest speaks on the demo; a reader with
  their own Google key and no ElevenLabs key stays silent.
- **The intro asks first** (`GET`, `fetchRpgDemoStatus`): whether it is open, whether the paying
  account can speak, and what is left today, which is printed. Asked again at a quest's end. A
  quest cut short by a cap ends on the decision made, with the reason on the ending screen
  (`Ending.cut`) — the toast is under that overlay.

Not written down anywhere else: nothing on the admin panel sets the two dollar caps yet, so the
defaults apply until `rpgPerIpUsd`/`rpgDailyUsd` are written into `demo/config` by hand.

## The autosave

`utils/rpg/save.ts`, localStorage `rpg-save`, one quest at a time (owner, Oct 2026: he went back by
accident just before a story ended and never learnt how it ended). Written at every step that
changes the quest: a beat set up, a target killed or picked up, a clue examined, the story heard,
a decision made. It keeps every beat so far, the decisions, the job's progress, what was examined
and heard; the world is rebuilt from that (`resume` in `Rpg.tsx`), with the hunter back at the
village. A decision whose next beat was still being written is saved as made and the beat is asked
for again on load, since the answer in flight is lost with the page. The intro screen offers
"Kontynuuj: <title>" in the save's language; a new quest or a finished one clears it.

## Language

Asked on the intro screen (Polski / English), starting from the page's locale. It sets the game's
UI, the language the quest is written in, and ElevenLabs' `language_code`. The quest is generated
on Start, not on load, so the choice is what the model is asked for.

## Voice

Both sides of a conversation speak through ElevenLabs (`utils/rpg/voice.ts`, `eleven_flash_v2_5`)
when the store holds an ElevenLabs key: the option the hunter picks in Brian's voice, then the
answer in George's or Rachel's, by the speaking character's gender. `speakLines` requests every clip at once
and plays them in order, so the answer is ready when the question ends; a newer choice stops the
queue. **Each line is
spoken once per quest** (`spokenRef`, keyed by voice and text, cleared when a
new quest loads) — at the owner's request, so going back to a menu does not read its greeting
again. One audio element primed inside the Start click (the iOS unlock, see `backseat.md`), clips
cached by text, a 🔊 button to mute. A failed clip is a toast and the line stays readable; it never
blocks the dialogue.

**The answer appears when its speaker starts talking** (owner, Oct 2026). While the hunter's chosen
line is read, the dialogue stays as it was with that option lit and the rest greyed and disabled
(`held` in `Rpg.tsx`); `speakLines`' `onStart` releases it as the answer's clip begins, and its end
or failure releases it too. Without a voice, or for a line already spoken, nothing is held.

**Options say what they are**: a decision (`kind: 'plot'`) is bold and amber with a `➤` before
it; a question (`ask`: story parts, small talk, clue questions, the witness's) is greyed and
italic with a `✓` after it once asked in this quest, and can still be asked; goodbye and back are
plain. The glyphs are there because the owner plays on a phone set to black and white: **nothing
in this game may be told apart by colour alone.**

## On a phone

Owner, Oct 2026: "make it play well on a smartphone, an iPhone SE 3 above all — a small screen,
and I have a black-and-white display set". Decided once per page, by a coarse primary pointer
(`touch` in `Rpg.tsx`), not by width: a narrow desktop window keeps the keys and the mouse.

- **The controls** (`TouchControls.tsx`): a stick under the left thumb (camera-relative like WASD,
  `RpgScene.setStick`; pushed to its rim it runs, as Shift does), a finger dragged anywhere else on
  the canvas turns the camera (pointer events on the canvas, `touch-action: none`), and under the
  right thumb `⚔ Cios` and, only while something is in reach, a larger light button saying what E
  would do (talk, examine, pick up). Pointer lock is never asked for on a phone.
- **The whole screen while playing** (`rpg-immersive`: fixed, `100dvh`, the page's scroll locked).
  iOS has no Fullscreen API for anything but video, so the ⛶ button is hidden there; a `✕` at the
  top left goes back to the intro, the quest autosaved and offered as Continue.
- **The intro** sits under the site's navbar in a box as tall as the screen leaves, scrolling
  inside, with Start first rather than last. The keyboard help becomes three lines about thumbs.
- **Small screens** (`max-width` or `max-height` 480 px): the dialogue is a sheet along the bottom,
  full width, scrolling, with 44 px rows; the journal, HP bar and headings shrink; the small
  buttons (🔊, `~`) move to the top, the bottom corners being the thumbs'. Landscape (375 px tall)
  shrinks the stick and buttons and hides the journal's history lines.

**It installs** (owner, Oct 2026: "it should be a PWA too"): `pwa="rpg"` on both pages, scope
`/apps/rpg`, *Wanderer* / *Wędrowiec* under a sword-on-glass icon, a precache tier of its code
(see `pwa.md`). Installed, Safari's bars are gone and immersive mode really is the whole screen;
every inset is read through the site's `--safe-*` properties, so the notch and home bar can be
faked from a desktop console. Offline, an install that has been played once runs the
hand-written quest with every model in place.

Tested in Playwright's `iPhone SE (3rd gen)` profile, both orientations, driving the stick and the
look with CDP touch events; the swiftshader renderer there is slow, so walking covers less ground
per second than on a phone.

## Everything the game waits for is on screen

The game is in active development and the owner wants to watch it work (Oct 2026: "show the
tokens streaming, show the errors, the cost of the quest, the total time"). So:

- **`~` opens the developer console** (`components/Rpg/DevConsole.tsx`, also the `~` button):
  every model request of this quest with the model asked and the one that answered
  (`modelVersion` — the `-latest` aliases resolve, e.g. `gemini-flash-latest` was `gemini-3.8-flash`
  in Oct 2026), status, time, time to first byte, the last lines of its thoughts and of its answer
  as they stream, its error, tokens and cost; the ElevenLabs clips behind a checkbox; and the quest's
  totals along the bottom.
- **The waiting screens show the stream**: the last few lines of what the model is writing, and the
  models that already failed for this beat, under "Losy się ważą…" and the opening's overlay.
- **The closing screen says what the quest cost**: the writing time (each beat's generation, added
  up), tokens and their price, ElevenLabs characters, credits and price, and the total.

The record behind all three is `utils/rpg/devlog.ts`, cleared when a quest starts; prices are in
`utils/rpg/cost.ts`, list prices as of Oct 2026 and marked approximate. Thinking tokens are billed
as output. ElevenLabs is credits (`eleven_flash_v2_5` is 0.5 a character, or the response's own
`character-cost` header when the browser may read it), priced at the Creator plan's rate. A model
missing from the table shows `?`, never a guess. A new kind of request the game waits on gets a
`startRequest` too, so this stays the whole picture.

## Debugging

`window.rpg.scene` (`teleport('marker' | 'npc' | 'spawn')`, `facePosition()` toward the marker,
attack, interact) and `window.rpg.state()` (beat, progress, history, ending, chronicle, busy) exist
for driving a whole quest from a test or the console without a mouse.
