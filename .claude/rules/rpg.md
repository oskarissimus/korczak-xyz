---
name: rpg
description: The 3D RPG at /apps/rpg/ (Wanderer / Wędrowiec) - quests written one beat at a time after each decision, the branching the game draws, the chronicle, the blocks places are built from, parseBeat as the boundary, the keys it reads.
paths:
  - "**/components/Rpg/**"
  - "**/utils/rpg/**"
  - "**/pages/**/rpg.astro"
  - "**/styles/rpg.css"
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
the moment the hunter decides, so it is mostly written while the answer is read and spoken; what
is left shows as "Losy się ważą…".

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

**Options say what they are**: a decision (`kind: 'plot'`) is bold and amber; a question (`ask`:
story parts, small talk, clue questions, the witness's) is greyed once asked in this quest, and
can still be asked; goodbye and back are plain.

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
