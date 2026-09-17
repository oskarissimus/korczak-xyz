---
name: seo
description: What the site tells crawlers - canonical URLs, the hreflang pairs, which pages are noindex, the sitemap, and the trailing slash that ties all of it together.
paths:
  - "**/utils/seo.ts"
  - "**/utils/seo.test.ts"
  - "**/layouts/Layout.astro"
  - "**/public/robots.txt"
  - "**/public/_redirects"
  - "**/astro.config.mjs"
---

## What the site tells crawlers

Search Console mailed two new reasons on 17 Sep 2026 — *Duplicate without user-selected canonical*
(4 pages) and *Page with redirect* (2) — alongside *Crawled – currently not indexed* (6). The
export is counts only, never URLs, so all three were found by rebuilding and reading the output
rather than by guessing. Both named reasons were self-inflicted and neither was subtle.

**Everything is in `src/utils/seo.ts`.** Canonical, hreflang and noindex are three answers to one
question — *which URL is this page, and does it belong in the index* — and the way they rot is by
living in three places. `Layout.astro` calls `getPageSeo()` and emits what it returns; nothing is
decided per page, so a new route is covered the first time it renders instead of the day somebody
remembers the tag.

### The trailing slash is load-bearing

Astro builds `about/index.html` and Cloudflare 307s `/about` → `/about/`, so **the slashed form is
the only one that answers 200**. That makes an unslashed internal link a redirect for the reader
and a *Page with redirect* for Google. Exactly two existed — the anesthesia admin link in each
locale — and that was the whole of that reason.

Nothing about writing `href="/apps/anesthesia/admin"` looks wrong at the time, so the rule is
tested, not remembered: `seo.test.ts` scans every `.astro`/`.ts`/`.tsx`/`.mdx` under `src/` for an
internal `href` that does not end in `/` (leaf files with an extension excepted). Canonical and
sitemap output goes through `canonicalPath()` for the same reason.

### The app tabs are one page, and now say so

`/apps/transit/`, `/apps/transit/alerts/`, `/apps/transit/raw/` and `/apps/transit/routes/`
server-render the *same* shell: same `<title>`, the same default description, a tab strip and a
skeleton. What makes those routes different arrives from Firestore after hydration and is
per-user, so a crawler sees four identical pages however long it waits — and with no
`rel="canonical"` anywhere on the site, "without user-selected canonical" was the literal truth.
Google clustered them and picked its own winner.

`CANONICAL_PARENT` says it out loud instead: secondary tabs stay crawlable and keep working as
URLs — the tab strip links to them and an installed app precaches them, see `pwa.md` — but point
their canonical at the app root, so each app resolves to one indexed page. The same shape covers
baby-sleep, events, flashcards, transit and typing.

**Do not give a consolidated tab hreflang annotations.** They are only read on a page that is
canonical to itself and may only name canonical URLs; a tab advertising its own two locales
claims to be indexable in the same breath as its canonical disclaims it, and Google resolves the
contradiction by dropping the whole set. The app root carries the pair. Same reasoning keeps
`noindex` pages self-canonical rather than pointing them elsewhere — noindex plus a canonical to
another URL is two contradictory instructions about one page.

### noindex, not Disallow

`NOINDEX` covers the sign-in form, the anesthesia admin panel, the two token-gated share pages,
the sleep-log config tab, `/offline/` and `/404/`. A `robots.txt` `Disallow` would be the wrong
tool twice over: it blocks the *crawl* rather than the indexing, so a linked URL can still be
listed bare, and it stops Google ever seeing the `noindex` it would have obeyed. `follow` is kept
— the links out of those pages are still worth crawling.

### The sitemap must agree with the canonicals

There was none at all before this. `@astrojs/sitemap` filters on `isIndexable()` — the same table
— so it lists only URLs canonical to themselves: 162 of 198 built pages, no noindex page and one
entry per app rather than one per tab. **A sitemap that disagrees with the canonicals is worse
than none**, because it asks Google to index a URL the page itself disclaims.

`public/robots.txt` carries the `Sitemap:` line. Note that Cloudflare injects its Content Signals
block into that file at the edge (Settings → AI Crawl Control), so the served file is longer than
the repo's; before this there was *no* repo file and the served one was that block alone — all
comments, not one directive, no sitemap. The block adds no crawl directives and overrides nothing.

### Only `/404/` and `/offline/` are English-only

Every other route is a matched `en`/`pl` pair, which is what lets `NO_ALTERNATES` be two entries
instead of a lookup. If that stops being true, hreflang starts pointing at pages that 404 — check
it the way it was checked here, by diffing the built URL set against itself with the `/pl` prefix
stripped.
