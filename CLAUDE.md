# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

The Astro site is `korczak-xyz/`; all npm commands run from there. `resume/` is a separate
subproject.

## Where it runs

Two vendors, one each side. **Cloudflare** serves the site: `korczak-xyz/wrangler.jsonc` declares a
Worker that is nothing but its own static assets, and the build is a plain `astro build` with no
adapter — no SSR, no API routes, nothing running per request. **GCP** (`korczak-xyz-501720`) is the
backend: Firestore, two gen-2 Cloud Functions in `europe-central2`, Cloud Scheduler, Secret
Manager, and the project layer in `terraform/`. The browser talks to Firestore directly, so those
two halves meet in the client and not on a server.

This was Netlify until August 2026, behind Cloudflare's proxy — which meant two CDNs in the path,
one of them earning the hop by serving 370 static files. `_headers` and `_redirects` are the same
file format on Cloudflare, so nothing about the cache tiers or the redirects moved.

**The Netlify site still exists, unlinked, and is still the rollback.** The apex is claimed by a
Worker *route* rather than a custom domain, so the DNS record is untouched and still names Netlify
as the origin behind it — deleting the route in `wrangler.jsonc` hands the site straight back, with
no DNS edit and no propagation. Once that site is deleted the record is dead weight; see the note
in `korczak-xyz/wrangler.jsonc` for what this should become then.

**Two things must happen before that site is deleted**, and both are invisible until it is too
late:

1. **`www.korczak.xyz` is still Netlify's.** It 301s to the apex, and that redirect is served by
   Netlify — `www` is not routed to the Worker. It cannot be: Cloudflare rejects a deploy whose
   `_redirects` source is absolute (*"Only relative URLs are allowed"*), so unlike `_headers`, that
   file cannot match on hostname. The replacement is a zone **Single Redirect** — hostname equals
   `www.korczak.xyz` → 301 `https://korczak.xyz`, preserving path and query — which terminates at
   the edge and needs no origin at all. Until that exists, deleting the Netlify site breaks `www`.
2. **`PUBLIC_VAPID_PUBLIC_KEY`** was read out of Netlify's production context into
   `.env.production`. It is the only value that ever lived *only* there.

## Solitaire Game

The solitaire game is at `/apps/solitaire/`. A JavaScript debug interface is available at
`window.solitaire` when the game is loaded — see the `solitaire-debug` skill.

## Where the rest of this lives

The per-app documentation is in `.claude/rules/`, loaded automatically when you work on files
that app owns. Each file is the design rationale and the failure contracts for one app — the
things the code cannot explain about itself. Read the relevant one before changing behaviour
there; they exist because most of what is in them was learnt by breaking something.

| File | Covers |
|---|---|
| `.claude/rules/typing.md` | The typing trainer: progress sync by lineage, Firestore client health, the localStorage budget, frontend logging |
| `.claude/rules/flashcards.md` | The guitar flashcards: both decks, the shared SM-2 scheduler, the mixed sitting, the neck cards and the chord cards |
| `.claude/rules/baby-sleep.md` | The baby sleep log: entries, routines, stats, the climate tab, targets, sharing |
| `.claude/rules/events.md` | Event Watch: the corpus, the one matcher in two runtimes, web push, the classifier, Terraform |
| `.claude/rules/pwa.md` | The installable apps: manifests, the service worker and its tiers, the safe area, fonts |
| `.claude/rules/charts.md` | Every chart: why no series is read by colour alone, the shared marks, the pointer readout |
| `.claude/rules/songbook.md` | The songbook: chord lines aligned in characters, and the synthetic-bold trap |

If you are working somewhere these globs do not reach and something here seems to have a reason
behind it, read the matching file before assuming there is not one.

## The section is `/apps/`, and was `/games/`

Everything under it used to live at `/games/`. Most of it is not a game — the typing trainer, the
guitar flashcards, the tuner, the baby sleep log, the pregnancy calendar, the anesthesia quiz — and
the heading was picking the wrong word for six of nine things. The three that really are games
(solitaire, minesweeper, pipes) lose nothing by sitting under one that does not claim to describe
them.

The move is the paths and the label, nothing else. Local storage keys, Firestore collections and
every card id are untouched, because none of them ever carried the section name; so nobody's
progress, schedule or sleep log noticed. Inside the games the word stays the word — `gameState`,
`New Game`, `solitaire.newGame` are about a game and are still right.

`public/_redirects` 301s `/games/*` to `/apps/:splat` in both locales. The four old
fretboard/transpose rules are listed **before** that catch-all, because first match wins and
`/games/fretboard` has to reach the flashcards rather than an `/apps/fretboard` that does not
exist; each of those four is also written a second time under `/apps/`, for the bookmark that
comes back through the catch-all.

The cost is the one the flashcards merge already paid, and it is worth knowing before renaming a
route again: **an installed app's `start_url` now 301s out of its own scope**, so iOS opens the
tuner, the flashcards and the sleep log in Safari rather than in the app. There is no way to hand
an existing install a new identity — deleting the icon and installing once from the new URL is the
whole fix. The songbook and the site app are unaffected, their paths not having moved.

## Localization (i18n)

The site supports English (default) and Polish. All user-facing strings should be localized —
see the `i18n` skill for how.

## Workflow

When work is finished, commit and push directly to `main`. Don't create feature branches
or pull requests for routine work unless I explicitly ask for one.

Claude Code on the web doesn't honour this on its own: each cloud session is assigned a
generated `claude/<slug>` branch in its **system prompt**, which outranks this file. There is no
setting to turn that off — the session form's branch picker only chooses what you start *from*,
and the "Allow unrestricted branch pushes" toggle applies to Routines, not interactive sessions.
So `.claude/hooks/session-start.sh` restates the rule as a `SessionStart` hook, whose
`additionalContext` lands ahead of the first prompt where the session actually reads it. In cloud
sessions only, it also checks out `main` when the assigned branch is still untouched — a clean
tree sitting exactly on `origin/main`. A branch that already carries work is left alone, so the
hook is safe on resume. This is a workaround for injected prompt text, not a supported switch; if
web sessions start ignoring `main` again, that prompt likely changed.

### End every push with the hash and the time

After pushing, the **last line of the reply** is the short commit hash and the push time. Nothing
after it. That line is what I read: I am watching the navbar's status bar for the deploy to land,
and it prints exactly `git rev-parse --short HEAD` next to a timestamp, so the reply has to give me
the two strings I am about to compare against. Burying them in a paragraph, or writing "pushed to
main" without them, means opening a terminal to find out what I am waiting for.

Format, one line, at the very end:

```
`4a1ccf8` · pushed 06:54 UTC / 08:54 Warsaw · 11 Aug 2026
```

- **Short hash**, from `git rev-parse --short HEAD` — the same command `Navbar.astro` runs at build
  time, so it is character-for-character what the status bar links to.
- **Both clocks.** The navbar renders its timestamp with `toLocaleString` in the *viewer's* zone,
  which for me is Europe/Warsaw (`+0200` in summer, `+0100` in winter) while this container runs in
  UTC. Giving only one of them leaves me doing the arithmetic on a phone.
- Several pushes in one reply: one line each, in order, oldest first.

One thing that line does **not** promise: **the navbar timestamp is the build time, not the commit
time.** It is `new Date()` evaluated while GitHub Actions builds, so it lands a minute or two after
the push and will never match to the minute. The *hash* is the thing that matches exactly — compare
on that.

### Don't make me poll for the deploy — read it off the site

GitHub Actions builds, tests and deploys every push to `main` — the `build` job in
`.github/workflows/node.js.yml` ends in a `wrangler deploy` to Cloudflare. So the push is not the
end of the job, and the answer to "has it landed yet" is a request away rather than something to
hand back to me:

```
curl -sS https://korczak.xyz/ | grep -o 'commit/[0-9a-f]\{7,\}' | head -1
```

That is the deployed commit, straight from the status bar's own markup — the same string the navbar
links to, so it settles the question exactly. `data-timestamp="..."` on the same page carries the
build time. The HTML is served `max-age=0, must-revalidate` (`korczak-xyz/public/_headers`), and
Cloudflare edge-caches it now — responses say `cf-cache-status: HIT` where under Netlify they said
`DYNAMIC`. **That HIT is a revalidated one, not a stale one**: `must-revalidate` makes the edge
check the Worker before answering, so the poll is still exact. Measured on the cutover deploy, the
new hash came back on the very first request, 0s after `wrangler deploy` returned. Poll every
15–30s; a deploy takes a couple of minutes — the tests run before it.

**Wait for it before signing off**, unless I have said not to. Report the hash as *live* only once
the site has actually served it, and say plainly if it has not landed yet rather than implying it
has. If it has not flipped after ~10 minutes, say so and stop polling — that is a failed build, and
I would rather hear it than watch a phone.

**Every commit deploys, so always poll.** This used to have an exception worth checking for:
Netlify's base directory was `korczak-xyz/` and its monorepo default skipped any build whose commit
changed nothing under it, so a commit touching only root-level files never deployed and the status
bar kept an older hash. Actions has no such rule and the deploy step is unconditional on `main`, so
the hash on the site is always `HEAD` — including after a commit that only edits this file. There
is no longer a case where polling is the wrong thing to do.
