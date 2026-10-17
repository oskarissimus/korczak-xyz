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

## The model writes words, the world stays fixed

`RpgScene.ts` owns the map: a village, and three places (`ruins` north, `forest` west, `lake` east)
joined to it by paths. A model only *chooses* among those places and between two objectives
(`collect`, `slay`), picks a count, and writes the dialogue. `parseQuest` in `utils/rpg/quest.ts`
is the boundary: an answer whose place, kind or count the engine cannot play is thrown away rather
than guessed at, missing lines are filled from the hand-written quest, and the game then plays
`staticQuest`. So no answer can make the game unfinishable. Widening what a model may ask for
(a new place, a new objective) means building it in the scene first and adding it to the prompt
and the parser second.

The dialogue is a menu of lines the quest already contains, not a chat: talking costs no request.

## Keys

Read from the shared account store (`useAccountKeys`, see `account-keys.md`); the game never edits
them. Google first, on `gemma-3-27b-it` (free on AI Studio; no `systemInstruction`, so the prompt is
the whole user turn), OpenAI `gpt-4o-mini` only without a Google key. No key, a failed request, a
timeout (25s) or an unusable answer all play the hand-written quest; the intro screen says which
one you got.

## Debugging

`window.rpg.scene` (teleport, facePosition, attack, interact) and `window.rpg.state()` exist for
driving a whole quest from a test or the console without a mouse.
