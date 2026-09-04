# Event Watch and Metro Watch backend

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

**The project layer is now `terraform/`**, and that is the source of truth for the first two rows
below — enabled APIs and role grants — plus the secret *containers*, `sendTestPush`'s public
invoker binding and the Artifact Registry cleanup policy. This table is a description; those files
are what CI applies. When the two disagree, the files win and this table is the thing that is
wrong — which has already happened once.

| Thing | State |
|---|---|
| Billing | Blaze, billing account `01AB98-…` |
| APIs | declared in `terraform/apis.tf` — cloudfunctions, cloudbuild, artifactregistry, secretmanager, cloudscheduler, run, eventarc, pubsub, iamcredentials, sts, iam, firestore, aiplatform |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | set (v1). The pair is also in `.secrets/vapid.json`, gitignored |
| `TICKETMASTER_API_KEY` | real Discovery API key (v2, 23 Aug 2026). v1 was the `none` sentinel; see below |
| `PUBLIC_VAPID_PUBLIC_KEY` | committed in `korczak-xyz/.env.production` |
| Firestore rules | deployed |
| `collectEvents`, `sendTestPush` | deployed to `europe-central2`, nodejs22, gen 2 |
| `collectTransit` | the metro watcher, same region and runtime. Every 10 minutes; no secret of its own beyond the VAPID pair |
| Artifact cleanup | images older than 3 days deleted, so old containers do not accumulate a bill |
| Firestore indexes | `firestore.indexes.json`, deployed — the undated-events query needs a composite |
| CI deploy | `.github/workflows/firebase-deploy.yml`, keyless via Workload Identity Federation. The `terraform` job runs first, so a commit needing a new API gets it before the deploy uses it |
| Project layer | `terraform/` — APIs, IAM, secret containers, invoker binding, registry cleanup. See its README for the ownership line and the one-time bootstrap |
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
grep PUBLIC_VAPID_PUBLIC_KEY ../korczak-xyz/.env.production
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

**Both are now declared in `terraform/`** — `aiplatform.googleapis.com` in `apis.tf`,
`roles/aiplatform.user` on the functions' runtime account in `iam.tf` — so once the Terraform
bootstrap has been run there is nothing to do here by hand, and nothing to remember on the next
project. Before that bootstrap they may or may not be in place; the honest check is
`eventSources/classifier` on the Alerts tab after a collector run:

- **green, with a count** — it works, whether or not Terraform has applied yet.
- **red** — `lastError` carries a 403 naming which of the two is missing. Running the Terraform
  bootstrap (`terraform/README.md`) fixes both and stops the question recurring.

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

### The newsroom reader, which is a second model pass

`src/readNewsroom.ts` reads the rows a source tagged `newsroom` — today, the ten items of
`teatrwielki.pl/teatr/aktualnosci/` — and returns three things per article: a `kind` from a closed
set, a `summary`, and the one that matters, `saleOpensAt`. That last becomes `EventRecord.onSaleAt`
and the `presale` notice counts down to it, which is the whole reason the pass exists: the sale
date is stated only in Polish prose, and the regex in the adapter reads exactly one phrasing of it.

**It shares the classifier's credentials and every one of its failure modes** — same model, same
Vertex-on-ADC, same "no project is a configuration state, not a failure", same 403 if the API or
the role is missing. Everything in the section above applies unchanged; its health lands on
`eventSources/newsroom` rather than `eventSources/classifier`, and both draw under *Also
reporting* on the Sources tab.

It is a **separate pass and not a second question in the same prompt**, for three reasons worth
keeping straight:

- **Scope.** The classifier runs over the whole ~1,150-event corpus; this runs over ten articles.
  One prompt would ask every concert in Poland whether it is a job advert.
- **Version.** `READER_VERSION` is its own lever over its own hash, so tuning the wording of a
  sale-date question costs ten calls rather than eleven hundred.
- **Blast radius.** A wrong `reach` costs a card in the feed. A wrong sale date is a notification
  on the wrong morning, and a missed one is the season you meant to book.

Two guards are specific to it, and both are there because the article is **text scraped from
someone else's CMS being handed to a model whose answer schedules a notification**:

- A `kind` outside the closed set is dropped, so a model cannot invent a tag nobody can write an
  interest against.
- A `saleOpensAt` is stored **only when it parses to a real calendar day, lands in the future, and
  lands inside two years**. A hallucinated or injected past date would otherwise count as tickets
  having gone on sale and mint an "On sale now" push about a shut box office.

The regex path in the adapter is deliberately **kept, and wins where it fires**: it read the
theatre's literal sentence, and a model is not asked to second-guess a stated fact — the same rule
that keeps the classifier from overwriting a `country` the scrape knew. It is also what makes the
sale reminder work at all on a project the model cannot reach.

The same `smoke.live` invocation exercises it against the real news list and prints one line per
article, so a prompt change is checked against what the press office actually wrote.

### Redeploying by hand

```sh
firebase deploy --only firestore:rules,functions --project korczak-xyz-501720
```

CI does this on any push to `main` touching `functions/`, `firestore.rules`, `firebase.json`,
`korczak-xyz/src/utils/events/` or `korczak-xyz/src/utils/transit/`. Note those last two paths:
`tsconfig.json` compiles both matchers in from the site rather than keeping a copy, so a change
there is a change to the backend.

### Triggering a collection run now

```sh
gcloud scheduler jobs run firebase-schedule-collectEvents-europe-central2 \
  --location=europe-central2 --project=korczak-xyz-501720
firebase functions:log --only collectEvents
```

The idempotency property is the one worth re-checking after touching an adapter: run it twice and
the second run must report `"created":0`.

For the metro watcher, the same shape:

```sh
gcloud scheduler jobs run firebase-schedule-collectTransit-europe-central2 \
  --location=europe-central2 --project=korczak-xyz-501720
firebase functions:log --only collectTransit
```

Two numbers in that summary are the ones to read. `"created":0` on a second run is idempotency, as
above. `"brokenFeeds":[]` is the one that matters more — see below.

### If `collectTransit` cannot read wtp.waw.pl

**This is the failure to expect, and it will not look like an error unless you go and look.**

wtp.waw.pl is served through CloudFront with AWS WAF in front of it. A request the WAF decides to
challenge comes back as `HTTP 202`, header `x-amzn-waf-action: challenge`, **body of zero bytes** —
which `response.ok` calls a success and an RSS parser reads as a feed with no items. Measured from
a US datacentre address while this was written, every plain request got exactly that; requests from
a European address are reported to work, which is what the community bot reading these same two
feeds relies on. Whether Google's `europe-central2` egress is challenged is not something that
could be established from here.

So the adapter treats a non-feed body as an **error**, never as an empty feed (`notAFeed` in
`src/transit/wtp.ts`), and records the status, the byte count and the first 500 bytes of whatever
did arrive in `transitFeeds/{impediment,change}`. Three consecutive failures send a push saying the
app cannot see.

To check: open the app's **Raw** tab, or

```sh
firebase firestore:get transitFeeds/impediment --project korczak-xyz-501720
```

If it is being challenged, the answer is **not** in this repository and nothing here should learn
to solve a WAF challenge. The options, in the order worth trying:

1. Confirm it is the WAF and not us — `error` will name it, and `bodyHead` will be empty.
2. Ask ZTM for feed access, or for the terms under which a client may read it. They publish these
   feeds for readers; a named agent that identifies itself (which is what the adapter sends) is the
   thing to point at.
3. Fetch through something with a Polish address. That is a second moving part and a second thing
   to pay for, and it should be a last resort rather than the first idea.

Until then the app is honest about being blind, which is the whole of what this design buys.

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

# 3b. The classifier has NO secret — it uses the function's own identity. The API and the role
#     it needs are in terraform/; run that bootstrap (terraform/README.md) instead of doing this
#     by hand, and it stays done for every project after this one.

# 4. The public key ALSO goes in the site's build environment, as PUBLIC_VAPID_PUBLIC_KEY
#    (korczak-xyz/.env.production, committed — it is the publishable half of the pair).

# 5. Rules first — until these are deployed the feed reads nothing.
firebase deploy --only firestore:rules

# 6. Then the functions. `collectTransit` needs no secret of its own — it uses the same VAPID pair
#    and, like the classifier, reaches Vertex AI as the function's own service account.
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
