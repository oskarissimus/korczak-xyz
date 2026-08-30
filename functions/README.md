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

### The classifier, and why it has no key

`src/classify.ts` labels every event with a country and a reach (`local` / `national` /
`international`) — the judgement that separates PyCon NL from EuroPython, which no listing states.

**It authenticates as the function itself.** `gemini-2.5-flash-lite` on Vertex AI through
Application Default Credentials, which in this runtime is the Cloud Function's runtime service
account. There is no API key: the code is already running inside the project the model is billed
to, so a credential to prove that would be a credential to store, rotate and leak. It also keeps
the classifier off the deploy path — a secret named in a function's `secrets` array must exist
before the CLI will deploy *anything*, and the commit that first added this feature failed CI for
exactly that reason.

**No key is not the same as no permission**, and conflating the two is the confusion this
paragraph exists to prevent. The function has an *identity*; whether that identity may call Vertex
AI is a separate fact, and whether the API is switched on for the project is a third. Deploying the
function ships code and nothing else — it does not enable APIs and does not grant roles.

**Check before granting anything.** Both may already be satisfied: the default compute service
account has historically been granted `roles/editor` on project creation, which covers this, and
`aiplatform.googleapis.com` is often already on. So force a collector run and read
`eventSources/classifier` on the Alerts tab:

- **green, with a count** — nothing to do, and nothing below is needed.
- **red** — `lastError` carries a 403 naming which of the two is missing: the API not enabled for
  the project, or the permission not granted to the service account. Run the matching command.

```sh
# The API, for the project.
gcloud services enable aiplatform.googleapis.com --project korczak-xyz-501720

# The permission, for the identity the function runs as. `firebase.json` does not set
# `serviceAccount`, so these gen-2 functions run as the default compute account — hence the target.
gcloud projects add-iam-policy-binding korczak-xyz-501720 \
  --member="serviceAccount:$(gcloud projects describe korczak-xyz-501720 \
      --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role=roles/aiplatform.user
```

Both are idempotent, so running them when they were not needed costs nothing but is still worth
not doing blind — a role granted without knowing whether it was already there is a role nobody can
later argue about removing.

**Deliberately not done from CI**, though it could be. Granting an IAM role needs
`roles/resourcemanager.projectIamAdmin` on the deploy identity, which is the right to grant itself
anything — a permanent widening of what a pipeline that fires on every push can do, bought to save
a command run once. The security boundary of this setup is the WIF provider's `attribute-condition`
pinning the pool to this repository; what sits behind that boundary should stay as small as it can.

Failure modes, and what each looks like:

- **The API is not enabled, or the role was never granted.** Every batch throws, nothing is
  labelled, and `eventSources/classifier` goes red on the Alerts tab with the error on it. The feed
  keeps working — an unlabelled event passes the places rule — so this is visible without being
  destructive.
- **`LOCATION` does not serve the model.** Same symptom. It is one constant in `classify.ts`,
  currently `global`; `europe-west4` is the nearest regional alternative. The functions' own
  `europe-central2` is deliberately *not* used — generative models are served from a smaller set of
  locations than Cloud Functions are.
- **No project at all** (a laptop with no ADC): `classifyEvents` returns without calling anything.
  That is a configuration state and not a failure, the same shape as a missing Ticketmaster key.

The cost is small enough to be worth stating so nobody has to guess: ~120 input tokens an event, 25
events a request, so labelling the whole ~1,150-event corpus once is a few cents and after that
only genuinely new events are sent. Note Vertex has no free tier where AI Studio's Developer API
does — at this volume the difference is not worth a stored credential.
`MAX_CLASSIFY_PER_RUN` (400) spreads the first backfill over about three runs so it cannot exhaust
the function's 540-second timeout.

Two things about re-running it:

- The verdict is cached on the event under `classifyHash`, a digest of the fields the prompt shows.
  Nothing re-classifies while those fields are unchanged — a new ticket link or a moved `updatedAt`
  costs nothing.
- **`CLASSIFIER_VERSION` in `src/classify.ts` is the only lever for re-labelling the corpus.** Bump
  it when the prompt changes; every stored hash is invalidated at once and the backlog drains over
  the next few runs. There is deliberately no button for this in the app: "the prompt changed" is a
  fact about a build, and a re-run nobody can date afterwards is worse than no re-run.

To check the model's judgement before deploying — which also settles whether `LOCATION` serves the
model and whether Vertex accepts the response schema:

```sh
gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=korczak-xyz-501720 LIVE=1 npx vitest run smoke.live
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

# 3b. The classifier has NO secret — it uses the function's own identity. Once, per project:
gcloud services enable aiplatform.googleapis.com --project korczak-xyz-501720
gcloud projects add-iam-policy-binding korczak-xyz-501720 \
  --member="serviceAccount:$(gcloud projects describe korczak-xyz-501720 \
      --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role=roles/aiplatform.user

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
