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

## Setting it up (once, by hand)

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
