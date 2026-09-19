---
name: accounts
description: Who may use this site - self-service sign-up, the approval a human has to give before an account can read or write anything, the admissions panel at /admin/, and the two rules files that are the actual gate.
paths:
  - "firestore.rules"
  - "storage.rules"
  - "**/lib/account.ts"
  - "**/lib/access.ts"
  - "**/lib/authCache.ts"
  - "**/hooks/useAuth.ts"
  - "**/components/Auth/**"
  - "**/pages/**/apps/admin.astro"
  - "**/pages/**/apps/index.astro"
  - "**/pages/**/login.astro"
  - "terraform/iam.tf"
---

## Signing in is not the same thing as being let in

Anyone can create an account at `/login/`. A new account can read and write **nothing** — not its
own typing progress, not the public event corpus, not a byte into the sloper bucket — until the
owner approves it at `/admin/`. That is the whole feature, and the interesting part is where the
"nothing" is enforced.

### Before September 2026 there was no policy, only a switch

Sign-up was disabled at the Identity Platform level. An account existed because Oskar had made it
by hand in the Firebase console, so holding a token and being welcome were the same fact, and every
rule in `firestore.rules` could say `signedIn()` and mean it. Two accounts were ever made this way:
his, and one invitee's.

That switch is now off, and `accounts/{uid}.approved` is what replaced it.

### The gate is the two rules files, and nothing else

`approved()` in `firestore.rules` resolves `accounts/{request.auth.uid}` and asks one question of
it. Every block in that file goes through it — including the public-looking corpora, `events/` and
`transitItems/`, which are readable rather than secret but would otherwise be a way for a stranger
with an account to pull a few thousand documents in a loop.

`storage.rules` asks the same question across the service boundary, with `firestore.get()`. That is
a **cross-service rule**, and it has a dependency nothing in the file can show you: the lookup runs
as the Cloud Storage for Firebase service agent, which needs `roles/firebaserules.firestoreServiceAgent`.
The grant is `firebasestorage_reads_firestore` in `terraform/iam.tf`, and the deploy workflow's
`terraform` → `deploy` ordering is what makes it land before the rules that need it. Pull the grant
and every upload 403s — the safe direction, and a completely silent one from the browser.

A missing account document denies in both files, by the same mechanism: `get()` on a document that
is not there returns null, `.data` off null is an evaluation error, and an evaluation error is a
denial. An account created straight in the console writes nothing here, so it too starts at zero.

**Adding a `match` block without `approved()` in it re-opens that path to anyone who can fill in a
sign-up form.** There is no catch-all that grants.

### The rules have a test, and the deploy waits for it

`functions/src/rules.test.ts` runs the whole policy against the real rules engine in the Firestore
emulator — approved, pending, admin, impostor, fresh sign-up — and the `deploy` job in
`.github/workflows/firebase-deploy.yml` runs it before pushing anything out. It is skipped by an
ordinary `npm test` (no `FIRESTORE_EMULATOR_HOST`), the same way the live source smoke test is
skipped without `LIVE=1`. To run it by hand, from the repository root:

```
npx firebase-tools@15 emulators:exec --only firestore --project demo-rules \
  "npm test --prefix functions -- src/rules.test.ts"
```

It is in `functions/` because that is the package that carries the emulator's devDependency and
because the site's `npm test` should stay a two-second vitest run. **If a change to the rules means
deleting one of those cases, that is the change asking for a second opinion.**

### What the client does, and why it is not security

`useAuth` reports `user: null` for an account that is signed in but not approved, so all thirty-odd
components that read `auth.user` behave exactly as they do when nobody is signed in: they work
locally and offer to sync later. One line instead of thirty edits, and it means an unapproved
session never fires a request the rules are going to refuse.

The four states — `signed-out`, `checking`, `pending`, `approved` — come out of `decideAccess` in
`src/lib/access.ts`, which is pure and has the whole table in `access.test.ts`. It is separate
because three answers arrive at three different times (the localStorage cache synchronously,
Firebase's session after an IndexedDB round trip, the account row after a Firestore one) and both
ways of getting the order wrong are silent: too eager and a revoked account writes into a Firestore
that refuses it, too cautious and every approved user's apps blink through "signed out" on every
page load.

`authCache` holds **approved accounts only**. That is what lets the first paint skip both round
trips, and it is why a pending account leaves no address behind for the navbar's pre-paint script.

### The account row

One document per account at `accounts/{uid}`, created by the client on first sign-in
(`ensureAccount`) because only the browser is present for every way an account can appear — the
form, the console, a provider link. The subject may write it, and the rules pin every field to
something already in their own token:

| field | who writes it | what it means |
|---|---|---|
| `email` | subject | lowercased, and must equal the token's address |
| `emailVerified` | subject | a mirror of the token claim — the panel cannot read anybody else's token |
| `approved` | admin | the verdict. False on create and unchangeable by the subject |
| `emailTrusted` | admin | this address is theirs although the provider never verified it |
| `createdAt` | subject, once | `0` on the two accounts that predate the panel; the UI says so rather than inventing a date |
| `lastSeenAt` | subject | refreshed at most twice a day, so it is not a write per page load |

So the most a stranger gets out of the one writable path in the whole file is a document saying
"this is my address and I am not approved" — which is exactly what the panel needs.

### `emailTrusted` exists for one collection

The household share is keyed by **address** (`shares/{email}`), not by uid, which is why the old
`firestore.rules` carried a shouted warning: enable sign-up and a stranger can register an invited
address and walk in. `trustedEmail()` is the answer — `email_verified`, or an admin's explicit
vouch — and it guards the share document and the four shared collections.

The vouch half is there because both pre-existing accounts are unverified: they were made in a
console, which sends no verification mail, so a bare `email_verified` check would have locked the
household out of its own shopping list on the deploy that shipped this. **For anybody who signs up
through the site, leave it off** — their verification mail is better evidence than a memory of who
asked.

### Where the panel is

`/apps/admin/`, and it is in the list at `/apps/` like everything else — as a card `AdminAppCard`
draws only for an admin. It shipped at `/admin/`, reachable from one link on the login page, which
is a page nobody opens once they are signed in; in practice that meant reachable by typing its
address. `_redirects` 301s the old path, both locales.

Hiding the card protects nothing — the page and the rules behind it refuse everybody else anyway.
It keeps a card that fourteen out of fifteen visitors cannot use off a list whose whole job is to
be a list of things you can open.

One mechanical note, which will look arbitrary in six months: **`styles/appsList.css` is
global.** Astro's scoping attaches to elements in the template, so a scoped rule reaches nothing an
island paints — and the block was two identical copies, in the English and Polish index pages,
which had to be edited together and silently did not. The island itself sits inside the `<ul>` as
an ordinary item: Astro gives `<astro-island>` `display: contents`, so the `<li>` is the flex item
and a card that renders nothing for everybody else occupies nothing.

It is deliberately **not installable**: no manifest, no icon, no precache tier. `apps.ts` says what
qualifies — "a thing you reach for away from a desk" — and approving an account once a fortnight is
not it. Making it one is an SVG, `npm run icons`, a `PWA_APPS` entry, a scope pattern and two tier
lists, and nothing about the panel needs to work in a tunnel.

### Admins

`admins/{uid}`, `write: if false`. Appointing an admin is a console or Admin SDK job on purpose:
an admin who can appoint admins turns one stolen session into a second permanent owner. There is
one row in it.

`/apps/admin/` checks `isAdmin` to decide **what to draw** — a queue of other people's addresses is not
something to show a stranger — and the rules decide what it may do. The panel offers no button to
revoke or forget your own row: undoing that from a site that has just started refusing you is too
subtle a rescue to rely on at the moment you would need it.

### The one piece that is not in git

Self-service sign-up is a **console setting**: Firebase console → Authentication → Settings → User
actions → *Enable create (sign-up)*. Terraform could own it (`google_identity_platform_config`),
and deliberately does not: that resource is a singleton whose create fights an Identity Platform
that is already initialised, and a failed apply in this repo blocks the rules deploy that is the
actual gate. So it sits beside the `www` redirect as a dashboard object — if `/login/` starts
answering "New accounts are switched off at the moment" (`auth/admin-restricted-operation`), that
switch is where to look, not here.

### Cost, and when this stops being the right shape

Every evaluated rule costs one `get()`, billed as a read and cached within a request. On a database
with a handful of people that is noise. Custom claims are the answer at a scale this site does not
have — and they are worse here for two reasons worth remembering before reaching for them: a claim
is minted into the ID token, so a revocation takes up to an hour to bite, and setting one needs the
Admin SDK, which puts a Cloud Function in the approval path. A document is read at the moment of
the request, and the panel is one `updateDoc` from a browser.
