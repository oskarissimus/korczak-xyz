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

**The MDX names the YouTube id, always.** A song embeds `<Video youtubeId="…" />`.
`Video.tsx` looks the id up in `src/data/videos.json`; with an entry it renders `<video>`,
without one it renders the old `<Youtube>` iframe. So the migration is per song and reversible
per song: a song switches in the commit that adds its manifest entry, and deleting the entry
puts it back on YouTube. The id is also the one key the upload script can read out of the song
file without a lookup table of its own.

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

**The upload runs on a laptop**, through `korczak-xyz/scripts/song-videos.mjs` — see its
header. It needs yt-dlp with the channel owner's browser cookies (anonymous yt-dlp from a cloud
IP is asked to sign in after a couple of dozen videos), or the original files via `--src`;
ffmpeg; and `wrangler login`. The bucket and `media.korczak.xyz` are **not** the script's: they are
declared in `terraform/cloudflare/media.tf` and applied by `.github/workflows/cloudflare.yml`.
It writes the manifest after every song and skips songs already in it, so it can be stopped and
rerun. Nothing in CI runs it.

**The blog's own videos ride the same path.** `<Video>` in a post means *ours, self-hostable*;
`<Youtube>` means somebody else's — the four recorded talks, which live on the organisers'
channels and stay embeds. The script picks up every `<Video>` under `src/content/blog/` once
however many locales carry it, and keys it `blog/<youtubeId>.<hash>` because a post holds several
and has no better name for each; the manifest's `file` carries the `songs/` or `blog/` prefix.
The twelve in `hacked-intercom` and `led-matrix` moved in Oct 2026. One intercom clip is filmed
upright (406×720), which is why `Video.tsx` caps the frame at `80vh` and lets it letterbox.

**The first 36 came from a Google Takeout** of the oskarissimus channel (Oct 2026), through
`--src`. A YouTube Takeout names each video by its *title* and carries no id or metadata file, so
the files were renamed to slugs by hand before the run — `--src` matches on `<slug>.*` or
`<youtubeId>.*` and nothing else. The export is the whole channel (~27 GB) for ~11 GB of songs.
Enabling R2 on the account was a dashboard step too (a $0 subscription that wants a payment
method): until then every R2 call, Terraform's included, fails with `10042`.

`hasSongVideo` (`src/utils/songVideo.ts`) is the one test for "this song has a video", used by
both the page's toggle and the 📺 marker in the list. It accepts `<Youtube` as well, so a song
added the old way still gets both.
