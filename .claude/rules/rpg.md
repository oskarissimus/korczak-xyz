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

**Nothing is offered before it has been said.** A character opens with the greeting and one way
on (ask about it, or goodbye); the decisions and the small-talk questions come only with the
situation, and the prompt tells the model the greeting must already name the trouble and that
every person or fact a decision or question mentions must be in the situation. The first version
put the small talk beside the greeting, and the opening offered "Why did you keep silent so long?"
and "Where was the girl seen?" after one line that mentioned neither (owner, Oct 2026).

**Every line is spoken, never narrated.** The prompt says so with a wrong and a right example
(Flash-Lite wrote "Helena weeps and says her daughter-in-law hanged herself" as Helena's own line,
owner, Oct 2026), and `narrated` in `quest.ts` throws away a beat whose greeting, situation,
waiting line or replies open with the character's name as the subject or report their speech
("mówi, że", "says that") — the next model is asked instead. Decision labels are the hunter's
spoken line, at most 12 words.

## Keys

Read from the shared account store (`useAccountKeys`, see `account-keys.md`); the game never edits
them. Google first, OpenAI `gpt-4o-mini` only without a Google key. On Google the models are tried
in order (`GOOGLE_MODELS` in `storyteller.ts`): `gemini-flash-latest`, then
`gemini-flash-lite-latest` (first until the narration above), both in JSON mode, then `gemma-3-27b-it` (no JSON mode, no `systemInstruction`).
A 404, a 429 (quotas are per model) or a 400 naming the model moves to the next; so does an answer
`parseBeat` cannot play. Anything else — a rejected key, a timeout (45s) — ends it. No key or no
usable answer plays the hand-written quest, and **the reason is put on screen** in a toast.

**Every generation is recorded** (`questLog.ts`), because the first version swallowed failures into
a breadcrumb and the only symptom, reported by the owner, was "always the drowners":

- Sentry Logs, `rpg.quest`, one per beat: outcome (`generated`, `no-key`, `unusable`, `failed`),
  provider, model, ms, each try's model and status, which beat, its job (`kind` is `opening` for
  the first), the plan (`slay,talk,end`), the biome (`village` for the square) and the targets'
  shape. Sent signed out too. Never the prompt or the story.
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

## Debugging

`window.rpg.scene` (`teleport('marker' | 'npc' | 'spawn')`, `facePosition()` toward the marker,
attack, interact) and `window.rpg.state()` (beat, progress, history, ending, chronicle, busy) exist
for driving a whole quest from a test or the console without a mouse.
