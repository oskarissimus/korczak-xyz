# Migrating sloper into korczak.xyz

`oskarissimus/sloper` was a Vite + React SPA on GitHub Pages plus a FastAPI/FFmpeg container on
Cloud Run. This is the record of moving it into this repo as `/apps/sloper/`, in the site's Win95
idiom, with the API keys following the account instead of living in one browser.

**The design rationale lives in `.claude/rules/sloper.md`**, loaded automatically when you work on
the app's files. This file is the migration: what moved where, what was verified and how, and what
is deliberately not here.

## The shape it took

Sloper's browser half already fitted the site: every provider — OpenAI, DeepSeek, Google,
ElevenLabs — is called straight from the page, which is what the rest of this site does too. So
the SPA became one React island on one Astro page, and the five stages of the wizard became
in-memory state rather than routes. That is not a shortcut: the assets are `Blob`s held in memory,
so a real navigation between stages would throw away a video that cost money to make.

The one server-side piece is FFmpeg. It landed as a gen-2 HTTPS function in `functions/`,
`assembleVideo`, rather than a second container — the existing deploy path (WIF → terraform →
`firebase deploy`) already reaches there, and a Cloud Run service would have meant a new registry,
a new build and a new workflow for one endpoint. Gen-2 caps a request at 32 MiB, which is exactly
the limit sloper already enforced client-side, so nothing about the contract changed.

| sloper | here |
|---|---|
| `frontend/src/services/*` | `korczak-xyz/src/utils/sloper/*` |
| `frontend/src/contexts/*` | `korczak-xyz/src/hooks/useSloperConfig.ts`, `useSloperRun.ts` |
| `frontend/src/components/*` | `korczak-xyz/src/components/Sloper/*` |
| `frontend/src/data/pricing.json` | `korczak-xyz/src/utils/sloper/pricing.json`, verbatim |
| `backend/` (FastAPI + Docker + Cloud Run) | `functions/src/sloper/` (gen-2 HTTPS function) |
| `localStorage` only | `localStorage` + `users/{uid}/sloper/config` |
| Tailwind | `korczak-xyz/src/styles/sloper.css`, on the site's retro tokens |
| `HashRouter` over 5 routes | one `stage` value in `useSloperRun` |

## Done

**The client**

- [x] `utils/sloper/types.ts`, `defaults.ts` — the shapes, and one paranoid `normalizeConfig`
      that is fed localStorage, Firestore and `JSON.parse` output alike. Migrates sloper's
      `nanoBanana` image provider to `google`.
- [x] `llm.ts` — both providers' SSE, `parseSceneBuffer`, the system prompt, `calculateCost`.
- [x] `images.ts` — OpenAI, Gemini and Imagen; the transparency / brightness / JPEG canvas pass.
- [x] `tts.ts` — ElevenLabs with `previous_text`/`next_text` and the timestamp alignment.
- [x] `validation.ts`, `pricing.ts` — model lists as key validation; the cost estimate.
- [x] `concurrency.ts` — split out of `images.ts` so it is testable without a canvas.
- [x] `drive.ts` — the Google Drive resumable upload, behind `PUBLIC_GOOGLE_DRIVE_CLIENT_ID`.
- [x] `assemble.ts` — the client for the new function, with the Firebase ID token.
- [x] `storage.ts` / `cloud.ts` — one key, one document, one `updatedAt` deciding between them.
- [x] `useSloperConfig` — local / syncing / synced / error, and the pull-before-push gate.
- [x] `useSloperRun` — the whole sitting behind one `AbortController`.
- [x] `components/Sloper/` — five stages, a step strip, a status bar, a skeleton, and
      `translations.ts` in English and Polish.
- [x] `styles/sloper.css` — the property-sheet look, entirely on the existing retro tokens.
- [x] `pages/apps/sloper.astro` and `pages/pl/apps/sloper.astro`; both apps indexes; the two
      i18n keys the indexes read.

**The backend**

- [x] `functions/src/sloper/ffmpeg.ts` — a faithful port of `backend/src/services/ffmpeg.py`:
      same four steps, same flags.
- [x] `functions/src/sloper/metadata.ts` — the bounds FastAPI got free from Pydantic.
- [x] `functions/src/sloper/handler.ts` — token check, CORS, busboy, temp files, cleanup.
- [x] `functions/src/index.ts` — `assembleVideo`, 2 GiB, 540 s, `concurrency: 1`, `maxInstances: 3`.
- [x] `busboy` and `ffmpeg-static` added to `functions/package.json`.
- [x] `terraform/functions.tf` — the public invoker binding. **Lands on a second push**, see below.

**Documentation**

- [x] `.claude/rules/sloper.md`, and its row in `CLAUDE.md`'s table.
- [x] `terraform/README.md` — the ownership table, and the two-pass rule for a new HTTP function.
- [x] `functions/README.md` — what the third function in there is.
- [x] `korczak-xyz/.env.example` — `PUBLIC_GOOGLE_DRIVE_CLIENT_ID`, `PUBLIC_SLOPER_ASSEMBLE_URL`.

## How it was verified, without any API keys

Everything below was actually run, not reasoned about.

**The FFmpeg pipeline, for real.** `ffmpeg-static`'s binary made two stills at sizes the image
models really serve (1024×1024 and 1024×1792) and two MP3 narrations; `assemble()` was called on
them directly. Output: a 4.11 s MP4, `h264 (High) … yuv420p … 1024x1536 … 24 fps` plus
`aac (LC) 44100 Hz`, built in 2.1 s. So the port letterboxes mismatched sizes, produces a
pixel format every player accepts, and reports a duration matching the sum it was given (4.1).

**The whole wizard, with every provider intercepted.** Playwright against `astro dev`, with
`api.openai.com`, `api.elevenlabs.io` and the image endpoint routed to fixtures — a chunked SSE
stream split every 17 characters, a real JPEG as `b64_json`, a real MP3 with a synthetic
character alignment. Result: the model list filtered and auto-picked (`gpt-4o`, with `whisper-1`
and `dall-e-3` correctly excluded), three scenes parsed incrementally out of the split stream
**including one whose image description contains `{stylised}` and one containing `"il caffe"`**,
six assets complete, each picture through the canvas pass and each narration's duration read from
the alignment (2.3 s). No console errors beyond the dev server's own missing `sw.js`.

**The last stage, as a signed-out visitor gets it.** "Sign in before assembling — the assembler is
not open to the internet", with Try again. That is the correct refusal: the function is not
deployed yet and the visitor is not signed in.

**The seam between the two runtimes.** `functions/src/sloper/handler.test.ts` builds a multipart
body with the platform's own `FormData` — the same serializer the browser's `fetch` uses — and
reads it with the real busboy parser, asserting the part names and, more importantly, the file
ordering: the pipeline pairs `images[i]` with `audio[i]` with `scenes[i]`, so a reordering would
produce a video whose narration drifts one scene further out of step with every cut.

**Unit tests**, 46 in the site and 16 in the functions, all passing alongside the existing 1595:

- `llm.test.ts` — the brace walker against escapes, braces in strings, half-written objects, and
  the prompt naming the two keys the parser looks for.
- `defaults.test.ts` — every degradation path of `normalizeConfig`, the clamps, the `nanoBanana`
  migration, and which keys a given provider pair actually requires.
- `pricing.test.ts` — including that the estimate is quoted for the size the request will be
  *normalized to*, not the one asked for.
- `concurrency.test.ts` — a rejection frees its slot; a synchronous throw rejects rather than
  escaping the pump.
- `tts.test.ts` — the final word closes, which is what the scene duration is read from.
- `metadata.test.ts` — the bounds that stop a request becoming an out-of-memory kill.

`npm run build` in `korczak-xyz/` and `npm run build` in `functions/` both clean;
`npx tsc --noEmit` reports nothing in any sloper file.

**And then, against the deployed function**, once both pushes had landed:

```
POST, no token        401 {"error":"UNAUTHENTICATED","message":"Sign in first."}
POST, bad token       401 {"error":"UNAUTHENTICATED","message":"That sign-in is not valid…"}
OPTIONS, korczak.xyz  204 + access-control-allow-origin: https://korczak.xyz, vary: Origin
OPTIONS, evil.test    204 + no access-control-allow-origin at all
```

So the endpoint is reachable from a page, refuses an anonymous one, quotes nothing back to a
caller it did not recognise, and the allowlist really is an allowlist.

## What still needs a human

- [ ] **End-to-end with real keys.** Nothing here has ever called OpenAI, Google or ElevenLabs
      for real. The request shapes are ports of code that worked, but that is not the same thing.
- [x] ~~The two-pass landing of the terraform binding.~~ Done: `1003734` shipped the function,
      `e30094b` the binding, both green. Worth recording what the first pass showed — the
      freshly deployed function answered a preflight with **403**, which is the state
      `sendTestPush` was in before its own binding, so the binding was not paperwork. One-off per
      function; the ordering is right for ever now. See `terraform/README.md`.
- [ ] **First real assembly.** Worth watching `maxInstances: 3` and the 540 s timeout against a
      twelve-scene run; both are guesses from the Python version's 300 s.
- [ ] **`PUBLIC_GOOGLE_DRIVE_CLIENT_ID`**, if the Drive button is wanted. Unset, it does not
      render, which is the right state until an OAuth client naming `korczak.xyz` exists.

## Landed

| commit | what |
|---|---|
| `1003734` | the app, the function, the tests, the docs |
| `e30094b` | `terraform/functions.tf` — the public invoker binding, second pass |

## Not migrated, deliberately

- **The FastAPI backend, its Dockerfile, `cloudbuild.yaml` and the Cloud Run workflow.** Replaced
  by the function. The FFmpeg logic itself is a faithful port.
- **`ffprobe`.** `ffmpeg-static` ships only `ffmpeg`. The Python version probed the finished file
  for a duration that is only ever displayed; the duration reported now is the sum of the scene
  durations the client sent, which is what the video was built to.
- **`frontend/e2e/video-generation.spec.ts`.** It drove the SPA against fixture providers through
  `VITE_*` env vars that do not exist here, and this repo has no browser-test harness to commit a
  replacement into. What it covered is covered by the unit tests plus the mocked walkthrough
  described above.
- **`react-router-dom` and the four React contexts.** One hook, one page.
- **Tailwind.** The site has its own idiom and its own tokens.
- **A PWA manifest and a service-worker tier.** Deliberate: an installable app here is one you
  reach for away from a desk, and this app's whole state dies with the tab.
- **sloper's `DEPLOYMENT.md` and `CLAUDE.md`.** Superseded by `.claude/rules/sloper.md` and the
  two README notes.
