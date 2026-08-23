# Event Watch backend

The scheduled collector and the web-push sender for `/apps/events/`.

## Why the matcher comes from the site

`tsconfig.json` sets `rootDir: ".."` and includes `../korczak-xyz/src/utils/events/*.ts`, so the
event types, the matcher and the notice planner are **compiled from the site's source** rather than
copied here. The feed and the collector have to answer "does this event match this interest?"
identically — if they drift, the feed shows things you were never told about and pushes arrive for
things the feed does not list. A copy would be identical only until the first bug fix.

`tsc` emits into `lib/`, so the deploy bundle is self-contained: the Firebase CLI zips `functions/`
and never learns the sources came from a sibling directory. Note the single `*` in the include —
`events/browser/` is deliberately outside it, because those modules touch `localStorage` and the
Firestore *client*. `portable.test.ts` in the site enforces the same boundary from the other side.

## Why raw VAPID and not FCM

There is exactly one service worker on this origin — iOS shares a single registration across Safari
and every installed app — and FCM's web SDK wants its own `firebase-messaging-sw.js` plus an
`importScripts` of the compat bundle inside a worker whose whole design is *no external code*.
`web-push` is about forty lines here and adds nothing at all to the browser bundle, since
`PushManager.subscribe` is a platform API.

## Current state

Everything below is **already done** for `korczak-xyz-501720`. It is kept as a record of what was
set up and how to redo it, not as a to-do list.

| Thing | State |
|---|---|
| Billing | Blaze, billing account `01AB98-…` |
| APIs | cloudfunctions, cloudbuild, artifactregistry, secretmanager, cloudscheduler, run, eventarc, pubsub, iamcredentials, sts, iam |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | set (v1). The pair is also in `.secrets/vapid.json`, gitignored |
| `TICKETMASTER_API_KEY` | `none` — the documented sentinel for "not configured yet"; see below |
| `PUBLIC_VAPID_PUBLIC_KEY` | set in Netlify, production context |
| Firestore rules | deployed |
| `collectEvents`, `sendTestPush` | deployed to `europe-central2`, nodejs22, gen 2 |
| Artifact cleanup | images older than 3 days deleted, so old containers do not accumulate a bill |
| CI deploy | `.github/workflows/firebase-deploy.yml`, keyless via Workload Identity Federation |

### The Ticketmaster sentinel

Secret Manager rejects an empty payload (`400 Secret Payload cannot be empty`) and a secret declared
in a function's `secrets` array must exist for the deploy to succeed — so "no key yet" needs *some*
value. `none` is that value, and `secretReader` in `index.ts` reads it back as `undefined`, which the
adapter handles by returning `[]`. It must not be a plausible-looking placeholder: anything sent as a
real `apikey` earns a 401, which is reported as a broken source and puts a red row on the Alerts tab
that no amount of fixing the code would clear.

To set a real key later — get one free at developer.ticketmaster.com, then:

```sh
printf 'YOUR_KEY' | firebase functions:secrets:set TICKETMASTER_API_KEY --data-file -
firebase deploy --only functions      # or just push; CI does it
```

### Redeploying by hand

```sh
firebase deploy --only firestore:rules,functions --project korczak-xyz-501720
```

CI does this on any push to `main` touching `functions/`, `firestore.rules`, `firebase.json` or
`korczak-xyz/src/utils/events/`. Note that last path: `tsconfig.json` compiles the matcher in from
the site rather than keeping a copy, so a change there is a change to the backend.

### Triggering a collection run now

```sh
gcloud scheduler jobs run firebase-schedule-collectEvents-europe-central2 \
  --location=europe-central2 --project=korczak-xyz-501720
firebase functions:log --only collectEvents
```

The idempotency property is the one worth re-checking after touching an adapter: run it twice and
the second run must report `"created":0`.

## Setting it up from scratch (for reference)

```sh
# 1. The project must be on the Blaze plan. Set a budget alert while you are there.
# 2. Generate the VAPID pair. Keep BOTH halves: the public key can never change —
#    rotating it invalidates every subscription on every device, silently.
npx web-push generate-vapid-keys

# 3. Secrets.
firebase functions:secrets:set VAPID_PUBLIC_KEY
firebase functions:secrets:set VAPID_PRIVATE_KEY
firebase functions:secrets:set TICKETMASTER_API_KEY   # developer.ticketmaster.com, free

# 4. The public key ALSO goes in the site's build environment, as PUBLIC_VAPID_PUBLIC_KEY
#    (Netlify → Site settings → Environment variables, and your local .env).

# 5. Rules first — until these are deployed the feed reads nothing.
firebase deploy --only firestore:rules

# 6. Then the functions.
firebase deploy --only functions
```

## Running it

```sh
npm --prefix functions run build
npm --prefix functions test
firebase emulators:start --only functions,firestore
```

The dedupe property is the one worth checking by hand: run `collectEvents` twice against the same
corpus and the second run must write **no** new notices.
