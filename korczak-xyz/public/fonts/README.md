# Self-hosted fonts

`VT323` (v18) and `Press Start 2P` (v16), latin and latin-ext subsets, vendored from Google
Fonts. Both are licensed under the SIL Open Font License 1.1:

- VT323 — Peter Hull. <https://fonts.google.com/specimen/VT323/license>
- Press Start 2P — CodeMan38. <https://fonts.google.com/specimen/Press+Start+2P/license>

They are served from this origin rather than `fonts.gstatic.com` for two reasons. A home screen
web app has to render with no network at all, and the song pages align chords over lyrics by
character cell — losing VT323's metrics misaligns every chord chart, so falling back to a
system font is not a graceful degradation here. Self-hosting also drops a render-blocking
third-party stylesheet from all 43 pages.

**latin-ext is not optional.** Every Polish diacritic except `ó` lives in `U+0100-02BA`, so the
`/pl` locale and the song lyrics need that subset.

To update, re-fetch the `woff2` URLs from the Google Fonts CSS API with a modern browser
user-agent, and bump the version in the filenames — the filename is the cache key, since
`public/_headers` serves this directory `immutable`.
