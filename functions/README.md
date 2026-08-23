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
| `TICKETMASTER_API_KEY` | real Discovery API key (v2, 23 Aug 2026). v1 was the `none` sentinel; see below |
| `PUBLIC_VAPID_PUBLIC_KEY` | set in Netlify, production context |
| Firestore rules | deployed |
| `collectEvents`, `sendTestPush` | deployed to `europe-central2`, nodejs22, gen 2 |
| Artifact cleanup | images older than 3 days deleted, so old containers do not accumulate a bill |
| Firestore indexes | `firestore.indexes.json`, deployed — the undated-events query needs a composite |
| CI deploy | `.github/workflows/firebase-deploy.yml`, keyless via Workload Identity Federation |
| Verified | VAPID pair derives correctly; all three copies of the public key agree; `sendTestPush` reachable (`allUsers` → `run.invoker`) and returning its own auth error; collector idempotent (`created: 0` on a second run) |

### The VAPID pair

`.secrets/vapid.json` (gitignored) holds both halves. Keep it: **the public key can never change.**
Rotating it invalidates every push subscription on every device, silently — each one keeps its
endpoint, the sender keeps getting 403, and 403 is deliberately not a code that prunes a
subscription, so nothing self-heals and nothing says why.

Three copies must agree, and it is worth re-checking after touching any of them:

```sh
node -e "
const c=require('crypto'),k=require('./.secrets/vapid.json');
const u=b=>b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const d=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4),'base64');
const e=c.createECDH('prime256v1'); e.setPrivateKey(d(k.privateKey));
console.log(u(e.getPublicKey())===k.publicKey ? 'pair OK' : 'PAIR MISMATCH');"
firebase functions:secrets:access VAPID_PUBLIC_KEY
netlify env:get PUBLIC_VAPID_PUBLIC_KEY --context production
```

### The Ticketmaster sentinel

Secret Manager rejects an empty payload (`400 Secret Payload cannot be empty`) and a secret declared
in a function's `secrets` array must exist for the deploy to succeed — so "no key yet" needs *some*
value. `none` is that value, and `secretReader` in `index.ts` reads it back as `undefined`, which the
adapter handles by returning `[]`. It must not be a plausible-looking placeholder: anything sent as a
real `apikey` earns a 401, which is reported as a broken source and puts a red row on the Alerts tab
that no amount of fixing the code would clear.

**A real key is set** as of 23 Aug 2026 (version 2 of the secret) — a free Discovery API key from
developer.ticketmaster.com, 5000 calls/day at 5 a second. The sentinel is documented above because it
is what the code still does when the secret is absent, which is the state a fresh clone or a new
project is in. To replace the key:

```sh
printf 'YOUR_KEY' | firebase functions:secrets:set TICKETMASTER_API_KEY --data-file -
firebase deploy --only functions      # a secret version change does NOT trigger CI: nothing
                                      # under functions/ changed, and the path filter is what
                                      # decides. Deploy by hand or push an unrelated change.
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
