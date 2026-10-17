---
name: songbook
description: The songbook at /songs - chord lines aligned in characters, and why .chord-line must never be synthetically bold.
paths:
  - "**/content/songs/**"
  - "**/utils/chords.ts"
  - "**/utils/chordDiagram.ts"
  - "**/styles/song.css"
  - "**/styles/chordMarks.css"
  - "**/styles/chordAlignment.test.ts"
  - "**/components/Song*"
  - "**/pages/**/songs/**"
  - "**/SongPostPage.astro"
  - "**/components/Video.tsx"
  - "**/components/Auth/AdminVideos.tsx"
  - "**/data/songVideos.json"
  - "**/utils/songVideoInbox.ts"
  - "**/workflows/song-video-inbox.yml"
  - "**/components/Youtube.tsx"
  - "**/data/videos.json"
  - "**/scripts/song-videos.mjs"
  - "**/utils/songVideo.ts"
---

## Songbook

Songs are fenced `plaintext` blocks at `src/content/songs/pl/`, chord line above lyric line,
aligned **in characters**: the chord at column N is drawn over the character at column N below
it. `SongPostPage.astro` re-emits each line verbatim inside `<span class="chord-line">` and lets
`white-space: pre-wrap` in a monospace font do the positioning. Transposition is the only thing
that rewrites a chord line, and `transposeLine` puts every chord back at the column it started
in for exactly this reason.

So nothing may change the chord line's metrics, and `.chord-line` in `song.css` carries the
list. `font-weight: bold` was on it for years and is the trap: we self-host VT323 at weight 400
only, so bold is **synthesised**, and WebKit's CoreText backend synthesises it by adding
`size / 36` to the advance of every glyph (`m_syntheticBoldOffset` in `FontCoreText.cpp`, added
to the advance in `WidthIterator.cpp`). Against VT323's 0.40em cell that is 1/14.4 of a cell per
character — **a ratio independent of font size**, so no size setting escapes it. The chord line
stretched against the lyrics beneath it and a chord at column N drew at column N × 1.069: half a
cell out by column 8, a whole character by column 14, two by column 29. In `Sto psot` the D sits
at column 14 of `Bo koty lubią psoty`, which is the `p` of *psoty*; it drew at 14.97, over the
`s`. Every chord past the first few in the song was wrong, and the further right, the wronger.

It is invisible on anything but an Apple device, which is what makes it worth writing down.
Skia and FreeType embolden by stroking the glyph and leave the advance alone, so Chromium and
WebKit-on-Linux both place the chord exactly — measured at 0.01px — and only Safari and the
installed songbook show the drift. A rendering test here can therefore never catch it.
`src/styles/chordAlignment.test.ts` reads the stylesheet as text instead and guards the
declaration, the way `pwa/tiers.test.ts` guards facts no test can reach by running the thing.

The weight is kept as paint: `text-shadow`, which is what WebKit itself draws for synthetic bold
(the glyph again, offset by `size/36`) minus the part that reaches the layout. Same rule, same
reason, as the boxed marks in `chordMarks.css` — a glyph's ink may overhang, its advance may not.

The side layout (`renderSideLayout`) is exempt from all of this: it strips the positioning
spaces and puts the chords in their own flex column, so `.chord-col` may be bold and is.

## Videos

The songs' videos are Oskar playing them, and they are served from our own R2 bucket,
`korczak-xyz-media`, at `https://media.korczak.xyz/songs/<slug>.<hash>.mp4` with a `.jpg`
poster beside it. They were YouTube embeds until Oct 2026.

**Why R2 and not the site's own assets.** The Worker's static assets cap a file at 25 MiB and
most of these are bigger, and a gigabyte of video in git history is a cost every clone and every
CI checkout pays. R2 is the same vendor and the same zone, has no egress charge, and its custom
domain is cached at the edge like the site is. A GCS bucket was weighed and lost: GCS bills
egress, and HTTPS on our own hostname would have needed a load balancer.

**Why plain MP4 and not HLS.** The clips are one to five minutes of one guitarist. 720p H.264
with `+faststart` plays natively everywhere, iOS included, with no player script, and seeks by
Range request. Adaptive bitrate would buy little at that length and cost `hls.js` on every
browser that is not Safari.

**A song's video is keyed by its slug, and its MDX does not mention it.** `src/data/songVideos.json`
maps slug → `{ file, width, height }`, and `SongPostPage` draws `SelfHostedVideo` above the song from
it. So a new recording is one line in one JSON file and no edit to the song, which is what lets a
workflow publish it (*Adding a recording* below). Until Oct 2026 each song embedded
`<Video youtubeId="…" />` and the manifest was keyed by that id — the key both YouTube and R2 had,
during the migration. With every song moved and new ones never on YouTube, the id was keying a
video by a site that no longer serves it; the 36 entries were re-keyed by slug and the tags removed.

The blog keeps the old shape: `<Video youtubeId>` in the post, `videos.json` keyed by that id,
YouTube as the fallback for an id not in it.

**Files are named by content hash** and served `max-age=31536000, immutable`. A re-encode is a
new name, and the manifest commit is what points the page at it, so no cache ever has to be
purged. The old object can be left in the bucket or deleted by hand.

**A video reached by a click needs `load()` again.** `ClientRouter` parses the next page in a
DOMParser document before moving it in, and Chromium starts a `<video src>` loading the moment
it is parsed — where, with no window, it fails with *Media load rejected by URL safety check*
and never retries after the move. Every song opened from the list showed a dead player until a
reload; the iframe never had this. The `astro:after-swap` handler in `Layout.astro` calls
`load()` on any video carrying an error, which with `preload="none"` downloads nothing.

**Offline** the video is as unavailable as the iframe was: the service worker never touches
cross-origin requests (`src/sw/routing.js`), and `media.korczak.xyz` is one. The
`.video-embed.is-offline` overlay covers both. Caching a 10–45 MB file per song would be an
opt-in per song, never part of the `songs` tier.

**Every upload goes through `korczak-xyz/scripts/song-videos.mjs`** — see its header. A song's video
comes only from `--src`, a file named `<slug>.*`; a blog one may still come from yt-dlp with the
channel owner's browser cookies (anonymous yt-dlp from a cloud IP is asked to sign in after a
couple of dozen videos). It needs ffmpeg and a wrangler with R2 access. The bucket and `media.korczak.xyz` are **not** the script's: they are
declared in `terraform/cloudflare/media.tf` and applied by `.github/workflows/cloudflare.yml`.
It writes the manifest after every video and skips ones already in it, so it can be stopped and
rerun.

### Adding a recording

From `/apps/admin/` (*Song videos*, admins only): pick the song, pick the file, upload. That is the
whole of it for the owner; what happens next is three pieces, each where it is for a reason.

- **The panel** (`AdminVideos.tsx`) uploads straight to the sloper bucket at
  `videoInbox/<slug>/<uploaded-at>-<name>` (`songVideoInbox.ts` is the one spelling of that path),
  resumable, because a phone's recording is hundreds of megabytes. It cannot go to R2 directly: the
  site has no server to sign an upload with, and neither the Cloudflare token nor the right to push
  belongs in a browser. Firebase Storage already takes uploads from here with the rules as the gate.
- **`storage.rules`** opens `videoInbox/` to admins only — the one path outside `users/{uid}/`, and
  the one an approved account cannot touch, because whatever lands there is published under a
  song's name. Video content type, a slug-shaped folder, 4 GiB, sloper bucket only.
  `functions/src/storageRules.test.ts` holds it, with the two Firestore lookups stubbed — the
  Storage emulator would not resolve them, on the old `users/` paths either.
- **`.github/workflows/song-video-inbox.yml`** looks every ten minutes, runs the script on the
  newest take per song, commits `songVideos.json` as `github-actions[bot]`, starts `node.js.yml`
  with `gh workflow run` (a push made with `GITHUB_TOKEN` starts no workflow by itself), and only
  then deletes the original. A file it cannot use moves to `videoFailed/`, which the panel lists.

**A schedule rather than a trigger** because anything a browser can reach that starts a workflow
needs a GitHub token with `actions: write` — made by hand, renewed, kept in a function. The poll
needs no new secret and costs nothing on a public repository; an empty inbox ends the run after the
auth step. GitHub runs schedules late under load, so "ten minutes" is usually within twenty. If
that ever matters, a Storage-triggered function that dispatches the workflow is the upgrade, and
the token is its price.

A song with a video already gets the new one in its place: a new content hash, a new manifest
line, and the old object left in the bucket.

**The blog's own videos ride the same path.** `<Video>` in a post means *ours, self-hostable*;
`<Youtube>` means somebody else's — the four recorded talks, which live on the organisers'
channels and stay embeds. The script picks up every `<Video>` under `src/content/blog/` once
however many locales carry it, and keys it `blog/<youtubeId>.<hash>` because a post holds several
and has no better name for each, in `videos.json`; each manifest's `file` carries its `songs/` or `blog/` prefix.
The twelve in `hacked-intercom` and `led-matrix` moved in Oct 2026. One intercom clip is filmed
upright (406×720), which is why `Video.tsx` caps the frame at `80vh` and lets it letterbox.

**The first 36 came from a Google Takeout** of the oskarissimus channel (Oct 2026), through
`--src`. A YouTube Takeout names each video by its *title* and carries no id or metadata file, so
the files were renamed to slugs by hand before the run — `--src` matches on `<slug>.*` or
`<youtubeId>.*` and nothing else. The export is the whole channel (~27 GB) for ~11 GB of songs.
Enabling R2 on the account was a dashboard step too (a $0 subscription that wants a payment
method): until then every R2 call, Terraform's included, fails with `10042`.

`hasSongVideo` (`src/utils/songVideo.ts`) is the one test for "this song has a video", used by the
page's toggle, the 📺 marker in the list and the panel's song picker. It is the manifest entry, or a
`<Youtube`/`<Video` left in a song's body by hand.
