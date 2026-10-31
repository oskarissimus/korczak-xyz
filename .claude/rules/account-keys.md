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

Since Oct 2026 every API key the apps spend lives in **one** place: `users/{uid}/keys/config` for a
signed-in account, and localStorage `account-keys` for a signed-out reader who brought their own.
Sloper, the backseat driver and the roaster, the audio guide, the RPG and its model lab all read it
through `useAccountKeys`; their own key fields edit it; `/account/` (`/pl/account/`, linked as
*Account* beside Logout) shows it. A key typed or cleared anywhere is typed or cleared everywhere.

## The account's keys never reach the browser (31 Oct 2026)

Owner: *"the key should never go from Firebase to the browser"*. Until then the page synced the
whole document down — every key in the clear in localStorage and in memory — and called providers
with it. Now:

- **`firestore.rules` denies every read under `users/{uid}/keys`.** The page writes there with a
  merge (`pushAccountKeys`) and can never read back. The condition sits on the `users/{uid}`
  catch-all (`document[0] != 'keys'`) because rules are a permissive union; a separate
  `allow read: if false` beside the catch-all would grant nothing and deny nothing.
  `rules.test.ts` pins it. Only the Admin SDK reads the document: the gateway, `rpgJob`, the demos.
- **The page holds handles, not keys.** `useAccountKeys` asks the gateway's `GET /account/keys`
  which keys exist (and their last four characters, the only thing the account page shows) and
  hands every app `ACCOUNT_KEY` (`'account:key'`) for each. It is truthy, so every "is there a
  key?" check still works; `keysFrom`/`asKey` read it as *no key*, so it can never be written over
  a real one. The last answer is remembered per uid (`account-keys-view`, hints only) so a reload
  has its handles at once.
- **Every request that spends one goes through the gateway** (`rpgApi`, `functions/src/rpg/gateway.ts`,
  routes in `utils/rpg/gatewayRoutes.ts`) via `apiFetch`, which turns a handle into the reader's
  Firebase ID token; the gateway puts the real key on and passes the answer back byte for byte.
  Only listed routes pass (`ROUTES`) — it holds keys and must not be a general proxy. That covers
  sloper (script, pictures, narration, model lists), the backseat driver (vision, ElevenLabs,
  model lists), the audio guide (its Go function's own `X-*-Key` headers, filled from the account),
  the account page's readings (OpenAI's costs on the `openaiAdmin` key, a per-route key) and the RPG.
- **Gemini Live is a WebSocket**, which no function of ours carries. With an account key,
  `live.ts` asks `POST /account/live-token` for a single-use ephemeral token (unconstrained, opened
  within a minute) and opens the v1alpha constrained endpoint with it — the roaster's demo's way in.
- **Bring your own key still works, from the browser.** Signed out, keys are this browser's own,
  in localStorage, and travel per request in the gateway's `x-rpg-key` header (Live: in the
  socket URL, straight to Google). On the next sign-in, local keys newer than the account's copy
  are moved into it, and the browser's copy is emptied either way — which is also what clears the
  copies older builds synced down into every browser.
- **The apps' legacy copies** (`users/{uid}/{audioGuide,backseat,sloper,roaster}/config`) are
  readable by the page because they hold settings, and the audio guide's still held real keys on
  31 Oct 2026 — the browser-side scrub had never emptied it. The gateway's status request now runs
  `retireLegacyCopies`: a key missing from the store is moved in, then every legacy `apiKeys` is
  nulled. The page no longer reads those copies for keys at all.

What it costs: the sync is no longer last-write-wins wholesale. Signed in, the account is the copy
of record and an edit is a merge of the keys that changed; there is nothing to reconcile because
the page has nothing to reconcile with.

## The app hooks

The app hooks (`useSloperConfig`, `useBackseatConfig`, `useAudioGuideKeys`) **call
`useAccountKeys` first**, lay its keys (handles, signed in) over `config.apiKeys` on the way out and
route an `apiKeys` patch into it on the way in, so the components did not change. Their own saves
empty `apiKeys` (`withoutKeys`). Every key field shows a handle as a masked placeholder, never its
value, and commits on blur — a per-keystroke commit would turn the first character typed into the
account's key and empty the field. An empty field over an account key means "leave it"; clearing
is the Clear button on the account page.

## The seed, once

A browser store that is empty and not `settled` is seeded **per key, from the most recently edited
copy that has it** (`seedKeys`) — the apps' localStorage copies at mount. (The account-side seed
from their Firestore documents is gone: it read keys into the page. `retireLegacyCopies` on the
server replaced it.)
Only after the seed is written are those copies emptied (`scrubAppCopiesInBrowser` — `apiKeys`
alone, `updatedAt` untouched so no app's sync notices). A
key must never exist nowhere, so a failed write scrubs nothing. That ordering is also why the
account hook must run before the app hook's own effects.

## What each provider says

Read through the gateway with the account's key (or a signed-out reader's own):

| Provider | Spent | Left |
|---|---|---|
| ElevenLabs | characters this period (`/v1/user/subscription`) | limit − used, reset date. Needs the key's *User: read* permission |
| DeepSeek | **not reported** by any API | `/user/balance` |
| OpenAI | only with an **admin key** (`/v1/organization/costs`, `api.usage.read`), stored as `openaiAdmin` | **no API**. A balance typed off the billing page (`openaiCredit`, dated) minus costs since that day |
| Google AI Studio | **no API** | none — free tier has request limits, not money. The key is checked by listing models |
| fal.ai | **not read** | `rest.alpha.fal.ai/billing/user_balance` answers our origin but needs `billing:usage:read`, which an ordinary key lacks; `/v1/models` answers without a key, so it proves nothing. The card says *saved, not checked* and links the dashboard |

`fal` (Oct 2026) is for the RPG's asset generation; nothing spends it yet, so *Used by* is honest
in saying nothing. When the RPG starts spending it, add it to `usedBy` in `Account.tsx`.

Where a provider says nothing, the page says so. Do not fill the gap with an estimate dressed as a
reading.

## Provider choices

Each app keeps its own choice in its own settings, next to the models: sloper (script
OpenAI/DeepSeek, pictures OpenAI/Google), the backseat driver (eyes OpenAI/Google, voice device or
ElevenLabs). The audio guide's one choice, who writes (`audioGuideWriter`, Google or OpenAI), is in
the shared store, so its keys sheet and the account page both edit it; the request carries only
the writer's key header, which is how the Go function picks its path. Event Watch and Metro Watch
run on the site's own Vertex AI and spend no reader's key; the account page lists them as such.
