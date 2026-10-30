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

## Every new game is a new world

Since Oct 2026 (owner: "a truly random world, unlimited: maybe a futuristic techno-utopia, maybe a
water world, maybe a space one; no catalogue to draw from but a method on the LLM and temperature,
more exotic than typical medieval DnD fantasy; no franchise, only its feel"). The Witcher village is
now one world among endless ones: **Kraina Wierzb / The Willowlands** (`classicWorld`), which plays
when there is no key, offline, and as the way out of a failed genesis; its id is the language, so
old chronicles stay where they were.

**How a world is drawn** (`utils/rpg/genesis.ts`, `seedWords.ts`). A model asked for "a random
world" at any temperature writes the same four worlds. So the randomness comes from outside: three
**seeds**, two words from ~400 unrelated things, processes and feelings and one random Wikipedia
title (`drawSeeds`, a word instead when Wikipedia does not answer in 2.5 s), which the prompt says to
transform, never use literally. The model writes **four candidates** at `GENESIS_TEMPERATURE` 1.35
(OpenAI caps at 1.2), each with its own `typicality` 0–100, told to make them differ from each other
and from the worlds this browser already had (`pastWorlds`, the last 8, as "avoid"). The game, not
the model, picks: one of the two nearest the slider's target, the coin drawn before asking (`nth`)
and applied by the model as a rule, because **only the picked one is written out**: the four are a
sentence each (`candidates`), then `chosen` and the whole bible (`world`). Names from a franchise list
(`franchised`, Polish inflections included) disqualify a candidate. `parseWorlds` still reads the old
four-bible shape (`worlds`), which a demo function deployed before 27 Oct 2026 writes.

**The start is quick** (owner, 27 Oct 2026: "about two minutes pass before the game is ready — a
faster model, the asset descriptions before the whole bible, a smaller bible, less thinking"). Measured
from the records that day: the genesis 65 s on Pro (5.4k thinking tokens, 3.5k answer, three of the
four bibles thrown away), then the opening beat 53 s on Pro (5.9k thinking), one after the other; and
fal.ai started only once the whole world was in. Benchmarked on the same prompts (`gemini-3.1-pro-preview`
/ `gemini-3-flash-preview`, thinking high / low): old genesis 72 / 48 / 29 / 20 s; opening beat 45 / 33 /
22 / 10 s; output streams at ~130 tokens/s on Pro and ~190 on Flash, so the answer's length is as much
of the wait as the thinking. Four things, each kept:
- **One world written out** (above): ~1.2k tokens instead of 3.5k.
- **The world and the opening on `FAST_MODEL`, thinking `low`** (`quick` in `storyteller.ts`,
  `thinkingConfig.thinkingLevel`; the demo passes `thinking` and its function sets the same). The
  model picked in Settings stays first in the chain for every later beat, which is written while the
  hero walks and talks, and the fallback after the fast one. A Settings checkbox, *Szybki start*,
  turns it off (localStorage `rpg-fast-start` `'0'`). Measured after: the genesis 7.6–9.4 s in five
  runs, the opening ~10 s.
- **The hub's makings come first in the bible** — look, landmark, terrain, sizes, kit, then the words
  — and `previewWorld` reads them from the stream (`partialJson`: everything before the last comma
  outside a string, brackets closed) the moment the kit is whole, under the id the finished world will
  get (minted per model's turn, so another model's world never inherits them). `createWorld` starts
  the ground and the hub from it (`startWorldAssets`); what arrives before the world is saved waits in
  `earlyRef` and is put on it at birth (`withEarly`), and the effect that asks for the rest finds the
  same ids in flight. On Flash the preview comes ~6.5 s after the click.
- **Flash at low thinking sometimes closes the object and keeps writing `}`**, so both JSON readers
  fall back to the first balanced object (`firstObject`).

**A new world starts on an empty board** (owner, 30 Oct 2026: "the old things are still visible
before the new ones appear — there should be an emptiness in which the new things appear as they are
generated"). `createWorld` clears the last world's places, people, clues and marker at the click, and
the scene draws `shown`: while a world is invented, its preview with whatever fal.ai has made for it
so far (`earlyRef`, `withMade`, re-read on `earlyMade`), and nothing before the preview. The preview's
sky is applied the moment it comes, its layout stands, and its ground, models and hero appear behind
the genesis screen one by one.

**The loop never stops drawing** (same day: "there is a joystick but I cannot move, a half-generated
freeze"). A hero who is `wait` has no body, and the capsule's bob read `player.children[0]` — so
from the click on *New world* until the world's hero had loaded, `update` threw on every frame, before
the render: the canvas kept the old world's last picture while the HUD went on over it, the new
quest's objective included. Each step of the loop now runs in `step`, which reports a throw to
Sentry once (`rpg.frame.threw`) and still draws the frame.

**The console's Start tab** shows where the time went: from the click (*New world* or *New quest*),
when each awaited thing came (`markStage`: assets described, world ready, first step, ground, landmark,
first 3D model, whole hub), and a bar per request on one time axis — running striped, failed hollow.
Above them, what is in so far against everything the start is making (`N/M`), the ETA, and the usual
time of each kind of task in this browser; the last stage, *everything in*, is when the panel below goes.

**The corner says what is still coming and for how long** (owner, 27 Oct 2026: "instead of 'the
storyteller is writing a quest' it should say the world is being generated; I'd like to know whether
what I see is already everything, and roughly how long it takes"). `WorldProgress` (in
`DevConsole.tsx`) sits at the top of the journal, and on the genesis screen while that runs: a
headline with the time left (*Generuję świat · zostało ok. 1 min 20 s*), a bar, and a row per kind
of work — the world, the quest's first step, the ground, the hub's 3D models `n/N`, the quest's own
places and things — each ✓, ⏳ (running), … (waiting) or ✗, never colour alone. Once all of it has
come it says *World ready — this is everything* with the total time for 10 s and goes. The tasks
are built in `Rpg.tsx` (`progressTasks`) from what is already tracked: `creating`/`generating`, the
world or the genesis preview (`previewRef`; before even that, every `HUB_SLOTS` assumed), what fal.ai
has in flight and whether it has its turn yet (`falPending`, `turnSince` in `landmark3d.ts`), failed
slots (`hubSlotFailed`, `groundState`), and the console's finished `clue`/`place` requests. The time
left (`utils/rpg/progress.ts`, `remainingMs`) simulates the three lines: the world then the opening,
the ground, and the models six at a time (`FAL_RUNNING`, what fal ran at once for the account)
with each queued one on the first free worker; each task's length is its usual one, an average kept
in localStorage `rpg-typical` that moves a third of the way on every measurement (defaults 12 s
world, 12 s opening, 4 s ground, 25 s a model). A model's usual time leaves out its wait in fal's
queue (`LandmarkModel.queuedMs`), and it counts as running only once fal has given it a runner
(`turnSince`), since the simulation already places the wait. The
first measured run (27 Oct, dev, Flash): 2 min 40 s estimated at the click, 3 min 9 s to the last of
15 pieces.

**fal.ai's concurrency is fal's to limit, not ours** (owner, 27 Oct 2026: "the world could generate
faster with parallel calls, but are there limits?"). An account runs 2 requests at once when new
and up to 40 self-serve as its last four weeks of invoices grow, across all endpoints; over the
limit the queue (`queue.fal.run`, the meshes) holds a request and never refuses it, while the
synchronous `fal.run` (the pictures, the ground) answers 429 `concurrent_requests_limit`, which
`drawImage` asks again after 1, 2, 4, 8, 16 s. So `PARALLEL` only bounds what a tab has open.
Measured on the owner's key, ten pieces of a world: **113 s four at a time, 63 s all at once**,
sixteen at once 62 s, fal running 6–7 meshes at a time and holding the rest, nothing refused. The
cost is the same either way; a refused key now spends ten free 403s instead of four before it stops.
The toast at a new world's first quest says the same (`buildingWorld`); a new quest in an
old world still says the storyteller is writing.

**A slider from classic to exotic** (owner, Oct 2026, a day later: "we overdid it, it is too
exotic; a slider, typical RPG worlds on the left, the exotic ones on the right"). Under the start
buttons, 0–100, kept in localStorage `rpg-exotic`, starting at 35 (`DEFAULT_EXOTIC`), its band said
in words because the owner's phone is black and white. It goes in as `GenesisContext.exotic` and
picks one of three prompts — under 34 a classic RPG setting (elves, knights, dragons welcome) with
the seeds as mere flavour, under 67 a familiar genre with one twist built from the seeds, above
that the anything-goes prompt — plus the typicality the candidates aim at and the pick lands near
(`typicalityTarget`, 85 down to 5) and the temperature (`genesisTemperature`, 0.9 up to 1.35). The
demo takes it too.

**Or the player says what the world is made of** (owner, Oct 2026: "a dropdown to pick the seed
words, and typing your own — hat, sand, revolver makes a Wild West — or just a field for a prompt").
Under the slider, folded until something is chosen (`WorldWish.tsx`, kept in localStorage
`rpg-wish` by `utils/rpg/wish.ts`): a `<select>` of ~110 world-pointing words in the game's
language (`PICK_GROUPS` in `seedWords.ts`, not the dice list, which is English and meant to be
unreadable), a field for typed words (commas split them; 6 at most, 40 characters each), and a
description of up to 600 characters. Any of them replaces the dice: the words go as the seeds with
`chosen: true`, the description as `wish`, and both switch the genesis to `playerLines` — the
description is the premise, chosen words are **meant**, read together as the genre they point at and
plainly present, never "transformed, never literal" as dice are. The slider still applies, as how
far from the stock version of what was asked to go. The description is fenced in dashes and the
prompt says instructions inside it are only description. The demo takes both (`demoGenesis` cuts
them) and accepts a world with a wish and no seeds.
Asked-for worlds also aim the candidates and the pick nearer the familiar (`typicalityTarget(e,
true)`, 90 down to 30): the first try of hat, sand, revolver at the default slider came back as four
strange deserts and not one western.

**The world bible** (`WorldBible`): name, pitch, tone, tech, climate, people, architecture,
threats, who the player is and how they are addressed, the hub settlement, a few words people use,
and the **look**. It goes into every beat's prompt (`worldLines`): the player is "the hero" and is
whoever the bible says, quests start in the hub, and everything is told to belong to this world.
Kept in localStorage `rpg-worlds` per language (`worldSave.ts`); the chronicle and the autosave are
keyed by its id. **Start** continues the current world with a new quest; **🎲 New world** makes
another. The genesis waits on screen (`.rpg-genesis`, the seeds and the stream), because nothing can
be drawn or written before the world exists. A failure is the retry panel, with the Willowlands as
the other button. The demo has `{kind:'world'}` too, with the prompt built on the server from
`demoGenesis`; `genesis.ts` is compiled into the function, so it is in `firebase-deploy.yml`'s
paths. Each genesis is `rpg.world` in Sentry Logs (`rpg.world.failed` an error) and a JSON under
`users/{uid}/rpg/worlds/` like the beats.

**The look** (`WorldLook`, `components/Rpg/atmosphere.ts`) is how one village of Quaternius pieces
becomes any world with no new model: sky, fog, sun, ground, foliage, wall, roof and accent colours;
time of day (sun height and strength, stars at night); the sky (`Sky`, a dome that follows the camera, painted in the shader from those colours rather than from a picture: the horizon is the fog's colour so the land meets it with no seam, the zenith a deeper sky colour, the sun or moon a disc with its glow where `sunOffset` puts the light, and drifting fbm clouds, more of them in thicker haze and in rain, snow or ash — no request and no download per world); haze (fog distance); weather (rain, snow,
ash, spores, sparks — one `Points` box that wraps around the player); water (`flooded` is a water
plane with the village on a disc of land); growth (how much ground cover); flora (the kit's pines,
broadleaf or dead trees, or primitive fungi and spires, or none). The kit's textures are
**recoloured in the shader, not tinted**: their lightness is painted in the world's colour
(`recolor`), because multiplying purple into green leaves made mud. `parseLook` lifts every colour
to a floor of brightness (`lift`), since the models do paint worlds in #000000.

## The world grows

Owner, Oct 2026: "after the first quest the characters and locations stay, only someone new appears
with a quest; we can walk the old places a bit, but mostly new ones, in new places". Every place a
quest built and every person met — where they stand and the last thing they said — goes into the
world's **atlas** (`worldSave.ts`, localStorage `rpg-atlas`, keyed by world id, re-parsed on load),
written with the autosave and at the ending. A new quest, or a resumed one, starts with the atlas
standing (`restoreAtlas` in `Rpg.tsx`): the places rebuilt, the people back on their spots and
saying their last line. The prompt lists them all (`ctx.places`, `ctx.characters`, and
`PEOPLE ALREADY IN THIS WORLD`), asks for a new quest giver usually and for new places mostly, in
directions and distances nothing stands at yet. Room for it: a third ring at 125 m, the map grown
to ±160 m (ground cover kept on the old ±115 m, for phones), `ATLAS_PLACES` 16 and `ATLAS_PEOPLE` 24,
the newest kept; the demo accepts as many. A new world starts an empty atlas, and only the worlds
still being played keep theirs.

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
The journal says what is being written (the opening as a row of the start's progress, below;
a later beat `⏳ Losy się ważą…`) with one line of the stream under it (`StreamLine`), and the world never pauses for it. `questTokenRef` is
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

**Places and characters accumulate, for the quest and then for the world** (see *The world grows*
below). Every place a beat names stays standing (`RpgScene.addPlace`); a beat may return to one by name, or a talk beat may be
in the village. A new place that would overlap one already standing is moved to the nearest clear
slot (`freeSlot` in `place.ts`, centres ≥ 50 m apart). Characters stand on spots in the square or
just inside their place, stay put after their beat, and say their last line if talked to again; a
beat may bring one back by name, and `parseBeat` keeps their gender and clothes. The beat's own
character is the one the marker points at once the job is done.

**The chronicle is what outlives a quest** (`utils/rpg/chronicle.ts`): each finished quest's title,
decisions with their one-sentence consequences, and epilogue, in localStorage per game language,
the last 8. The last 5 go into every beat's prompt as "the world remembers" — as the world's past,
not the quest's plot (see *A quest is its own story* below; until 28 Oct 2026 every beat was told to
refer to one of them, and every quest read as a sequel). Shown on the intro screen with a button to forget it. Not on the
account yet; following the reader between devices is a Firestore document for later.

**A beat that fails waits for the reader** (owner, Oct 2026: "I would like to be able to retry",
under a quest ended by Safari's "Load failed"). A panel says why, with `↻ Spróbuj ponownie`, which
asks the whole model chain again, and the old outcome as the other button: the hand-written quest
(two beats: the alderman, then the fisherman at the lake with two endings) for an opening, or the
end of the quest on the decision just made, still into the chronicle, for a later step. The world
pauses under it, so a desktop gets its cursor back. No key is not a failure and plays the
hand-written quest at once. Leaving to the intro with the panel up loses nothing: the decision is
saved and Continue asks again.

## A quest is its own story, in a tone of its own

Owner, 28 Oct 2026: "old places don't disappear, a new quest may use them but doesn't have to; the
dead stay dead and no new characters get old characters' names, so nothing is confused. A new quest
shouldn't be a strict continuation of the last; it may cross it, but rather rarely — the same place or
the same person. And not every quest needs a deep moral choice: there can be simple, easy, light
quests that show the world, and funny ones." Every quest had been a grey dilemma that "refers to at
least one of those deeds", because the prompt said both. So, as with the jobs, **the game draws and
the model is told** (`drawMood` in `quest.ts`, once per quest in `startQuest`, kept in
`SavedGame.mood` and sent to the demo as `BeatContext.mood`):

- **A tone** (`TONES`, weights 25/20/25/30): `light` (a small warm errand that shows the world's
  everyday life; no dilemma, nobody dies, foes are pests), `comic` (absurd problem, ridiculous
  people, a punchline; nobody dies), `adventure` (danger and wonder, decisions are approaches —
  bold, clever, careful — not dilemmas) and `grim` (the old "real choices with a cost" and "moral
  greyness", which only it still gets). `TONE_LINES` replaces the one line every quest used to get,
  and the inspiration comes from the tone's own list (`seedFor`; `SEEDS` is the grim one's — a
  grieving widow does not start a comedy).
- **A tie to the past** (`TIES`, 65/20/15): `fresh` — the chronicle may show in a passing remark,
  nothing built on it, the opening npc someone new; `place` — one step passes through a place from
  before this quest (the prompt names those, i.e. the places no step of this quest has been to);
  `person` — one living person already met takes part, with a new trouble of their own. A tie is
  drawn only to what the world has (no places, no `place`). Every quest is told it is NOT a sequel.
- **Old places stay standing either way** (the atlas, above), listed to every beat; untied, the
  prompt says they are never required, and a place this quest itself built may always be returned to.
- **A name is one person's** (`NAMES ALREADY TAKEN`, every living and dead name): a new character
  never takes one, nor a first name or surname from one. `parseBeat` enforces the half it can: an
  npc or witness whose name is inside a known one's or the other way round (`samePerson`, the rule
  `isDead` uses) *is* that person — "Takeda" next to "Ronin Takeda" is him, with his clothes and
  voice, not a second Takeda; a witness that collapses into the npc is dropped. Dead names were
  already refused (below). Two people sharing only a surname are not caught.
- **In the console** the beat's headline says `beat 1 (comic · fresh)`, the prompt under it has the
  lines, `window.rpg.state()` has `mood` and `dead`, and Sentry Logs `rpg.quest` carry `tone`/`tie`.
  A quest from before it has no mood and is written as a grim one of its own.

## A meeting is with whom the hero went to meet

Owner, 28 Oct 2026: "first Tiago says to talk to his friend, then we go there and it's Tiago again,
saying something else". In the elders' cave Tzola was the npc and Tiago the witness; Tiago said "my
friend from the tribe knows more", and the decision "I'll find your friend on the outskirts, Tiago"
was answered by Tzola, as every decision is. The next beat was told only Tzola's story and that
decision, read it as "Tzola's friend Tiago", and wrote Tiago waiting in the swamp.

- **A step passes on what else was heard** (`StepRecord.heard`, `heardAside`): the witness's greeting
  and answers once spoken to, and the follow-up questions asked, as `Also heard there:` in the
  history. Its story is kept to `SITUATION_MAX` (700; it was 300, which cut the elder off mid-word).
- **A decision that leads to a talk says whom** (`Decision.meet`, `{name?, who}`): `name` only for
  someone already met (resolved to their exact name), otherwise a description of someone new. The
  step carries it with its witness's name (`StepRecord.meet`, `witnessName`), and the talk beat's
  prompt says who the npc is and that it is not whoever the hero just left (`talkNpc`).
- **`parseBeat` enforces the half it can**: a meeting with someone new whose npc is anyone already
  in the world is unplayable, and the next model is asked.
- **Decisions are said to the npc**: the prompt forbids addressing the witness in a label; one that
  follows up the witness names them in the third person and waits for them (`after: "witness"`).

## The dead stay dead

Owner, Oct 2026: "I killed Takeda earlier and here he suddenly is, and you can talk to him". The
second beat's job was to slay one foe, `targetName` "Ronin Takeda"; the last beat made "Takeda" its
npc. Nothing told the model: a `StepRecord` carried what was said and chosen but not what the hunter
*did* at the place, a target is not a `Character`, and a death said only in dialogue was nowhere. A
brother called dead in beat two came back as the witness in beat four the same way.

- **The world keeps a list of its dead** (`Atlas.dead`, also `SavedGame.dead`), by name, fed from
  three places: a slay job of count 1 (`slainBy` — a single foe is the one the story set the hunter
  on, a person or a beast), the beat's own `dead` (the model names whom its step tells is dead), and
  the chosen decision's `dies`. Groups ("4 × bandit") are not on it.
- **Every prompt is told** (`BeatContext.dead`, `THE DEAD` in `beatPrompt`), the living list
  leaves them out, and each history step says what was done there (`StepRecord.done`, `jobDone`).
- **`parseBeat` enforces it**: a dead npc makes the answer unplayable (the next model is asked); a
  dead witness is dropped. A name matches inside a longer one (`isDead`), because the model writes
  the target "Ronin Takeda" and the man "Takeda".
- **The scene buries them** (`bury` in `Rpg.tsx`, `removeNpc`): out of the crowd and the atlas's
  people, except whoever is speaking the ending that kills them.
- **An old save heals itself on resume** (`mendSave`): its dead are rebuilt from its beats
  (`deadInSave`), and a current beat not yet decided whose npc or witness is among them is dropped
  and written again from the decision before it.

## The model writes words and chooses blocks; the engine builds

The model **invents the places** (owner's choice of the first step towards fully generated
quests, Oct 2026). It still writes no geometry: `utils/rpg/place.ts` is the closed
vocabulary — a direction (8) and distance (`near` 50 m, `far` 85 m, `distant` 125 m) from the village, a biome (7),
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

**A place has a landmark** (owner, Oct 2026: "we have a mill, but it is only a round patch with
trees; if there is a mill, something that looks like a mill should be built"; low-poly is fine). The
model builds it like toy blocks: up to `MAX_PARTS` (36) parts, each a shape (box, cylinder, cone,
sphere, dome, pyramid, torus, wedge = a gable prism), a size in metres, where its middle is, a turn
and a lean, a material from the world's palette (`wall`/`roof` are the world's own, `glow` its
accent lit from inside, and wood, stone, metal, glass, cloth, water, plant, dark), an optional
colour, and an optional `spin` axis — a spinning part's `at` is its middle, so a mill's two sails
share one and turn as a cross. `parseLandmark` clamps it all to 9 m around its centre and 24 m up.
The prompt's example is a windmill; Flash writes water mills with wheels and lighthouses with a lit
lantern from it. `components/Rpg/landmark.ts` builds it 15 m behind the place's middle, away from
the village (`LANDMARK_SETBACK`), front toward the hero; the place's features give way inside its
footprint, the targets are moved out of it (`keepOut`), and ground-level parts block walking as a
row of circles along their long side.

**The model writes middles; the game keeps bases.** The prompt asked for each part's base and the
model sometimes wrote middles anyway, consistently, so a hut on stilts stood 1.5 m up with its
walls floating over the platform (owner's screenshot, Oct 2026). Models place a block by its
middle unprompted, and the example mixed both (the sails were middles). So the prompt now says
middles for every part, and `placeFromMiddles` (`place.ts`) moves each non-spinning part down by
half its height along its own up, once, when the model's answer is read in `beatPlace`. Stored
worlds, the demo's context and `landmark.ts` all still mean the base, so nothing saved needed a
migration — do not call it anywhere else, or a part sinks by half its height.

**And whatever touches nothing falls** (`settleParts`, `place.ts`, run by `buildLandmark`). Middles
fixed the blocks a model stacks straight, not the leant ones: a long house's burnt roof, a 10 m
wedge tilted 20°, hung with its low edge 1.4 m over the floor and its high edge past the pillar
tops (owner's screenshot, 21 Oct 2026; the beat's record has the model's exact numbers). Where a
tilted slab's lowest corner lands is trigonometry the model does not do. So each part is an
oriented box, and one whose box meets no other part's and stands off the ground is lowered,
bottom-up, until it meets the first thing below it. Anything touching stays as written — a roof on
its walls, a chimney in its roof, a banner on its pole — and spinning and glowing parts never move.
On six fresh landmarks (Oct 2026) it moved two struts 5 cm and one loose sail 0.6 m, and nothing
else: it corrects mistakes, it does not redesign. At build time, so saved worlds are settled too.

**The hub is built from real models, from fal.ai** (owner, Oct 2026: "something in the starting
location that sets the mood of the generated world — as cheaply as possible; quality may suffer";
then, 26 Oct, once the landmark worked: "now the whole starting location from the assets").
`utils/rpg/landmark3d.ts`: FLUX.1 [schnell] draws each piece alone on white at 512² (~1–10 s,
$0.003 — fal bills by the megapixel rounded up), TRELLIS makes that picture a textured GLB through
fal's queue (25–80 s, $0.02; 512 px texture). About **$0.023 a model**, against ~$0.60 on Meshy.
Both are called from the browser on the reader's own key; fal's CORS answers korczak.xyz.

- **Eight models a world, ~$0.18, once** (`HUB_SLOTS`): the `landmark` in place of the well, a
  `house` on the three small plots and a `hall` on the two large ones (one model each, cloned —
  the clones share geometry, so five houses are two uploads), five `tree`s inside the fence where
  the houses leave room, the `stall` and the `cart` where the kit's stall and wagon stand, four
  `lamp`s around the square between the paths in, and `goods` where its barrels and crates are.
  A world whose flora is `none` makes no tree. All asked for at once (`PARALLEL`, 12) and the
  landmark first; each replaces what stood there the moment it has loaded, so the
  village changes a piece at a time. Fence and bench stay the kit's; the ground cover is the world's
  own too (below).
- **The prompts are English**: genesis writes the `landmark` and a `kit` line per piece (at most
  18 words each) in English whatever the world's language, since an image model reads Polish badly.
  A world from before them is described from its hub, architecture, tech and flora
  (`fallbackSubject`). The world's colours go in as hex. Buildings are drawn front-on with their
  entrance toward the viewer, because TRELLIS keeps the picture's front as +Z and the scene turns
  +Z to the square; every piece is asked for chunky, with no thin parts — a lamp on a slender pole
  came back as a lantern and a hook, the pole gone — and with no shadow, which TRELLIS made into
  a dark slab under a pile of crates.
- **Triangles**: the landmark keeps `mesh_simplify` 0.95 (~10–17k triangles, ~700 KB); every other
  piece 0.98, the most TRELLIS allows — a house was 36k triangles at 0.96 and 12k at 0.98, a lamp
  3k, a tree ~15k. The whole hub is ~150k triangles, against the 0.55–0.9 M a frame already draws.
- **Made once per world, never again.** Each result is kept on the bible (`landmarkModel`,
  `kitModels`, `setWorldModel` in `worldSave.ts`), so it syncs with the world and no device asks
  twice. Every request asks fal to keep its outputs (`X-Fal-Object-Lifecycle-Preference`, no
  expiry), since the URL is the cache; the GLBs' bytes are also in the Cache API (`rpg-landmarks`).
  One generation per world and slot at a time, a slot made this session is never asked again even
  before the world's state has it (`made` — the effect ran between a model's arrival and its
  `setWorld` and asked for three pieces twice, Oct 2026), a slot that failed is not asked again
  until a reload, and a 401/402/403 stops the world's remaining slots before they spend anything.
  **"Failed" means three tries** (`withRetries`, `PIECE_TRIES`; owner, 28 Oct 2026, a world ready
  with "4 nie wyszło": "was there a retry?" — there was not, only FLUX's 429s were waited out). A
  piece that throws is asked again from the picture after 3 s and then 10 s, unless the key was
  refused (401/402/403) or the request aborted; the hub's models, the quest's places and clues, the
  ground and the ground cover alike. Each try is its own pair of rows in the console, marked
  `retry 2/3 ·`, so the failure that caused it stays readable above; the progress panel keeps the
  piece ⏳ until the last try has ended.
- **And the forest** (owner, 26 Oct 2026: "generate the world's trees — now they are static
  assets"). The ~400 trees across the map were the kit's, in the world's flora; now they are the
  hub's `tree` model and two more of its kind made after the hub, `tree2` a young one and `tree3`
  an old one (`FOREST_VARIANTS` in `genesis.ts`, described from the `tree` line, so genesis writes
  nothing more): **$0.046 more a world**, and the first is already paid for. `RpgScene.setForest`
  plants them mixed as the kit's three were, each as it arrives, at the size the world gives its
  tree (`sizes.tree`, else the kit's 7.4 m) times 0.7–1.6, and places' pines and dead trees
  take them too; until then, and in the classic world, the kit's. A world whose flora is `none`
  makes none of the three.
  - **Simplified in the browser** (`loadForestTree`, `hubModels.ts`, meshoptimizer): TRELLIS's
    0.98 still leaves 4–30k triangles a tree, and ~60 stand in view, drawn again for the shadow. Each
    is taken to 2,500 (`FOREST_TRIANGLES`) in 25–200 ms, once a session. It needs `Permissive`:
    TRELLIS cuts its texture into hundreds of islands, and a simplifier that keeps every island's edge
    stopped a leafy crown at 9–16k whatever error it was allowed. In a dead-tree world the frame went
    from 1.65 M to 1.06 M triangles with the forest in.
  - **A tree is asked for a solid silhouette** (`hubModelPrompt`: "a few thick limbs and one solid,
    compact silhouette, no twigs"): FLUX draws dead trees with a hundred bare twigs whatever "chunky"
    says, and TRELLIS made two of three such pictures into a flat card or a cylinder with the picture
    on it — planted four hundred times. With the line, four kinds of tree all came back as trees.
    Nothing checks a model's shape after the fact, so a world that did get a card keeps it.
- **And the ground** (owner, 27 Oct 2026: "the ground texture should be generated too; now it seems
  to be always grass"). The one Poly Haven scan, dyed the world's ground colour, read as grass in a
  desert, in snow and on a scrapyard alike. Now genesis writes `terrain` (English, ≤14 words, a
  material up close: "wet black mud with puddles", agreeing with growth, weather and water), and
  `utils/rpg/groundTexture.ts` has FLUX.1 [schnell] paint it from directly above at **992²**, the
  largest square fal still bills as one megapixel: **$0.003 a world**, ~1 s. A world from before is
  described from its weather, growth, water, climate and ground colour (`fallbackTerrain`).
  - **Tiled in the browser, not by the model** (`seamless`, `surfaces.ts`): FLUX asked for
    "seamless" stops its cracks dead at the edge, a grid of seams across the map. Each edge is
    crossfaded (35% of each half) into the picture rolled by half, across then down, so it wraps with
    no seam and a faint double image along the band; `breakTiling` still hides the repeat.
  - `RpgScene.setGroundTexture` lays it at the scan's tiling (96×, ~3.75 m a tile) and **undyed**
    (`recolor` 0), since it is already the world's colour; the flooded world's island shares the
    material. Kept on the bible (`groundTexture`, `setWorldGround`), bytes in the Cache API with
    the GLBs (`loadLandmarkBytes`); up to three tries per world a session (`withRetries`), a
    failure not asked again until a reload. The classic world and a reader without a fal key keep the scan. In the console as kind
    `fal` labelled `ground`, counted as `N× tex` beside the 3D models (`falTextures`), its price in
    the fal.ai total and the closing screen's; Sentry Logs `rpg.landmark` with `piece: 'ground'`.
- **And what grows on it** (owner, 27 Oct 2026, a screenshot of a misty night world with the kit's
  ferns and grass tufts on it: "the locations still use grass and plants read from the assets, not
  generated, and they don't fit the location or the world"). The ~2,900 tufts were the kit's
  meadow, tinted. Now genesis writes `cover` (English, ≤14 words, what grows or lies on the open
  ground, knee-high at most, or `none`), and `utils/rpg/groundCover.ts` has FLUX.1 [schnell] draw
  three clumps of it alone on white at 512² — a low wide one, a taller one, a striking one
  (`COVER_KINDS`) — all three at once: **$0.009 a world**, ~1 s, beside the ground. A world from
  before is described from its weather, growth, climate, terrain and foliage colour; `none`, a
  barren or a flooded look asks for nothing.
  - **Pictures on crossed quads, not models**: a TRELLIS model per tuft would be $0.02 and a minute
    each and thousands in view. `RpgScene.setGroundCover` plants each kind as it arrives (4,000 /
    1,500 / 700, 0.4–1.3 m, per 48 m cell like the kit's, thinned by growth like the kit's), eight
    triangles a tuft: two quads crossed, each face both ways round with its normals up, since a
    double-sided back face turns its normal down and goes dark. Alpha-tested, no shadow cast.
  - **Cut out in the browser** (`cutOut`, `surfaces.ts`): the background flood-filled from the
    edge, then the nearly pure white the stems close in, then the two-pixel fringe *unblended*
    from the white (alpha from how far from white, white taken back out of the colour) — kept as
    drawn, a black weed's thin stems were mostly grey-on-white and the clump came out silver. The
    see-through pixels take the clump's average colour so the mipmaps bleed no white halo, and the
    result is pixels for a `DataTexture`, not a canvas, which forgets colour where alpha is 0. A
    picture whose edge is not mostly that white (FLUX drew a night sky behind a clump when the line
    mentioned one) is refused rather than planted as a card. Prompt: "nothing under it: no ground,
    no soil, no shadow" — without it FLUX stood each clump on a disc of soil.
  - The kit's meadow (`kitCover`) shows only with no layout — the classic village, or no key; under
    a layout the ground is bare until the world's own comes. Kept on the bible (`coverSprites`,
    `setWorldCover`), bytes in the Cache API; one try per world a session. In the console as kind
    `fal` labelled `cover`, counted with the ground as `N× tex`; stage `cover` on the start line, and
    a task in the ground's row of the start's progress;
    Sentry Logs `rpg.landmark` with `piece: 'cover'`.
- **An empty board until then, and nothing where it was predefined** (owner, 27 Oct 2026: "while
  the world is generated and there are no assets yet there should be an empty board, not
  placeholders; things should just appear as they become available, and where they stand should be
  generated, not predefined"). An invented world's village and forest are laid out by
  `utils/rpg/hubLayout.ts` from the world's id alone, so the same on every device and nothing to
  store: a style (a ring round the square, a street along one of the roads out, a cluster to one
  side, a scatter), how far it reaches (22–34 m), 1–3 halls, 2–6 houses, 1–2 stalls and carts,
  3–7 lamps round the square or along a road, goods beside the buildings, 3–9 trees, and a forest of
  280–460 trees partly in 4–12 groves. It keeps the square clear for the characters and the spawn
  (`VILLAGE_STANDS`, `SPAWN_AT`, `SQUARE_RADIUS`; the landmark alone may stand in its middle),
  buildings off the eight roads out (`roadDistance`), and every piece out of every other's
  footprint, sized by the world's own `sizes`. `RpgScene.setLayout` puts each model's copies on its
  spots and plants the forest there; a spot blocks nothing until its model stands. Under a layout
  **no kit piece stands at all** — no house, well, fence, bench, prop or kit tree, no primitive
  stopgap, not even the kit's grass — so the board is the bare ground, and the hub fills in a model at a time as each
  loads (`setHubModels`, `setForest`); while genesis runs the board is `EMPTY_LAYOUT`, so the last
  world's village does not stand behind the new one. A load already on its way to the same URL is
  left to finish (`hubWanted`): the world changes with every arrival and asks for all eight again,
  and restarting the loads each time kept the first models off screen for a minute.
- **The kit's village only where no model will ever come** (`setLayout(null)`): the classic world,
  and an invented world with no model made and no fal key to make them. Until the keys have loaded a
  key is assumed, so a reader with one never sees the kit flash up first. There what a model would
  replace is hidden, not removed, and the kit's houses are merged per kind (`mergeStatic`). A model
  that fails to load leaves its spots empty under a layout. Quest places still build their pines,
  rocks and huts from the kit only in the classic village; an invented world's places are bare (below).
- **A quest's place in an invented world is fal.ai's too** (owner, 27 Oct 2026, a screenshot of a
  space station's place with stone pillars, a stone wall of blocks, a campfire and a lake: "no
  procedural assets, only fal.ai's in the locations"). The beat writes a place's `assets` in English
  (`PlaceAsset`, `parseAssets`): its landmark once and one or two `scatter` things that stand around
  it many times over, each with a size; never a tree, ground or water. Under a layout `buildPlace`
  builds the place **bare**: its ground disc and nothing else — no feature (pillars, rocks, graves,
  campfire, water, huts, mushrooms, stones), no landmark of blocks, no kit tree. `pines` and
  `dead_trees` only say where the world's own trees stand, planted when the forest comes
  (`plantPlaceTrees`); the landmark stands where the blocks would have (`landmarkSpot`) and the
  scattered things on free spots of the ring (5–12 copies by size), each put up when its model loads
  (`setPlaceModel`), blocking nothing before. `ensurePlaceModel` makes each piece once (~$0.023,
  label `place` in the console, counted to the quest); `putPlace` in `Rpg.tsx` keeps it on every
  copy of the place (the quest's list, its beats, the atlas: `updateAtlasPlace`). A place from before
  `assets` gets a landmark from its name and the world's architecture. The block landmark and the
  features are still asked for and still drawn in the classic world and without a key.
- **And the things to gather** (owner, 27 Oct 2026: "the things to pick up should be generated
  assets too"). A collect beat writes `targetProp` in English (`BeatJob.prop`); `ensureClueModel`
  makes it once (`cluePrompt`, its name for a beat from before) and it is kept on the beat's job
  (`job.model`) like a clue's. In an invented world with a key the things are nothing until it comes
  (`spawnObjective`'s `item.wait`; an invisible thing cannot be picked up), then every one of them is
  the model (`setItemModel`), floating and turning as the block did. A model that fails, or no key,
  puts the block back, so the step can always be done.
- **Each piece is sized as what it is, not as its slot** (owner, 26 Oct 2026, a screenshot of a
  caravan world's covered truck towering over the hero). TRELLIS answers in a unit box, so the size
  is wholly the game's, and `HUB_FIT` gave every slot a building's: a "house" that was a truck came
  out 6 m tall. Genesis now writes `sizes` beside the `kit` — each piece's real height and longest
  ground length in metres, "next to a 1.8 m person, truck-sized if it is a truck" — clamped per slot
  to sane values and to the room its plot has (`HUB_SIZE_LIMITS`), and `hubFit` uses them, with
  `HUB_FIT` only for a world that has none. A world from before asks once (`generateHubSizes`, a
  short request on the reader's own model, in the console like any other; not on the demo, whose
  function builds only beats and worlds) and keeps the answer on the world (`setWorldSizes`). Sizes
  arriving after the models reload them from the Cache API (`hubWanted` is the URL *and* the size).
- **Height is the anchor, and a little over it** (owner, 28 Oct 2026: a stall shorter than the
  hero next to a huge tree, "rather a touch too big than too small"). `fitScale` used to take the
  smaller of the height's and the length's scale, so an awning, eaves or shafts reaching past what
  the model called the thing's length shrank the whole piece. Now the height decides — the number a
  model judges best against a 1.8 m figure and the one the eye compares to the hero — times
  `SIZE_BIAS` (1.1), and the length only caps a mesh that came out more than `WIDTH_SLACK` (1.5×)
  wider than described. This is the Holodeck-style rule (one metric dimension from a language model,
  the asset's own proportions for the rest). The sizes are asked for as the box the mesh is fitted
  into (highest point, whole footprint with overhangs), with reference sizes in the prompt (a door,
  a stall, a cottage, a wagon, a tree: category priors, `SIZE_RULE`) and "err larger"; the places'
  `assets` prompt says the same in one line. `HUB_SIZE_LIMITS` has floors a person fits under (a
  stall 2.6 m, a house 3.5, a hall 4.5, the landmark 3.5) and `hubFit` clamps again, so a world kept
  with older sizes stands at today's. Same rule for places' pieces, the forest and the things to
  gather (all go through `loadHubModel`/`loadForestTree`).
- **TRELLIS writes no metallic factor**, which glTF means as fully metallic, and with no environment
  map that renders black; `hubModels.ts` sets metalness to 0.
- **In the console** as two rows per piece (kind `fal`, labelled `landmark`, `house`, `tree`…), with
  the prompt, the picture and the GLB's URL, time, error and price, and **fal.ai** has its own
  total beside the tokens and ElevenLabs, with how many 3D models it made (`falCost`, `falModels`).
  A step still running survives the console's reset at a new quest. Sentry Logs: `rpg.landmark`,
  `piece`, outcome, ms, `costUsd`.

The dialogue is a menu of lines the beat already contains, not a chat: talking costs no request;
deciding costs one. The one exception is a line the reader types, below.

**The hero may say it in their own words** (owner, 29 Oct 2026: "add a free-text option to the
dialogue options"; `utils/rpg/freeLine.ts`). Under the decisions, where they are offered and only
there, a field takes a line of up to `FREE_MAX` (200) characters, and one short request
(`generateFree`) answers it as the character. The model says what the line was:
- **talk** — a question, a remark, a joke: the character answers, the conversation goes on (`↵`
  again, or Back), and the exchange is passed on with the step like a small-talk answer
  (`heardAside`'s fourth argument, `SavedGame.freeTalk`).
- **a decision**, and the player steers the quest by it (owner, 30 Oct 2026: "with free text there
  should also be a way to steer the quest further, not only to chat and ask"). A plan of the hero's
  own ("first I'll go to the smith's wife", "I'll search the reeds for what draws them") is a
  decision even phrased as a question. Its `lead` is an offered decision's number when it is that
  one, or for a course of its own a kind of step (`ownLeads`): slay, collect or talk wherever the
  quest goes on here, `end` only where an offered decision ends it; the count is still `pickJob`'s.
  The step carries `own: true`, and the next beat's prompt says THE PLAYER STEERED THE QUEST: carry
  out what the hero said, bend the story to the plan and not the plan to the story. The reply,
  consequence, `dies` and `meet` are the model's. It is appended to the beat with
  `free: true`, so the autosave's `decision` index, `deadInSave` and `mendSave` find it as they find
  a picked one, and it is never offered as an option.

The prompt holds only what has been heard (the story, the clues examined, the witness and the
questions asked, earlier typed lines) and the same rules as a beat's: spoken, first person, audio
tags, no culprit nobody named. `parseFree` refuses narration and a route the beat lacks, and the
next model in the chain is asked. It is asked **from the browser even when signed in** (`local` in
`askChain`: a queued server job only delays a short answer the reader is waiting on), thinking
`low`, `FAST_MODEL` first when quick start is on, else the chosen model. In the console it is a
`model` row labelled `free line`, counted in the quest's tokens and generation time; a failure
says why under the field and keeps the text. **Not on the demo or without a key**: the demo's
function writes beats and worlds only, so the field is not shown there. Number keys and `~` are
ignored while the field has focus.

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

**A decision is an intention, not a conclusion, and it knows only what was heard.** Two cases in
one week (owner, Oct 2026):
- "Pay the brother's debts to the innkeeper" was offered when only the optional witness had
  mentioned the innkeeper, and nobody had mentioned the debts at all.
- "I'll search the burnt barn and find proof the blacksmith did it" was offered when nobody had
  named the blacksmith. He: it should be "I'll search the barn", and the rest should come out
  while searching.

So it is fixed twice over:
- The prompt says a label is what the hunter will do, never what it will uncover. The consequence
  too is what the hunter set out to do, since the next beat is where the truth is found.
- A decision that needs the witness, a clue or a small-talk answer carries `after` (`"witness"`, a
  clue's index, or `{ ask }` for a small-talk question; the model writes "clue 1", "question 2").
  `openTalk` offers it only once that has been heard: the witness talked to (`witnessHeard`), the
  clue examined, the question asked (`askedTalk`), all in the autosave. This is how RPGs do it
  (The Witcher 3, Mass Effect): an option exists only once the knowledge behind it does. The
  blacksmith came from a follow-up question that sat beside the decisions, so gating only the
  witness and the clues was not enough.
- At least one decision must need neither. `parseBeat` drops a gate on a witness or clue the beat
  lacks, and drops every gate if all of them wait, so a beat can always be finished.
- **The game gates by the words too, not only by `after`** (owner, 30 Oct 2026; `utils/rpg/unlock.ts`).
  The model forgets `after` as often as it sets it: in `rpgSaves/wmvtzzd421`, beat 2, "Zbiorę filtry i
  odczynniki do twojej odtrutki" carried none though only Suchy's answer to "Jak zamierzasz uratować
  tych skażonych ludzi?" spoke of the antidote, and "Zoya ma rację. Zawalimy to wejście" none though
  only Zoya's answer spoke of blowing the entrance — both on screen before either was heard.
  `decisionOpen` holds a decision back while a word of its label (first five letters, so Polish
  endings match; four-letter capitalised words count as names; a stop list for the rest) appears in
  nothing heard so far — this beat's greeting, story, the questions on offer, what was asked,
  examined, the witness once spoken to, typed lines, and every earlier beat (`knownBefore`) — but
  does appear in something still unheard at this beat. **Any** source that says it opens it. A word
  nobody says anywhere gates nothing. It is checked when the options are drawn, so saves from before
  it are gated too. Unlike `after`, it may leave no decision open until something has been asked:
  every source it waits for is reachable at the beat, so the beat can still always be finished.

**E reaches the nearest thing**, character, clue or thing to pick up (`nearestThing`): with a
witness and clues at a place, a character standing among the herbs swallowed every press.

**Every line is spoken, never narrated.** The prompt says so with a wrong and a right example
(Flash-Lite wrote "Helena weeps and says her daughter-in-law hanged herself" as Helena's own line,
owner, Oct 2026), and `narrated` in `quest.ts` throws away a beat whose greeting, story parts,
waiting line or replies open with the character's name as the subject or report their speech
("mówi, że", "says that") — the next model is asked instead. Decision labels are the hunter's
spoken line, at most 12 words.

**Every character has a personality type** (owner, 30 Oct 2026: "make the characters have a
personality type assigned, Jung/MBTI, or an archetype too, optionally"; `utils/rpg/persona.ts`).
One of the sixteen MBTI types, and for two in three of them one of the twelve Jungian archetypes
(Innocent, Sage, Jester, Ruler…). **The game draws them, not the model** — the same reason as the
jobs and the mood: asked to invent a personality, a model writes the same wise, wounded introvert.
`drawPersonas` runs per beat beside `planDecisions` (`BeatContext.personas`): one for a new npc, and
one for a new witness at least two letters away and never the same archetype, since the prompt
already demands the two never sound alike. The prompt (`personaLines`) describes each type as
behaviour you can hear (`MBTI_MANNER`: "quick and argumentative; plays devil's advocate…") and each
archetype as a drive (`ARCHETYPE_DRIVE`), asks for the voice, the lines and the reactions to the
hero's decisions to follow them, and forbids naming them — nobody says "as an introvert". `parseBeat`
puts the drawn persona on whoever is new (`Character.persona`), and on someone met before types who
comes back without one; anyone who has one keeps it for good, and `PEOPLE ALREADY IN THIS WORLD`
lists it beside their voice. The typed-line prompt (`freePrompt`) gets the npc's too. It crosses to
the demo's function in the context (`demoContext`, `parsePersona`), so `persona.ts` is in the
functions' tsconfig and deploy paths. **In the console**: a 🎭 line under each step in *Dialogue*
(the npc and the witness with their types), and a *People* tab with everyone met, type, archetype
and the voice the model wrote; a dash is someone from before 30 Oct 2026 who has none yet.

## The witcher's senses, the traces and the trail

Owner, 26 Oct 2026: "generated assets to examine, and a button for hints like witcher senses to
light them up — and the road should not render straight to the quest, but as a path the senses
light up too". Three things, one feature:

- **A clue is a real thing when there is a fal.ai key.** The beat writes each clue's `prop` in
  English (an image model reads Polish badly, the same reason as the hub's `kit`), and
  `ensureClueModel` (`landmark3d.ts`) makes it once, through the hub's queue and price (~$0.023,
  `simplify` 0.98, kind `fal` labelled `clue` in the console), while the item-shape block stands in.
  The model is kept on the beat (`Clue.model`), so the autosave has it and Continue loads it rather
  than asking again; `RpgScene.setClueModel` puts it where the block lay, on the ground and not
  turning (`CLUE_FIT`, knee-high). No key, no `prop` (an older beat), or a failure: the block stays.
- **Q, or 👁 on a phone, sharpens the senses** for `SENSES_SECONDS` (12), or until pressed again or
  a dialogue opens (`components/Rpg/senses.ts`). Every clue, every thing to pick up and every enemy
  of the job gets a beam and a pulsing ring drawn through walls and fog, and the screen's edge
  darkens (`.rpg-senses`, an inset shadow — a CSS animation on it stayed at opacity 0 in headless
  Chromium). Light and darkness, not hue: it must read on a black-and-white phone.
- **The road winds and the senses show the way.** `utils/rpg/trail.ts`: each place's road is a
  seeded wander (`roadPoints`, the same bends every visit, straight out of the square and into the
  place, leaving the square 6 m out so it does not run under the well) drawn as a ribbon
  (`ribbon` in `RpgScene.ts`), and the trees it clears are measured to that line. Under the senses,
  footprints glow from the hunter's feet to whatever the marker points at, lit outward like a wave:
  along the road when one leads there (joined where the whole way is cheapest, a metre across the
  fields counting 2.5 of road, so the trail never doubles back to the road's nearest point), across
  the fields otherwise, round the square's middle rather than through it, and no further than
  160 m. Relaid every half second while the senses last. The golden beam and the compass stay: the
  trail is a hint, not the only way to know where to go.

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
- **A name over the head** (owner, 30 Oct 2026: "the name should show as you walk up to an NPC").
  The nearest character within `NAME_RANGE` (6 m, a step before E's `TALK_RANGE`) gets their name
  over their head, fading in over the last two metres (`updateNameTag`). It is one HTML element
  over the canvas, not a sprite in the scene: text a phone draws sharp, and nothing in the NPC's
  group, which `group.clear()` empties on every redress. It is placed every frame *after*
  `updateCamera`, from `npc.group.position`, so it follows a character that walks; it hides while
  the world is held (a dialogue names the speaker already) and when the head is behind the camera.
- **Generated people** (owner, 28 Oct 2026: "it is always the same few models and it breaks
  immersion", then "no Quaternius characters: nothing until it is generated, then it is there").
  In an invented world with a fal key, every person is made for them: the hero once per world
  (`WorldBible.hero`, an English look the genesis call writes, kept as `heroModel` beside the
  world), each NPC and witness from the `appearance` the quest beat gives them (kept on the
  character in the atlas, so somebody met again is the same model), and a humanoid slay target from
  its `targetProp`. `personPrompt` (`falPrompts.ts`) asks FLUX schnell for one person, A-pose, hands
  empty, on white; TRELLIS makes the mesh at `mesh_simplify` 0.95 (~6k vertices). **~$0.023 a
  person**, ~30–60 s.
  - **The rig costs nothing.** Meshy's rigging was used once, to rig two donor bodies (a guard and
    a wanderer) and make the clip library on the male one; `scripts/rpg-people.mjs` turns those
    into `src/assets/rpg/people/` (two ~70 KB donors, clips ~110 KB gzipped) and regenerates them
    byte for byte. Each person is then rigged in the browser by `utils/rpg/selfRig.ts`, in a worker
    (`components/Rpg/selfRig.worker.ts`), ~1 s: the donor is laid over the mesh, warped onto it
    through control nodes on a 4 cm grid (40 rounds, stiffness easing, nearest points pulled both
    ways), and each vertex copies the weights of the nearest warped donor point; joints move with
    the donor points bound to them, rest rotations stay the donor's, which is why one library of
    clips (under the game's `Clip` names) moves every person. The rig is cached in the Cache API
    beside the GLB under `?rig=N&body=…&height=…` — **a query, not a fragment**: the Cache API
    drops fragments, and a `#` key once handed back the GLB's own bytes as a rig. Bump
    `RIG_VERSION` in `people.ts` when `selfRig` changes what it answers.
  - **The jump is Quaternius's, retargeted** (owner, 30 Oct 2026: "make it possible to jump").
    Meshy's library was bought clip by clip and has no jump, so `scripts/rpg-people-jump.mjs` moves
    *Universal Animation Library*'s `Jump_Start`/`Jump_Loop`/`Jump_Land` onto the donor and appends
    them to `people_clips.json`: each bone's **world** rotation is carried across, measured from a
    pose both rigs share (both at rest, the donor's limbs turned bone by bone to point where
    Quaternius's do). Calibrating on the two idles was tried first and is wrong: Meshy's idle
    stands turned 42° at the hips, and that turn came out as a twist in every bone mid-air.
    `rpg-people.mjs` rewrites `people_clips.json` without them, so run the jump script after it.
    The kit people take the same three clips straight from the pack (`rpg-characters.mjs`).
  - **Nothing stands there until the model is ready** (`PersonBody {wait}` in `RpgScene.ts`): the
    group is empty, `nearestNpc`, `attack` and `updateEnemies` skip an empty one. The kit appears
    only in the classic world, with no fal key, or when a model fails to load or rig (and a mesh
    with other than one head is refused as "not one standing person" — FLUX did once draw two).
    `heads()` counts the separate lumps across 86–96 % of the height, above where T-pose arms
    reach; it replaced "wider than 0.85× its height", which refused Nano Banana's T-pose and its
    wide stance (0.99 and 0.55 of the height across), both one person.
  - **Or Meshy, and Meshy by default** (owner, 29 Oct 2026: "a toggle in the settings, our own rig
    or Meshy via fal.ai; ours is weak, maybe Meshy is better, I want to try; Meshy by default").
    *Character rig* in the settings (`rpg-rigger` in localStorage, absent = `meshy`, shown only with
    a fal key): with Meshy, `people.ts` sends the TRELLIS GLB to `fal-ai/meshy/rigging`
    (`rigWithMeshy` in `landmark3d.ts`, the queue, **$0.20 a person**, ~1.5 min measured) and loads
    the rigged GLB it answers: Meshy's own 24 bones under the names the donors have, so the same
    clips fit with only the hips' height (`fitClips`), stood on the origin at the role's height. The
    rigged URL is kept in the Cache API under `?meshy=1&height=…` beside the GLB, so a model is paid
    for once per browser (not per account: it is not on the world). The one-person check runs first,
    so a picture of two is not paid for; a refusal or a failed request falls back to the browser's
    rig, both in the console. Switching re-rigs everyone standing (`RpgScene.setRigger`). Meshy's
    GLB is ~2 MB and ~22k vertices against the self-rig's ~5.5k. Compared on a blacksmith in a
    leather apron (`rpg/postacie-3d/meshy-vs-wlasny-kowal.gif` in the project files), same clips:
    Meshy frees the arms from the body and splits the legs cleanly in the walk; ours keeps the apron
    on the body but glues the hands to it, and Meshy's apron splays into spikes in the idle and swing.
  - **And the model itself can be Meshy's** (owner, 29 Oct 2026: "one more toggle so the models
    are made by Meshy too, maybe it will be better"). *Character model* in the settings
    (`rpg-mesher`, absent = TRELLIS, the default because Meshy is 40× the price): with Meshy, a
    person's picture goes to `fal-ai/meshy/v6/image-to-3d` (`buildMeshyMesh`, A-pose, ~10k
    polygons, **$0.80**, in the browser — the server's job runner only knows TRELLIS) instead of
    TRELLIS. People only (`person`, `hero`, `enemy`); the hub, places and clues stay on TRELLIS. A
    model is kept on the character as before, so the switch applies to people made from then on;
    either rig then works on either mesh. Measured the same day on the blacksmith's picture
    (`rpg/postacie-3d/model-meshy-vs-trellis-kowal.gif`): 211 s, a 3.7 MB GLB (~14.7k vertices,
    one 2k texture), facing +Z and standing like TRELLIS's; far cleaner than TRELLIS — a face, hands
    with fingers, an apron that hangs — and both rigs move it well (Meshy's rig took 38 s on it).
  - **The model lab, `/apps/rpg-models/`** (owner, 29 Oct 2026: "a viewer for those models … rotate,
    zoom, move and switch between animations to assess the best bang for buck; a button to generate
    a model from the same image with various methods"). `components/RpgModels/`: everyone the game
    has made (`labSources` over this browser's library and, signed in, the account's
    `rpgWorlds`/`rpgSaves`, read only — the lab never stamps or pushes a sync unit) and people
    described in the lab itself (a FLUX picture, $0.003). For one person: their pictures, the models
    made from them, and the stage (`labScene.ts`): the ticked models (up to 5) in a row on one floor
    under OrbitControls, all on the same clip from the same moment, with a rig switch (our own free;
    Meshy asks first with its price for the ones not rigged in this browser), speed, pause, the
    skeleton and the wireframe. **Make** takes a method from `PERSON_MESHERS` (`landmark3d.ts`:
    TRELLIS $0.02, TRELLIS 2 $0.25, Tripo 2.5 $0.30, Hunyuan3D 2 $0.48, Meshy 6 $0.80) and a
    picture: the game's, or a redraw in the wide pose (`widePose`, arms out with gaps, nothing
    hanging between the legs, $0.003 once). Each model shows its price, time, triangles, size and
    texture; `~` lists the fal requests with the session's total. What the lab made is kept in
    `rpg-model-lab` in localStorage only, so not on another device. `noindex`.
  - **Who draws the picture** (owner, 29 Oct 2026: "a picker for those models in the lab and a
    switch in the game's settings, and Nano Banana by default in the lab, because the pose matters
    a lot here"). `PERSON_PAINTERS` in `landmark3d.ts`: FLUX schnell $0.003, FLUX dev $0.025,
    FLUX 2 $0.012, Nano Banana $0.0398, Nano Banana 2 $0.08. The lab defaults to **Nano Banana**,
    which follows a pose; it redraws the game's prompt (`redraw`) or the wide pose (`wide`), each
    kept per person, pose and painter so it is paid for once. The game's *Character picture* setting
    (`rpg-painter`, absent = FLUX schnell, the default because the game draws every person it
    meets) applies to people only; anything but schnell is drawn in the browser, as Meshy's mesh
    is, since the server's job only knows schnell. Measured on the blacksmith: Nano Banana's wide
    pose through TRELLIS, $0.06 in all, one person with a gap at every limb.
    **The strict T-pose** (owner, 29 Oct 2026: "the key to a good rig is a very exact T-pose in the
    picture; the arms pointing exactly, no objects held; and let the prompt be seen in the lab") is
    the lab's default picture (`tPose` in `falPrompts.ts`: arms horizontal in one line, palms forward
    with the thumbs up since 30 Oct 2026 (owner: "palms to the front, not down, for the rig"),
    gaps to the armpit, hands empty with the objects named, carried things on the back or belt), and
    people described in the lab are drawn in it from the start. A kept picture is used again only while
    its prompt is the one its pose sends now (`keptPicture`), so a changed pose is drawn afresh. The prompt sent, or the one a kept
    picture was drawn from, is under the Make row and the describe form, word for word. Nano Banana
    draws it cleanly on the blacksmith.
    **The pose is a setting since** (owner, 29 Oct 2026: "put the T-pose in the game, a setting for
    A-pose or T-pose, both prompts viewable and very precise"): *Character pose* (`rpg-pose`, absent
    = T-pose) in the game's settings, each pose's prompt folded out under it word for word
    (`PERSON_POSES` in `falPrompts.ts`: the strict T-pose, and the precise A-pose, which is the
    lab's "wide" picture too). `ensurePersonModel` puts the person's prompt in that pose
    (`posePerson`), so the kept prompt is the one sent, and Meshy's image-to-3D is told the same pose
    (`pose_mode`). For people made from then on; the console's remake redoes the ones standing.
  - **Our rig takes the T-pose too** (owner, same evening: "now that Nano Banana draws a good,
    repeatable T-pose a procedural rig should be easier; the old one was for the A-pose"). The
    donors stand with their arms nearly at their sides, so warped onto a T-posed model the arms
    never met and stayed out in every clip. Now `armsOut` reads the pose off the model (its
    shoulders' band wider than 0.7 of its height), and a T-posed one is rigged on the donor stood in
    a T-pose (`tPoseDonor`: upper arms and forearms turned straight out, its points carried by its
    own weights), whose posed rotations become the rest the skin is bound in; a clip sets rotations
    outright, so the arms come down. Kept apart in the cache (`&pose=t`), so no A-pose rig is
    reused. On the blacksmith in Nano Banana's T-pose through TRELLIS ($0.06 in all, no rig to pay)
    the arms hang in the idle; the hands are still ragged at the wrist, the next thing to mend.
  - **In one go** (owner, same day: "an option in the lab to see the pipeline in one go: model,
    texture and rig"): `meshyRigged` in `PERSON_MESHERS`, Meshy 6 with `enable_rigging` and the
    person's height, **$1.00** ($0.80 + the $0.20 add-on), ~3 min. Its rigged GLB is kept in the Cache
    API as Meshy's rig of the bare model (`People.keepMeshyRig`), and the lab switches to the Meshy
    rig, so it shows at no further cost. On fal only Meshy does this; Tripo's rig is on Tripo's own
    API. The blacksmith in the T-pose came back with the arms down in the idle, the clips fitting it
    like the separate rig's.
  - **From text, in one go** (owner, same evening: "can the model, texture and rig be made at once
    from text rather than a picture? — add it to the lab"): *Model + rig from text* by the describe
    form, `textToRiggedPerson` on `fal-ai/meshy/v6/text-to-3d` with `pose_mode: t-pose`,
    `enable_rigging` and the height, priced $1.00 ($0.80 listed, the rig's $0.20 assumed as on
    image-to-3D; fal's page does not say). The bare model becomes the described person's own, its
    rig kept as Meshy's rig of it, and Meshy's thumbnail stands in for the picture. There is no
    picture to turn down first. A herbalist in a green cloak: 4 min 44 s, 10.3k triangles, a 2k
    texture, idling cleanly on the clips.
    A painter can refuse: Nano Banana's content checker turns down famous characters by name
    ("Luke Skywalker", `content_policy_violation`), where FLUX draws them. The lab says so in
    words by the button that asked (`refused`), rather than leaving the click to do nothing.
  - **Remake in the console** (owner, 29 Oct 2026: "a button in the developer console to generate
    new characters, picture, model and rig, during the game by the new settings, so I can compare
    how it looks in the game"). The `~` console's Perf tab names the three switches as they stand
    and prices one person by them (`personCostNow` + $0.20 for Meshy's rig); *Nearest* remakes the
    generated person nearest the hero, *The hero* the hero alone, *Everyone standing* every generated person in the scene
    (`RpgScene.generatedPeople`) plus the hero and the job's humanoid enemy. Each is a new piece
    (`#stamp` on its id, past `ensurePiece`'s made-once) and replaces the old model where it was
    kept: the character on every copy (`keepPerson`), the world's hero, the beat's job. The old body
    stands until the new one is rigged (`setNpcBody`/`setHero` swap a model for a model without
    clearing first), so nobody blinks out for Meshy's minute and a half. The remakes queue behind
    whatever the world is still making (`inTurn`).
    First result, the blacksmith (`rpg/pracownia-modeli/` in the project files): the wide-pose
    picture through TRELLIS ($0.023) comes back with the arms clear of the apron; on Meshy's rig
    (+$0.20) it moves about as cleanly as Meshy's own $0.80 model, while on our rig the spread arms
    stay spread in the idle, the donor resting them lower.
  - Each worked-out rig is a console row (kind `fal`, model `self-rig` at $0 or
    `fal-ai/meshy/rigging` at $0.20, adding to the fal.ai total); a cached one is not. TRELLIS sets no metallic factor, which glTF reads as fully metal, so `people.ts` sets 0.
    The sword in a generated hand is aimed from the hand's bind pose (`gripGenerated`), the donor
    having no finger bones to place it by.
- **Humanoid enemies** are the bare base body washed in the target's colour, jogging, punching,
  flinching and falling (`Death01`, then gone after 2.2 s; they stop being targets at once). Beasts
  and blobs are still primitives: Quaternius's monster packs were behind a Google Drive quota the
  day this was done.
- **Surfaces** (`components/Rpg/surfaces.ts`): ten Poly Haven colour maps at 512 px, tiled per
  material and cached per tiling (each tiling is its own GPU texture, so taking a place down
  disposes none). A biome's ground colour becomes a tint at full brightness (`hueTint`), because
  multiplying the dark colour itself into an already dark scan made every place a black disc.
- **A place's ground frays into the land around it** (owner, 28 Oct 2026: "locations are discs of
  one texture … it has to pass smoothly and irregularly into the surroundings"). The disc is wider
  than the place (`PLACE_RADIUS + 28`) and transparent, and `frayEdge` (`surfaces.ts`) decides in
  the shader, from two fbm noises over the disc's own coordinates, where between `inner` (R − 4) and
  `outer` (R + 14) it gives way: lobes several metres across push the edge in and out, a finer
  mottle leaves patches of each ground in the other, and the place's name seeds the noise so no two
  places fray alike. Under a flood the coast is as ragged but hard (`sharp`), starting further out,
  since a faded island is land under the sea.
- **No environment map**, so anything fully metallic renders black: `dress` caps the outfits'
  metalness at 0.3 and the sword is 0.35.
- **The models never block the game.** A character is an empty `THREE.Group` until the files
  arrive (~5.8 MB for the people, ~4 MB for the world, once); if they fail, everyone becomes the old capsule and the game plays.
- **The world** (`components/Rpg/world.ts`): Quaternius's *Medieval Village*, *Stylized Nature* and
  *Fantasy Props* megakits, cut to three files (`village.glb`, `nature.glb`, `props.glb`, ~4 MB)
  whose top-level nodes are the pieces by source name. Houses are *built*, not loaded: 2 m wall
  modules (door, wide windows, plaster/timber/brick), corner posts, two gables and a tiled roof,
  small 4×6 m or large 6×8 m, facing the square. Trees and ground cover (~2,900 grass, fern,
  bush and flower clumps outside radius 14, the classic village's only) are `InstancedMesh` per part; a tree a place clears is
  hidden by a zero matrix, not removed. Kit meshes are `userData.shared`, so `clearPlaces`
  disposes none of them. Quest places use the kit's pines, dead trees, rocks and huts when it has
  loaded and primitives otherwise. The well is still hand-built (inner and outer walls — a single
  open cylinder had its far side culled and read as a hole), and so are graves and campfires.
- **The ground hides its tiling** (`breakTiling` in `surfaces.ts`): one 512 px scan repeated 70×
  read as a chessboard (owner: "you can see how repetitive the texture is"). It is **hex-tiled**
  (Mikkelsen 2022): hexagons about a tile across, each with the map turned by a random angle and
  shifted by a random offset, blended over a narrow band weighted by brightness, sampled with
  `textureGrad` so the turned samples keep their mipmaps; slow value noise (~45 m and ~12 m) lifts
  and darkens the land over it. The earlier shader — the map at two scales, chosen between by a slow
  sample of itself — was still periodic, and a generated ground with big shapes (ice floes) drew its
  grid to the horizon, the `seamless` crossfade bands lining up as stripes (owner, 30 Oct 2026).
- **Shadow bias** (`-0.0004`, normal bias `0.04`) is what keeps the kit's flat walls free of
  saw-tooth acne; drop it and every house is striped.

The source packs are ~500 MB of 4K PNGs. `scripts/rpg-characters.mjs` and `scripts/rpg-world.mjs`
(where to download them, what is cut: textures to 1024/512 WebP, the Unreal-only UV sets, bodies
cut to head and neck, all but the needed clips and pieces; both read through `scripts/rpg-gltf.mjs`,
which repairs the packs' misnamed texture URIs) and `scripts/rpg-textures.mjs` regenerate the
committed files.

## The people go about their day

Owner, 30 Oct 2026: "NPCs should walk around the place and do something, not just stand still and
look around". Each character has a `Routine` (`utils/rpg/routine.ts`, plain numbers, tested), made
in `placeNpc` and driven by `RpgScene.updateNpcs`:

- **A trade, read off the description.** `tradeOf` matches English words in the `appearance`, then
  the `voice` (`Rpg.tsx` passes both, appearance first): guard, smith (and carpenters, masons…),
  woodcutter, gatherer (farmers, herbalists, shepherds…), trader (merchants, innkeepers, cooks…),
  holy (priests, witches, sages…), and anyone else an idler. No LLM field was added: the
  description already says it. "Hunter" is deliberately not a word: it is what everyone calls the
  hero.
- **Work is the clips everyone has**, since no person holds a tool: the sword swing without a sword
  is a hammer's or an axe's stroke (smith at a house, the goods or the cart; woodcutter at a tree),
  the jab is a hand reaching to pick (gatherer at trees, the cart, the well), the talking loop a
  trader's patter by the stall, standing still before the landmark a priest's devotion. A guard
  walks four corners round home in `Sword_Idle`, looking outward, now and then drilling a swing.
  Everyone else strolls and sometimes chats at the well or a house.
- **Spots are what stands** (`spotsNear`): the hub's slots whose obstacle is on, the classic
  village's barrels, stall and cart (which block nothing as spots but are there), the forest's
  trees, a place's landmark and things. An empty slot of a world whose model has not come is bare
  ground and is never worked at.
- **Nobody goes further than `REACH` (9 m) from where the quest put them**, so the one the marker
  points at is still there; the marker's beam follows them anyway. A walk is taken only if
  `clearWay` finds no wall, tree or rock across the straight line (people do not count).
- **The hero stops a walker.** Within `HALT` (4.2 m, a little past `TALK_RANGE`) a walking or
  standing character stops and turns to face the hero, so whoever you came to talk to does not
  walk off as you reach them; a worker keeps working on the spot. On E they turn to you and talk;
  while the dialogue holds the world everyone else stands in `Idle_Loop` (the update loop is what
  moves people, and it stops), and after it the one talked to lingers 3–6 s before going back.
- **Some have a craft: a workplace and a tool** (owner, same day: "some NPCs should have their own
  assets and actions, like the blacksmith with an anvil, beating it with a hammer. Not every NPC —
  for some walking about is enough — but let the model say so"). The beat's `npc` and `witness`
  may carry `"craft"`, one word from the closed list in `utils/rpg/craft.ts` (`CRAFTS`: smith,
  carpenter, woodcutter, miner, farmer, cook, alchemist, trader, priest, guard, scribe) or null,
  and the prompt says most people have none. It is kept on the character like `appearance` (given
  once, kept; someone met is told theirs). `CRAFT_SPECS` says what each implies: the trade the rest
  of their day follows, the tool, the loop and the stroke. `components/Rpg/crafts.ts` builds the
  station from primitives (anvil and glowing forge, chopping block and logs, cauldron on a tripod,
  a stall with an awning, a shrine with candles…) a couple of metres from where the character
  stands, on the first free side (`putStation`), its working side turned to them, as an obstacle;
  it moves with them and goes with them. They spend ~80% of their free moments at it (a guard
  45%, by the brazier, the rest on the round), standing inside its ring at a stroke's reach. The
  tool is built with the fist at the origin and the handle along +Z and put in the right hand by
  `holdTool`, aimed from the hand's bones as the hero's sword is; it shows only while they work at
  the station, and is put in again when the body changes (a remake, the kit's look).

## Keys

Read from the shared account store (`useAccountKeys`, see `account-keys.md`); the game never edits
them. `account.keys.fal` (fal.ai, pasted on the account page) makes the hub's models (*The hub is
built from real models*, above) and nothing else. Google first, OpenAI `gpt-4.1` only without a Google key. On Google the models are tried
in order (`modelChain` in `storyteller.ts`): the one picked on the intro screen (`MODEL_CHOICES`,
kept in localStorage `rpg-model`), then `GOOGLE_MODELS`, **strongest first** (owner, Oct 2026: "the
better model first and a fallback; we switch to a cheaper one when we optimise for cost"):
`gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-flash-latest`,
`gemini-flash-lite-latest`, all in JSON mode, then `gemma-4-31b-it` (no JSON mode;
`gemma-3-27b-it` was withdrawn, 404, Oct 2026). Flash-Lite was first until it wrote briefings and
narration. The genesis and the opening beat ask `FAST_MODEL` before this chain unless the quick start is
switched off (*The start is quick*, above).

**Pro is slow, not broken.** Measured Oct 2026: its first token takes 3–40s even on a one-line
prompt, and a whole beat can run past a minute. The first version had one 90s limit for the whole
attempt, and a timeout ended it — no Flash asked, the hand-written quest, after a minute and a
half of "the fates are deciding" (owner: "it takes terribly long"). Now each model has its own
limits (`STALL_MS` 60s without a byte, `MODEL_MS` 180s in all) and running out of either moves to
the next. Every answer is **streamed** (`streamGenerateContent?alt=sse` with
`thinkingConfig.includeThoughts`, OpenAI `stream: true`), so the wait shows Pro thinking instead of
nothing. The proxy in the cloud sandbox cuts any upstream request at 30s, so a whole Pro beat
cannot be tested from there; Flash can.

A 404, a 429 (quotas are per model), a 503, a 400 naming the model, a timeout or **a dropped
connection** (`dropped` in `storyteller.ts`: a TypeError saying load failed / failed to fetch /
network — a phone losing signal or locking during a minute-long Pro stream, which ended a quest on
its first try until Oct 2026) moves to the next;
so does an answer `parseBeat` cannot play. Anything else — a rejected key above all — ends it.
**The background is not a failure** (owner, Oct 2026: a new world asked for on the phone, the app
put away, and on return no world). Nothing is asked while the page is hidden (`whenVisible` before
every try), and a cut, a timeout or an empty answer (iOS ends a frozen stream with a 200 and no candidates)
during a try the page spent partly hidden asks the **same**
model again once it is back, up to `BACKGROUND_RETRIES` (3), instead of burning down the chain.
And because iOS often reloads a backgrounded page outright, an installed app above all, a genesis
in flight is written down (`savePendingGenesis`, localStorage `rpg-genesis`, its seeds and slider,
for 30 minutes): after a reload the intro's first button is *🎲 Dokończ rodzący się świat*, which
asks for that same world again rather than rolling new dice. No key plays the
hand-written quest; no usable answer puts up the retry panel above, with **the reason on screen**.

**And for a signed-in reader the server writes it** (owner, 28 Oct 2026: "on the phone, when I
switch apps, the quest stops generating in the background; the server should do it and I should come
back to it finished — the same with the world"). Waiting for the page to be visible only stopped the
background from *failing* a request; it still did nothing while the phone was in a pocket, and iOS
often reloads the page on return. So any signed-in reader (`setJobAccount` in `Rpg.tsx`; not
only once the key sync says `synced` — it falls back to `syncing` on every re-read and to `error` on a
weak signal, and a beat asked in such a window on 29 Oct 2026 went to the browser and died in the
background; the server's `noKey` hands an account without the key back to the browser) has every model request and every fal.ai piece made by **`rpgJob`**
(`functions/src/rpg/jobs.ts`), a Firestore-triggered gen-2 function on `users/{uid}/rpgJobs/{id}`:
- **The browser writes a job, the function claims it** in a transaction (a redelivered event does
  nothing) and runs it on the account's own keys from `users/{uid}/keys/config` — the store every
  app reads, not a secret of ours. `llm`: the same chain in the same order (`askChain` hands it the
  models), streamed, each answer checked with the game's own `parseBeat`/`parseWorlds`/`parseHubSizes`
  compiled in, moving on as the browser does. `fal`: FLUX then TRELLIS, or a picture alone for the
  ground and the cover. It writes the answer so far, the tail of the thoughts, each finished try and
  fal's queue position back into the document at most once a second, with a `heartbeat`.
- **The browser watches the document** (`serverJobs.ts`, `onSnapshot`) and mirrors it into the
  console as if it had asked itself — a request per model's turn, `☁ server` in its headline, the
  stream, the tokens, the price — so the `~` console, the progress panel and the closing screen's
  costs are unchanged. The answer is parsed again here, against the game's own context.
  **The listener is not trusted alone.** On 30 Oct 2026 a beat finished on the server at 06:59:12
  and the phone, back from the background, still showed it generating half a minute later: an iOS
  page thawed from a freeze can keep a listener on the last version it heard. So the document is
  also read with `getDocFromServer` the moment the page is visible again and every 9 s while
  waiting, through the same handler. Do not drop that for the listener alone.
- **The id is the work** (`jobs.ts`): a model request's is a hash of provider, models, prompt,
  temperature and thinking; a piece's is what it is for (`world/slot`, `world/ground`,
  `world/cover/i`, `clue/…`, `place/…`). A page that comes back from a reload and asks for the same
  beat or piece finds the job running or done and takes it (`reuse`: a finished answer for 6 h, a
  made piece for good). That is why the pending genesis now keeps its coin and its *avoid* list
  (`PendingGenesis.nth`, `avoid`): *Dokończ rodzący się świat* asks the same prompt and gets the
  world the server finished meanwhile. The pick among candidates is drawn from the answer's own hash
  (`textRandom`), and the world's id from the try's start as the server timed it, so both sides
  arrive at the same world.
- **A world starts its own village.** A genesis job is queued with `pieces`; once the world parses,
  the function creates the jobs for its hub's and forest's models (`worldPieceJobs`, the browser's
  ids, prompts from `falPrompts.ts`, which is why those builders moved out of `landmark3d.ts`). The
  ground and the cover are still started by the browser — a second each once the page is back.
  Nor is the **opening beat** started on the server: it needs the quest's seed and plan, which the
  page draws, so after a world born in the background it is written on return (~10 s on Flash).
- **The browser path stays, and is the fallback.** Signed out, keys only in this browser, the demo,
  the account missing the key (`noKey`), the runner itself crashing (`crashed`), a job nobody
  claimed in `UNCLAIMED_MS` (25 s; the function not deployed, Eventarc down) or a runner silent for
  `DEAD_MS` (90 s) — judged only on a page that has been in front 8 s, since a frozen page's clock
  says nothing — and the browser asks the provider itself, as before.
- The function has 540 s; the chain stops starting models after `JOB_BUDGET_MS` (480 s). Jobs keep
  `expireAt` and Firestore's TTL (`terraform/firestore.tf`) deletes them after two weeks.

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
- **The voice goes through it too**, `{kind:'voice'}`: one line of at most 400 characters, with
  the speaker (`who`: name, gender, age) for a character's library voice or one of the three
  premade voices, priced before it is made at the list rate (`clipCost`); `x-demo-voice` says
  which was used. `DEMO_VOICE_KEY` in
  `voice.ts` stands in for an ElevenLabs key. Only a demo quest speaks on the demo; a reader with
  their own Google key and no ElevenLabs key stays silent.
- **The intro asks first** (`GET`, `fetchRpgDemoStatus`): whether it is open, whether the paying
  account can speak, and what is left today, which is printed. Asked again at a quest's end. A
  quest cut short by a cap ends on the decision made, with the reason on the ending screen
  (`Ending.cut`) — the toast is under that overlay.

Not written down anywhere else: nothing on the admin panel sets the two dollar caps yet, so the
defaults apply until `rpgPerIpUsd`/`rpgDailyUsd` are written into `demo/config` by hand.

## The autosave

`utils/rpg/save.ts`, localStorage `rpg-saves`, one quest at a time **in each world**, by world id
(owner, Oct 2026: he went back by accident just before a story ended and never learnt how it ended;
later: "browse the earlier worlds and the games in them, and load such a saved game"). The single
`rpg-save` of before is read once into the map and removed. A new quest clears only its own world's
save, and a new world no longer throws the old world's quest away. Written at every step that
changes the quest: a beat set up, a target killed or picked up, a clue examined, the story heard,
a decision made. It keeps every beat so far, the decisions, the job's progress, what was examined
and heard; the world is rebuilt from that (`resume` in `Rpg.tsx`), with the hunter back at the
village. A decision whose next beat was still being written is saved as made and the beat is asked
for again on load, since the answer in flight is lost with the page. The intro screen offers
"Kontynuuj: <title>" in the save's language; a new quest or a finished one clears it.

## The intro is a game's menu

Owner, Oct 2026: "less slop, more substance, make it look like a game menu — it cuts the options
off and the new-world setup can't be seen". The main screen has the title, the world in one line
(its pitch a tap away) and a column of entries: Continue (the quest title under it), New quest (in
which world), New world, My worlds, Settings, Controls. Everything else is one level down, each
sub-screen with its own Back (`menu` in `Rpg.tsx`):
- New world holds the slider, the word picker and the description, shown whole, and Create.
- Settings holds the language, the model, who writes and who speaks, the chronicle, today's figures
  and the console hint.
- Controls holds the keys or the touch gestures, and the one-paragraph intro.

The overlay scrolls instead of centring past its edges, which is what used to cut the options off.

## On the account, and the library of worlds

Owner, Oct 2026: "games on the phone and the computer don't sync within one account; and I'd like to
browse the earlier worlds and the games in them and load such a saved game".

**localStorage stays what the game reads and writes; `utils/rpg/cloud.ts` copies it to Firestore and
back** when somebody is signed in, in three kinds of unit (`sync.ts`), last writer wins by the
writing browser's clock:

| Unit | Document | Holds |
|---|---|---|
| `world:<id>` | `users/{uid}/rpgWorlds/{id}` | the library entry (bible, last played), atlas, chronicle |
| `save:<id>` | `users/{uid}/rpgSaves/{id}` | the quest in progress, or `data: null` once it ended |
| `state` | `users/{uid}/rpgState/current` | the current world id per language |

- Every write in `save.ts`, `worldSave.ts` and `chronicle.ts` calls `touch(unit)`. That stamps it
  in `rpg-sync` and the pusher sends it 2.5 s later, or at once when the page is hidden.
- A pull runs at sign-in and every time the page comes back to the front. It takes every unit the
  account has newer and pushes every unit this browser has newer.
- **It never pushes over a newer account copy**, even one it did not take.
- A pull while a quest is on screen changes storage but not the screen. The intro is read again on
  the way back (`stalePullRef`).
- **Payloads are JSON strings**, because Firestore refuses the save's arrays of arrays
  (`lastLines`) and its `undefined`s. A save over 900 kB drops its transcript (`saveData`).
- An ended quest is a null save, not a deleted document, so the end propagates instead of the old
  save coming back.
- The `users/{uid}/{document=**}` rule already covers all three paths.
- **Data from before the syncing** is stamped with when it really changed (`seedStamps`: a world's
  last play, a chronicle's last quest, a save's own time, and the state with 1). So on the first
  pull another device's newer choice wins over it.

**The library** (`worldSave.ts`, `library` in `rpg-worlds`, 60 worlds at most):
- It holds every invented world played here or on the account, newest played first. `saveWorld`
  and `playedWorld` order it.
- The intro shows "📚 Moje światy (n)" (`WorldLibrary.tsx`). Each world is shown with its finished
  quests (its chronicle) and its quest in progress, from here or from the account (`accountSaves`).
- "Kontynuuj" resumes that save and "Nowy quest w tym świecie" starts one. Either one first makes
  the world current, switching the game's language if it is the other one (`openingRef` waits for
  that render).
- `resume` now finds a save's world in the library rather than falling back to the classic one,
  because the newest save need not be in the current world.

**Eviction**:
- This browser keeps the atlas and the save of the classic and current worlds, plus the
  `LOCAL_WORLDS` (6) played most recently. While signed in it also keeps any unit the account has
  not got yet (`unsafeToDrop`).
- Other worlds keep only their bible and chronicle here. A pull brings back their library entry and
  chronicle but not the rest; `fetchWorld` takes the atlas and save when the world is picked.
- A push of a world whose atlas is not here merges and never blanks the account's atlas.

## Language

Asked on the intro screen (Polski / English), starting from the page's locale. It sets the game's
UI, the language the quest is written in, and ElevenLabs' `language_code`. The quest is generated
on Start, not on load, so the choice is what the model is asked for.

## Voice

Both sides of a conversation speak through ElevenLabs (`utils/rpg/voice.ts`, `eleven_flash_v2_5`,
`eleven_v4` for a line with an audio tag — *Audio tags* below)
when the store holds an ElevenLabs key: the option the hunter picks in Brian's voice, then the
answer in **the character's own voice**.

**A voice made for each character** (owner, 21 Oct 2026: "the randomly picked voices aren't good
enough; generated voices to fit each character… don't worry about the 30 slots, rotate the oldest").
The model writes each npc's and witness's `voice`: English, in the shape ElevenLabs' Voice Design
guide asks for ("Native Polish. Male, early 20s. Persona: … Emotion: …", then timbre and pace).
On the reader's own key `utils/rpg/voiceDesign.ts` designs it (`/v1/text-to-voice/design`,
`eleven_multilingual_ttv_v2`, previewing the character's own first lines) and saves the first
preview as `rpg · <world id> · <name>` (`/v1/text-to-voice`), when the beat that brings them in
arrives (`warmVoices`), so the hunter's walk covers the wait. **The account is the registry**: the
voice is found again by that name from any browser; `rpg-designed-voices` only caches ids. Before a
save, the game's own voices beyond `KEEP` (24) are deleted oldest first, and a save refused as full
deletes one more; nothing not named `rpg · ` is touched. A design is charged for its preview text
(about a credit a character; logged in the console as a voice request) and a save is one of the
month's voice operations (95 on Creator). A refusal that will hold all session (401/402/403, quota,
operations spent) turns design off and every character falls back to the library pick below; a
designed voice that TTS no longer finds (rotated out) is designed again. **The demo stays on library
voices**: designing there would spend the owner's slots and monthly operations on strangers.
Untested against the live API at the time of writing — the shapes are from ElevenLabs' reference;
the console shows the design request and its error if one comes.

**Studio quality, always** (owner, 27 Oct 2026: the npcs "sometimes sound as if over a phone, with
odd effects; only the hero's voice has studio quality"). The hero is a premade voice recorded in a
studio; the npcs were whatever the description or the library gave. ElevenLabs' Voice Design guide:
a description without a quality phrase varies, "Studio quality" / "perfect audio quality" pushes it
clean, and FX words — phone, radio, tape, echo, reverb — degrade it (that is how lo-fi is asked for
on purpose). So `description()` cuts any clause or simile about the medium, whatever the model or an
old save wrote, and ends every description with *Studio-quality recording, perfect audio quality.*;
the prompt also tells the model not to write one. Voices designed before are not reused: the name
gained a ` · hq` suffix (`rpg · <world> · <name> · hq`) and the id cache became
`rpg-designed-voices-hq`, so each character is designed once more and the old voices rotate out
under `KEEP`. Every clip is now `mp3_44100_128` (was 64 kbps; the same credits).

The same `voice` is the manner the lines are written in (*THEY ARE CHARACTERS, NOT NARRATORS* in
the prompt: like people in a play or a film, not a book's narrator: half-sentences, dodging,
lying, their own sayings, the npc and the witness never alike), and it is told back to the model
with each returning character's name so they keep it (`demoLimits.ts` passes it through too).

**The library pick, the fallback** (owner, Oct 2026: "ElevenLabs has far more ready
voices; pick by characteristics or tags, else at random"). The model writes each character's
`age` (`young`, `middle_aged`, `old`) beside their gender, and `utils/rpg/voicePick.ts` searches
the Voice Library (`/v1/shared-voices`, the 30 most used) for that gender and age in the game's
language, falling back to gender alone — first among the voices ElevenLabs tags `high_quality`
(`category=high_quality`; the library is mostly community clones on whatever microphone their owner
had, which is where the phone-like npcs came from), then over the whole library when those have
nothing usable, so `voiceQueries` is sixteen searches, not eight. The function's week-long cache is
refreshed when a search is missing from it, and an empty answer counts as an answer in the
browser, so a Polish search with no clean voice is not asked again with the reader's key. The character's name hashes to one of them, so a
character keeps their voice across lines, quests and reloads. Only voices at the ordinary rate are
taken (`rate` 1, no `fiat_rate`), because the cost console and the demo's reservations price every
clip at it. A key that may not use the library (401/402/403 — a free plan cannot through the API)
falls back to the premade George or Rachel for the rest of the session; any other refusal falls
back for that line. Compiled into the demo function too, so the demo picks the same voices.

**No line waits for a search.** A filtered `/v1/shared-voices` search takes 8–14 s; the clip itself
about 1 s (measured on the demo, Oct 2026: a character's first line 13.7 s and 9.0 s, the next one
of the same gender and age 1.2 s). Searching on a character's first line made every new kind of
voice open with that wait. So the function runs all eight searches of a language at once
(`voiceQueries`: each gender with each age, and each gender alone), keeps them in Firestore
`rpgVoices/{lang}` for a week (an hour in memory), and answers `{kind: 'voices', lang}` with them,
cut to the usable ids. The game asks for them when voice is on with the reader's own key
(`prefetchVoices`), stores them in `rpg-voice-lists` (a day), and searches with that key only for
what they did not cover. The demo voice picks on the function's side from the same cache. A search
costs no credits, and the week bounds how often the owner's key makes eight of them.

**Nor for a cold voice.** The search was half of it. ElevenLabs is also slow the first time an
account speaks with a library voice: 11–17 s for that clip, then ~1 s for every later one whatever
the text, and a voice used the day before was still quick (measured on the demo, Oct 2026). So
`setupBeat` calls `warmVoices` for the giver and the witness: each speaks one character (`.`, a
fraction of a credit, logged in the console like any clip) while the hunter walks over, and their
first real line comes at the ordinary speed. The names warmed are kept in `rpg-voice-warm`.
Library voices take no custom voice slots (ElevenLabs, *How many voice slots*), so warming adds
nothing the account can run out of.

**The premade voices end on 31 Dec 2026** (ElevenLabs, *What are Default voices?*: they expire
and are only available to accounts created before March 2026). That is the fallback and the
hunter's Brian; the replacements ElevenLabs suggests are library voices (Brian → *Sawyer -
Midnight Storyteller*, George → *Eldrin - Crisp British Baritone*), so before then the hunter
needs a library voice id and the fallback becomes silence or another library pick.

`speakLines` requests every clip at once and plays them in order, so the answer is ready when the question ends; a newer choice stops the
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

**Audio tags: v4 for a tagged line, Flash for the rest** (owner, 29 Oct 2026: "ElevenLabs supports
things like [cough], maybe we talk to it wrong?"). We did. The model had started writing sounds as
Polish stage directions, "[Kaszel].", "(Kaszle pyłem)", "(Kliknięcie językiem)" (the quest in
`rpgSaves/wmvsih7dt0`, beat 1, Magister Elara and Siostra Mirabella), and they went to Flash as they
were. **Flash has no audio tags**: it read "Kaszel" out as a word, and the dialogue showed the
brackets. Only v3 and v4 act a tag, and they are told in English. `utils/rpg/audioTags.ts` now:

- The prompt offers a fixed list of English tags in square brackets (`TAGS`: `[coughs]`, `[sighs]`,
  `[whispers]`…), one or two a line, nothing in round brackets; the `voice` it writes may not
  describe sounds that are not the voice (Mirabella's "clicking tongue sound between sentences" is
  where her "(Kliknięcie językiem)" came from).
- `directions` splits a line. A known tag, or an old save's Polish one by `ALIASES`, is **spoken**
  as its English tag and **shown** as a small italic aside in the game's language ("kaszle"). Any
  other `[…]` or `(…)` is a stage direction: shown in italics as written, never spoken, on any model
  — "(Cyriak freezes as a living statue…)" in Cyriak's voice was worse than silence.
- `voicing` sends a line to `eleven_v4` **only when it has a tag to act**; everything else stays on
  Flash. v4 is served through **Text to Dialogue** (`/v1/text-to-dialogue`, one input), not the TTS
  endpoint, with stability 0.5. It costs **a credit a character, twice Flash** (`voiceCreditsPerChar`,
  $0.08 against $0.04 per 1k on the API price list), and the console labels each clip with the model
  that spoke it and its credits at that rate. A quest has a handful of tagged lines, so the bill
  barely moves; the price of putting every line on v4 would be double the voice cost and slower clips.
- **v4 refusing is not fatal**: any 4xx but a 429 from v4 sends the same line to Flash without its
  tags and keeps tags off for the session (`tagsOff`); the demo does the same per clip, settles at
  Flash's price and says which model spoke in `x-demo-model`.
- Untested against the live API at the time of writing (the session could not read the key): the
  request shape is ElevenLabs' reference. If tagged lines go silent or fall back every time, the
  console's voice entry carries v4's status in its label.

## Music

Owner, 30 Oct 2026: "a generated soundtrack in ElevenLabs — music only for now, fitted to the
world's climate and the RPG". `utils/rpg/music.ts`, on the reader's **own** ElevenLabs key only:
the demo never composes, since a track costs ~25 times a line of dialogue and would come off the
owner's credits for strangers. No sound effects yet.

- **What is asked for**: the world's `music` line — genesis writes it in English beside the
  landmark and the terrain (≤25 words: genre, instruments, tempo, era, feel; no artist or franchise
  names, which ElevenLabs refuses) — then the quest's tone (`TONE_MUSIC`: light warm, comic playful,
  adventure wonder, grim sparse drones), then the same rules for every track: instrumental, under
  dialogue, no drops, no fade-out, a loop that ends as it began. A world from before the line is
  described from its look in English (weather, water, flora, time of day) and its tone, tech and
  climate as written (`worldMusic`). The Willowlands have a line of their own (dark folk, hurdy-gurdy).
- **`POST /v1/music/stream`**, `music_v2_5`, `force_instrumental`, `music_length_ms` 120 000
  (`MUSIC_MS`), mp3 at 128 kb/s (48 kHz for v2 models, 44.1 for v1: `musicFormat`), so the bytes
  say how many seconds have come. Streamed rather than one silent two-minute request (the first
  build used `/v1/music` at 44.1 kHz and failed on the owner's phone the first day, reason unseen).
  Any 4xx but 401 and 429 from v2.5 asks `music_v1` instead and stays on it for the session, v2.5's
  reason kept in the console row. CORS answers `*` (checked 30 Oct 2026). **Not yet run against the
  live API from here** (the session could not read a key): the shape is ElevenLabs' reference.
- **Once per world and tone**: up to four tracks a world, the bytes in the Cache API (`rpg-music`,
  keyed by world, tone and length). A new quest of a tone the world has had plays at once and
  costs nothing. This browser only; another device composes its own. Nothing waits for a track:
  the quest starts in silence and the music fades in when it comes.
- **What it costs**: ~900 credits a minute (ElevenLabs' pricing page, Oct 2026; $0.15 a minute on
  the API list), so **~1,800 credits a track, ≈ $0.13 on the owner's Creator rate**, or the
  response's `character-cost` where the browser may read it (`musicCredits`).
- **Played through Web Audio, not `<audio>`**: iOS ignores `volume` on a media element, so the
  score could not sit under the voices. One `AudioContext`, resumed inside every click that primes
  the voice (`primeMusic`); two buffer sources crossfading 4 s at each pass, so the seam is never
  heard; a master gain at 0.32 that ducks to 0.12 while a dialogue is open (`duckMusic`); suspended
  while the page is hidden. A new tone or world fades the old track out under the new one.
- **🎵 switches it** (`🎵✕` off, never told by colour), left of 🔊 and `~` (at the top on a phone),
  kept in localStorage `rpg-music`. Off composes nothing.
- **It shows where it is** (owner, 30 Oct 2026, after the first failure: "it should be in the loading
  bar, or have its own bar where the note is, and a retry"). `musicState` in `music.ts` is a small
  store: `🎵⏳` with a strip under it filling as the seconds stream in, `🎵` playing, `🎵↻` failed —
  tapped, it composes again (a failure is never kept, `musicTry` in `Rpg.tsx`). The start's progress
  has a **Muzyka (ElevenLabs)** row (task kind `music`, on its own line like the ground, queued
  after the world while one is invented; usual time 60 s in `rpg-typical`). The toast says
  ElevenLabs' own reason (`musicError`: status and `detail.message`), so a key without the music
  permission or a plan without the Music API says so. A track that came but would not decode is
  dropped from the cache too.
- **In the console** as kind `music` (`devlog.ts`), shown without the ElevenLabs checkbox: `♪ music
  (tone)`, the model (with v2.5's status if it fell back), the prompt, the time it took, the error,
  seconds and credits. The Koszty tab and the closing screen have **ElevenLabs muzyka** on its own
  line, apart from the voices (`Spend.musicSeconds`, `musicCredits`, `musicCost`, in the autosave
  like the rest), and it counts in the total and in today's spend. A failure is a toast and a
  `rpg.music.failed` breadcrumb; the game goes on without music.

## On a phone

Owner, Oct 2026: "make it play well on a smartphone, an iPhone SE 3 above all — a small screen,
and I have a black-and-white display set". Decided once per page, by a coarse primary pointer
(`touch` in `Rpg.tsx`), not by width: a narrow desktop window keeps the keys and the mouse.

- **The controls** (`TouchControls.tsx`): a stick under the left thumb (camera-relative like WASD,
  `RpgScene.setStick`; pushed to its rim it runs, as Shift does), a finger dragged anywhere else on
  the canvas turns the camera (pointer events on the canvas, `touch-action: none`), and under the
  right thumb `⚔ Cios` with `⇧ Skok` beside it, `👁 Zmysły` above, and, only while something is in
  reach, a larger light button saying what E would do (talk, examine, pick up). Pointer lock is
  never asked for on a phone.
- **The jump** (`RpgScene.jump`, Space or `⇧`) is **off by default** (owner, 30 Oct 2026: "make
  jumping a toggle in the settings, off by default"): *Jumping* in the settings, `rpg-jump` = `'1'`
  in localStorage, `RpgScene.setJumping`. Off, Space does nothing, the `⇧` button is not drawn and
  the controls list leaves it out. On: only from the ground, up at 6 m/s against 20 m/s²,
  ~0.9 m and ~0.6 s in the air; the ground is flat at 0, so no terrain is consulted. `Jump_Start`
  is squeezed into 0.45 s (its own 1.3 s is mostly the air pose settling), `Jump_Loop` holds until
  the feet touch, and `Jump_Land` plays only when landing standing still: landing on the move runs
  straight on, since a crouch there reads as sliding. A dialogue opened in the air lands the hero
  first (`setPaused`). Obstacles still block in the air: it is a hop, not a way over fences.
- **The whole screen while playing** (`rpg-immersive`: fixed, `100dvh`, the page's scroll locked).
  iOS has no Fullscreen API for anything but video, so the ⛶ button is hidden there; a `✕` at the
  top left goes back to the intro, the quest autosaved and offered as Continue.
  It starts **under** the status bar, not behind it: iOS Safari lays its own blurred gradient over
  whatever sits up there and keeps those taps for itself (owner, Oct 2026: the console's tabs and
  the top dialogue choices unclickable under the clock). The strip above (`.safe-top-band`) is painted black while
  playing, page background included, since Safari tints that blur from both. Inside the container
  `--safe-top` is zeroed, the offset having been paid once by the container itself.
- **The console and the dialogue share the height** (`rpg-dev-open`): the console is on top, so a
  dialogue running up under it hid choices that could not be pressed. With it open the dialogue
  scrolls in what is left (on a phone, console 40 %, dialogue 60 %).
- **The intro** sits under the site's navbar in a box as tall as the screen leaves, scrolling
  inside, with Start first rather than last. The keyboard help becomes three lines about thumbs.
- **The journal is a panel**, not bare shadowed text: on iOS Safari bare text over the WebGL
  canvas left ghosts of its old lines when it changed (owner's screenshot, Oct 2026: "Losy się
  ważą" over "Porozmawiaj", two clue counts stacked). Its own background and `translateZ(0)` are
  the fix; do not take either off to make it look lighter. The `✕`, `🔊` and `~` are one style,
  square, brown-bordered.
- **The corner holds the objective and nothing else** (owner, Oct 2026, an iPhone screenshot: title,
  objective, place, clue count and three past decisions covered a third of the screen — "leave
  only the current objective, move the history deeper"). At most three lines of it, two in
  landscape. Everything else — the quest's title, the place, the traces examined, every decision
  with its consequence — is in the **quest journal**, opened by tapping the objective or with `J`;
  the world pauses while it is open and the touch controls step aside.
- **Small screens** (`max-width` or `max-height` 480 px): the dialogue is a sheet along the bottom,
  full width, scrolling, with 44 px rows; the journal, HP bar and headings shrink; the small
  buttons (🔊, `~`) move to the top, the bottom corners being the thumbs'. Landscape (375 px tall)
  shrinks the stick and buttons and clamps the objective to two lines.

**It installs** (owner, Oct 2026: "it should be a PWA too"): `pwa="rpg"` on both pages, scope
`/apps/rpg`, *Wanderer* / *Wędrowiec* under a sword-on-glass icon, a precache tier of its code
(see `pwa.md`). Installed, Safari's bars are gone and immersive mode really is the whole screen;
every inset is read through the site's `--safe-*` properties, so the notch and home bar can be
faked from a desktop console. Offline, an install that has been played once runs the
hand-written quest with every model in place.

Tested in Playwright's `iPhone SE (3rd gen)` profile, both orientations, driving the stick and the
look with CDP touch events; the swiftshader renderer there is slow, so walking covers less ground
per second than on a phone.

## What a frame costs

Owner, Oct 2026: "I have the feeling the fps dropped; an fps counter so I can measure what it
seems, logs to diagnose it". Three things, all in `components/Rpg/frames.ts`:

- **The console's Performance tab** (`~`): fps, the median and 95th-percentile frame, the script's
  share of it (the rest is the GPU), draw calls, triangles (both include the shadow pass), the
  canvas in device pixels, and how many places the world holds. Its switches turn off the shadow,
  the weather or lower the resolution, so which of them a frame is spending on is found on the
  phone itself; kept in `rpg-quality`. **The FPS badge** is the same in one line over the game
  (`rpg-fps-badge`).
- **`rpg.frames` to Sentry** (`recordMeasurement`, Sentry Logs, project `korczak-xyz`): one record
  per minute of play, with the share of frames under 30 and under 20 fps, the worst frame, draw
  calls, triangles, places, resolution and the switches. Numbers only.

**What was found** (measured in the frame loop, Oct 2026): 3 M triangles a frame standing in the
village, whichever way the camera looked. The scattered trees and ground cover were one instanced
mesh per kind over the whole map, and three culls an instanced mesh as one thing, so all 400 trees
and 3,000 tufts were drawn every frame, and the trees again for the shadow. Now each kind is
planted per 48 m square (`CELL` in `RpgScene.ts`), so the camera and the shadow camera skip what
they cannot see, and `cullFar` switches off squares and earlier quests' places beyond the fog:
0.55–0.9 M triangles, in the village and in a world of seven places. The five houses were ~250 kit
pieces, each a draw and another for the shadow; `mergeStatic` (`world.ts`) makes them 7 meshes,
one per material (the kit's positions are quantised integers: convert to floats *before* moving
them, or every piece collapses into its own little box, which is what the first attempt did).
Draw calls ended about where they were (110–180 a frame in the village).

What is still expensive, for the next time: the places' own props are separate meshes with the
kit's heavy trees (a forest place 140 k triangles, a swamp 100 k); a 2048 PCF-soft shadow map; and
the device's pixel ratio up to 2 with antialiasing, which on a phone is most of the pixels drawn.

## Everything the game waits for is on screen

The game is in active development and the owner wants to watch it work (Oct 2026: "show the
tokens streaming, show the errors, the cost of the quest, the total time"). So:

- **`~` opens the developer console** (`components/Rpg/DevConsole.tsx`, also the `~` button):
  every model request of this quest with the model asked and the one that answered
  (`modelVersion` — the `-latest` aliases resolve, e.g. `gemini-flash-latest` was `gemini-3.8-flash`
  in Oct 2026), status, time, time to first byte, the last lines of its thoughts and of its answer
  as they stream, its error, tokens and cost; the ElevenLabs clips behind a checkbox (the music
  is always shown, *Music* above). The sitting's
  totals are the **Koszty** tab (owner, 28 Oct 2026: the strip along the bottom "grew too big"),
  its running total and error count printed on the tab itself so they stay in sight from any other
  tab. **⛶ puts the console over the whole screen** (Escape or ▭ goes back, remembered in
  `rpg-dev-full`): CSS, `position: fixed` under the status bar, not the Fullscreen API, which
  iPhone Safari offers to a `<video>` only. Its **Dialogi** tab is the quest as a script (owner, Oct 2026: "the
  whole history of spoken lines, I'm working out whether the narration and dialogue hold
  together"): each step's title and objective, every character's line, the hunter's questions and
  decisions (⚑), and the clues read, in order. `utils/rpg/transcript.ts` records it — choices with
  a `kind` only, so "Back" and "Goodbye" stay out, and a line shown again in the same beat once.
  It rides in the autosave, so Continue keeps it; a new quest clears it.
  Under each step's lines the tab lists **every decision that step offered** (owner, 28 Oct 2026:
  "I want to see the dialogue options I did not choose"): ⚑ the one taken (matched by label against
  `history[n].chose`), ○ the others with the reply they would have brought, ? while none is taken
  yet, and the beat itself as JSON behind a toggle. Read from `beatsRef`/`historyRef`, not the
  transcript, so a save from before this shows them as well. In **Zapytania** a model request's
  answer unfolds whole (indented, once it parses as JSON) instead of its last eight lines.
- **The waiting screens show the stream**: the last few lines of what the model is writing, and the
  models that already failed for this beat, under "Losy się ważą…" and the opening's overlay.
- **The closing screen says what the quest cost**: the time played (Start or Continue to the
  ending, a hidden page not counted, kept in the autosave), the writing time (each beat's
  generation, added up), tokens and their price, ElevenLabs characters, credits and price, the
  clues' fal.ai models, and the total — **for every sitting of the quest**, then the **world** on a
  line of its own and the two together (owner, 27 Oct 2026: "it counts only this session, not the
  assets made earlier in this quest, and not the world's generation"). Each request is the
  quest's or the world's (`scopeOf` in `devlog.ts`): the genesis, the hub's sizes and the hub's 3D
  models are the world's, beats, clips, voice designs and clue models the quest's. The quest's
  spend rides in its autosave (`SavedGame.spent`, rewritten 2 s after any quest request ends and
  at every step) and Continue carries it back in (`beginQuestSpend`). The world's is kept on the
  world: `WorldBible.spent` for its model requests (genesis at birth, sizes when asked) and each
  hub model's own `costUsd`, read by `worldSpend`. A save or a world from before shows `+?`, a
  floor: its earlier spend was never written down. The console's own totals stay this sitting's.
- **The intro says what today cost, across the whole site** (owner, Oct 2026: "general, from the
  whole site: how much money went today, how long was played and how many times"). The browser
  reports (`utils/rpg/stats.ts`): a launch at Start or Continue, time played, and each priced
  request on a reader's own keys as it ends — not the demo's, which `rpgDemo` charged itself
  (`countSpend`). Launches go at once, the rest every 30 s and by `sendBeacon` (`text/plain`, no
  preflight) when the page hides. `rpgDemo`'s `{kind:'stats'}` adds them to `rpgStats/{day}`
  (Warsaw day, Admin SDK only, no rule), each report clamped (one launch, 30 min, $1), and its GET
  answers `today` with those plus `demoUsage/rpg-{day}`. Browser-reported, so inflatable by
  anybody determined; nothing but that line reads it.

The record behind all three is `utils/rpg/devlog.ts`, cleared when a quest starts; prices are in
`utils/rpg/cost.ts`, list prices as of Oct 2026 and marked approximate. Thinking tokens are billed
as output. ElevenLabs is credits (`eleven_flash_v2_5` is 0.5 a character, or the response's own
`character-cost` header when the browser may read it), priced as a share of the owner's Creator
plan: $22 for 300k credits a month, per `/v1/user/subscription` (not the 100k it was once assumed
to be, which tripled every voice figure). A save's voice dollars are recomputed from its credits. A model
missing from the table shows `?`, never a guess. A new kind of request the game waits on gets a
`startRequest` too, so this stays the whole picture.

## Debugging

`window.rpg.scene` (`teleport('marker' | 'npc' | 'spawn')`, `facePosition()` toward the marker,
`toggleSenses(on?)`, attack, interact) and `window.rpg.state()` (beat, progress, history, ending, chronicle, busy) exist
for driving a whole quest from a test or the console without a mouse.
