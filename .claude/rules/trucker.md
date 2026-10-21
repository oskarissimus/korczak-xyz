---
name: trucker
description: The truck game at /apps/trucker/ - IT work as watching a self-driving truck, the event table, the engine/renderer split and the balance the tests hold.
paths:
  - "**/components/Trucker/**"
  - "**/styles/trucker.css"
  - "**/pages/**/apps/trucker.astro"
---

# Senior Truck Driver (`/apps/trucker/`)

Satire: IT work in 2030 has been reduced to sitting in the cab of a self-driving truck and making
sure it gets the release to production. Every road event is a piece of IT work in disguise — a
fork is an architecture decision, the CB radio is Claude asking for permission, a lay-by is a
meeting the truck has to stop for, a hitchhiking PM is scope creep, a bug on the road is a bug.

## No LLM, on purpose

The MVP is fully scripted: `events.ts` is the whole content. It costs nothing to play and needs no
key. If events ever come from a model, the project rule for LLM apps applies — a developer
console under `~` with the streamed tokens, errors, the model picked at start, cost and total
generation time (see `.claude/rules/rpg.md` for the one that exists).

## Shape

- `engine.ts` — the state and the rules, no DOM; mutated in place once per frame by `tick`.
- `events.ts` — every event, both languages inline. `timeout` is the option the autopilot takes
  when the 9s timer runs out, and it is always the one an eager model would pick: that is the
  joke and the pressure.
- `render.ts` — the cab view on a 2D canvas. Road strips are `z = 1/p`, bugs use the same mapping,
  so a bug is drawn on the strip the road puts at its depth. A bug reaches the wheels
  (`BUG_HIT_Z`) exactly where the dashboard covers it.
- `Trucker.tsx` — the loop, the HUD (snapshotted ~10×/s) and the overlays.

## Balance

`engine.test.ts` pins it: an unattended shift loses, a driver who fixes bugs and weighs each
option wins. Always taking the first option burns out — keep it that way when adding events, and
keep a `km` effect honest: it is scaled by 0.6 and the destination is never put behind the truck.
