---
name: account-keys
description: The account page at /account/ and the one API key store every app reads - users/{uid}/keys/config, how it was seeded from the apps' old copies, what each provider will and will not say about spend and balance, and where each app's provider choice lives.
paths:
  - "**/utils/accountKeys/**"
  - "**/hooks/useAccountKeys.ts"
  - "**/hooks/useAudioGuideKeys.ts"
  - "**/components/Account/**"
  - "**/pages/**/account.astro"
  - "**/styles/account.css"
---

# The account's API keys

Since Oct 2026 every API key the apps spend lives in **one** place: localStorage `account-keys`
and, for a signed-in account, `users/{uid}/keys/config` (under the `users/{uid}/{document=**}`
catch-all — no rules change, none should be added). Sloper, the backseat driver and the audio guide
all read it; their own key fields edit it; `/account/` (`/pl/account/`, linked as *Account* beside
Logout) shows it. A key typed or cleared anywhere is typed or cleared everywhere — which was the
point: before, three documents held the same OpenAI key and revoking it meant clearing it three
times (the debt `backseat.md` was honest about).

**Still the reader's keys, still in the browser.** Not Secret Manager behind a function of ours —
the reasoning in `sloper.md` (*The keys, and the trade being made*) is unchanged. One document
instead of three changes how many copies exist, not who can read them.

## The sync is the old one

`useAccountKeys` is `useAudioGuideKeys` as it was, which was `useBackseatConfig` with the settings
out: last-write-wins wholesale on one `updatedAt`, `pulledRef` gating the push, `settled` written on
purpose, the account-side seed running after the three branches. Each of those is a bug one of
those apps shipped. Read `backseat.md` before "tidying".

The app hooks (`useSloperConfig`, `useBackseatConfig`) **call `useAccountKeys` first**, lay its keys
over `config.apiKeys` on the way out and route an `apiKeys` patch into it on the way in, so the
components did not change. Their own saves empty `apiKeys` (`withoutKeys`). *Clear everything* in
an app clears that app's settings only; a key is cleared on the account page or in a key field.

## The seed, once

A store that is empty and not `settled` is seeded **per key, from the most recently edited copy
that has it** (`seedKeys`) — the apps' localStorage copies at mount, then their account documents.
Only after the seed is written are those copies emptied (`scrubAppCopiesInBrowser`,
`scrubAppCopies` — a merge of `apiKeys` alone, `updatedAt` untouched so no app's sync notices). A
key must never exist nowhere, so a failed write scrubs nothing. That ordering is also why the
account hook must run before the app hook's own effects.

## What each provider says

All from the page, with the key, straight to the provider (all four answer korczak.xyz's origin):

| Provider | Spent | Left |
|---|---|---|
| ElevenLabs | characters this period (`/v1/user/subscription`) | limit − used, reset date. Needs the key's *User: read* permission |
| DeepSeek | **not reported** by any API | `/user/balance` |
| OpenAI | only with an **admin key** (`/v1/organization/costs`, `api.usage.read`), stored as `openaiAdmin` | **no API**. A balance typed off the billing page (`openaiCredit`, dated) minus costs since that day |
| Google AI Studio | **no API** | none — free tier has request limits, not money. The key is checked by listing models |

Where a provider says nothing, the page says so. Do not fill the gap with an estimate dressed as a
reading.

## Provider choices

Each app keeps its own choice in its own settings, next to the models: sloper (script
OpenAI/DeepSeek, pictures OpenAI/Google), the backseat driver (eyes OpenAI/Google, voice device or
ElevenLabs). The audio guide's one choice, who writes (`audioGuideWriter`, Google or OpenAI), is in
the shared store, so its keys sheet and the account page both edit it; the request carries only
the writer's key header, which is how the Go function picks its path. Event Watch and Metro Watch
run on the site's own Vertex AI and spend no reader's key; the account page lists them as such.
