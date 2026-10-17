---
name: rpg
description: The 3D RPG at /apps/rpg/ (Wanderer / Wędrowiec) - the fixed world a model writes quests into, parseQuest as the boundary, the hand-written fallback, the keys it reads.
paths:
  - "**/components/Rpg/**"
  - "**/utils/rpg/**"
  - "**/pages/**/rpg.astro"
  - "**/styles/rpg.css"
---

# The RPG

Started Oct 2026 as the smallest thing that plays end to end: walk around a village (WASD, mouse
look under pointer lock, Shift to run), talk to the one quest giver, accept a quest, go to the place
it names, collect or kill N things there, come back, hand it in. Inspired by The Witcher 3. Meant to
be iterated on.

## The model writes words and chooses blocks; the engine builds

Since Oct 2026 the model **invents the place** a quest happens in (owner's choice of the first step
towards fully generated quests). It still writes no geometry: `utils/rpg/place.ts` is the closed
vocabulary — a direction (8) and distance (`near` 50 m, `far` 85 m) from the village, a biome (7),
up to four features (10: pines, dead trees, rocks, pillars, graves, water, campfire, huts,
mushrooms, standing stones), a ground colour, and for the targets a shape (enemies: humanoid,
beast, blob; items: crystal, flower, chest, skull, scroll), a colour and a size. The place is built
when the quest is accepted (`RpgScene.setPlace`, `components/Rpg/placeBuilder.ts`), seeded by its
name so it is the same place every time; scattered trees on it and on the dirt path to it are
hidden, not deleted, and come back with the next quest. A toast names it on arrival.

`parseQuest` is still the boundary: a place without a name, a known direction or a known biome
throws the answer away; unknown features are dropped and the biome's own fill in; a shape that does
not fit the objective (a skull to slay) falls back to that objective's default. The fixed ruins,
forest and lake are gone; the hand-written quest's lake is a `lakeshore` place like any other. A
new block is a word in `place.ts`, a builder in `placeBuilder.ts` and a line in the prompt, in that
order.

**The job is drawn by the game, not chosen by the model** (`pickJob` in `quest.ts`): half slay
(1–4; one is a single dangerous creature, size 1.5–2), half collect (2–5). The prompt states it as
given and lists only the shapes that fit it, and `parseQuest` overrides whatever kind and count the
model writes back. Left to choose from "collect or slay, 1–5", the models wrote "collect 3" almost
every time (owner, Oct 2026: "every quest is find 3 items"). Anything else the model picks too
uniformly gets the same treatment: draw it here, tell the model.

The dialogue is a menu of lines the quest already contains, not a chat: talking costs no request.

## Keys

Read from the shared account store (`useAccountKeys`, see `account-keys.md`); the game never edits
them. Google first, OpenAI `gpt-4o-mini` only without a Google key. On Google the models are tried
in order (`GOOGLE_MODELS` in `storyteller.ts`): `gemini-flash-lite-latest` and
`gemini-flash-latest` in JSON mode, then `gemma-3-27b-it` (no JSON mode, no `systemInstruction`).
A 404, a 429 (quotas are per model) or a 400 naming the model moves to the next; so does an answer
`parseQuest` cannot play. Anything else — a rejected key, a timeout (45s) — ends it. No key or no
usable answer plays the hand-written quest, and **the reason is put on screen** in a toast.

**Every generation is recorded** (`questLog.ts`), because the first version swallowed failures into
a breadcrumb and the only symptom, reported by the owner, was "always the drowners":

- Sentry Logs, `rpg.quest`: outcome (`generated`, `no-key`, `unusable`, `failed`), provider, model,
  ms, each try's model and status, and what came out: kind, count, biome, the targets' shape. Sent signed out too. Never the prompt or the story.
- For a signed-in account, `gs://korczak-xyz-501720-backseat/users/{uid}/rpg/quests/{at}.json`:
  the prompt, the raw answer, every model tried with its error, the parsed quest, the release. The
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
answer in George's or Rachel's (the quest's `npcGender`). `speakLines` requests every clip at once
and plays them in order, so the answer is ready when the question ends; a newer choice stops the
queue. **Each line is spoken once per quest** (`spokenRef`, keyed by voice and text, cleared when a
new quest loads) — at the owner's request, so going back to a menu does not read its greeting
again. One audio element primed inside the Start click (the iOS unlock, see `backseat.md`), clips
cached by text, a 🔊 button to mute. A failed clip is a toast and the line stays readable; it never
blocks the dialogue.

## Debugging

`window.rpg.scene` (teleport, facePosition, attack, interact) and `window.rpg.state()` exist for
driving a whole quest from a test or the console without a mouse.
