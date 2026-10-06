---
name: backseat
description: The annoying passenger simulator at /apps/backseat/ - the ride loop and why it is a chain of timeouts, the prompt that is the whole app, what the camera frame costs, the two voice engines and the iOS gesture, and the one sentence that must stay on the screen.
paths:
  - "**/utils/backseat/**"
  - "**/components/Backseat/**"
  - "**/hooks/useBackseatConfig.ts"
  - "**/hooks/useBackseatRide.ts"
  - "**/styles/backseat.css"
  - "**/pages/**/apps/backseat.astro"
  - "**/pages/**/apps/roaster.astro"
  - "**/assets/icons/roaster.svg"
  - "**/assets/icons/backseat.svg"
---

## Annoying Passenger Simulator

> **Two apps run on this code since Oct 2026.** `/apps/roaster/` is the passenger with the car
> taken out — point the phone at anything and it roasts what it sees. Same island
> (`<Backseat flavour="roaster">`), same hooks, same engines; see *The roaster* at the end of this
> file for what differs and why. Everything below about the plumbing applies to both.

At `/apps/backseat/` — the phone looks out of the windscreen every few seconds and says the sort of
thing a passenger says when they are not the one driving. "Oh, slow down." "Mind that lorry."
"Are we there yet?" Paid for with the reader's own API keys, on the same terms as sloper.

It is **entirely in the browser**. There is no function, no bucket, no collector — a frame goes
from a canvas to OpenAI or Google and a sentence comes back to a speaker. The only thing the
account does is hold the keys. That is the whole architecture, and it is worth saying plainly
because every other app here that talks to a provider has a server half and this one has none to
find.

### Google is the default, since Oct 2026

The app shipped on OpenAI's `gpt-4o-mini`, and on 1 Oct 2026 the account it ran on went dry
mid-drive: *"You have no credits remaining"*, in the banner, every round. The default is now
provider `google`, model `gemini-2.5-flash-lite`, free on an ordinary AI Studio key (15 a minute,
about a thousand a day). For its first hour it was `gemma-3-27b-it`, and the first ride on Gemma
answered a pavement with a heading, *"Nervous passenger."*, and flat lines after it; configs put
on Gemma by that migration move to Flash-Lite once (`SMARTER_SWITCH_AT`), and `sanitizeRemark`
now skips a heading line (`isHeading`). A 2.5 Flash gets `thinkingBudget: 0`, because its thinking
counts against the 120-token cap and would leave no remark. OpenAI is still on the list. A config saved on OpenAI before the switch (`updatedAt` earlier than
`GOOGLE_SWITCH_AT`) is moved to Gemma once, on the first signed-in load, with its own Google key or
the wizard's (`switchedToGoogle`) — its owner could not paste a key from the car. Anything chosen
after that is left alone.

Two things about Gemma on Google's API that Gemini does not share:

- **No `systemInstruction`.** Gemma answers it with a 400 (*"Developer instruction is not
  enabled"*), so `askGoogle` puts the system prompt at the head of the user turn for any `gemma*`
  model. Gemini still gets the field.
- **Not every Gemma sees.** The 1B, the 270M and the 3n family take text only through
  `generateContent`; `filterGoogleVisionModels` leaves them out and puts the rest first, largest
  first, because the first entry is what the setup sheet picks when the saved model is not on
  offer.

### The wait from photograph to voice is measured, and was cut in Oct 2026

The joke is about a moment that is already behind the car, so the seconds between the snapshot and
the first word are the app's quality, not a performance detail. Before Oct 2026 the owner's setup
(Gemini 3.8 Flash on `thinkingLevel: 'low'`, ElevenLabs `eleven_multilingual_v2`, full MP3 before
playback) took roughly 4–6 s, read off the saved rounds: the `.json` lands after the clip ends,
about 10.5–12.8 s after `at`, of which a ~110-character Polish sentence is 6–7 s of audio. Two
changes, both one call each, no new provider:

- **A 3.x Flash thinks `minimal`, not `low`** (`thinksMinimally`). The prompt already carries the
  angle and the banned shapes; the thinking bought latency, not jokes. Pro does not take `minimal`;
  a Flash that answers it with a 400 naming thinking is asked again on `low` and remembered for the
  tab, so one retried round is the worst case.
- **ElevenLabs reads with `eleven_flash_v2_5` by default** (`voice.elevenModel`, a setting — v2 is
  one select away for anybody who prefers its delivery), at `mp3_44100_64`.

Every round now carries `timings` in its saved record (`visionMs`, `firstSoundMs`, `doneMs`, all
from `at`) and sends one `backseat.round` measurement to Sentry Logs (numbers and categories, never
the remark). The ride screen shows the photo-to-first-word seconds beside each remark.

**Then the single call, at the owner's request the same day: Gemini Live** (`voice.engine: 'live'`,
`live.ts`). A native-audio model gets the frame and the system prompt over one WebSocket and answers
in streamed 24 kHz PCM, played chunk by chunk through Web Audio, so there is no text-then-speech
chain at all. What it costs, and why it is a third engine rather than the default:

- **The text is Google's transcript (`outputAudioTranscription`) of audio already playing.**
  `sanitizeRemark` and the repeat check only tidy what is shown and remembered; nothing can stop a
  line before it is heard.
- **Google's prebuilt voices** (`LIVE_VOICES`), not ElevenLabs'. The rate slider does nothing.
- **One session per remark, opened during the previous one** (`liveNextRef`, `prepareLive`). A Live
  session remembers everything it was sent, so one per ride would drag every old frame into every
  answer and freeze the per-round prompt; a fresh one per remark would add the handshake and
  `setup` to the wait. So the next round's prompt (its angle, the remarks so far) is built as soon
  as the current remark ends and its session is opened then; a persona, language, key, model or
  voice changed in between discards it (`promptKey`, `sessionFits`).
- **Web Audio has its own iOS unlock**: `primeLiveAudio`, beside `primeVoices` in the Start and Test
  handlers, resumes one `AudioContext` inside the gesture and sets `navigator.audioSession.type =
  'playback'` (iOS 17+) so the silent switch does not mute it.
- `thinkingConfig: { thinkingBudget: 0 }` is sent in `setup`; a model whose close reason names
  thinking is set up again without it and remembered for the tab. A close reason naming the API
  key is fatal (403), like a rejected key elsewhere — Google closes with 1007 and *"API key not
  valid"* in words, verified against the endpoint.
- **The first Live ride (3 Oct 2026, 15:53 UTC) spoke once and then went quiet.** Round 1, on a
  session made for it, was heard at 4.75 s; rounds 2–5, each on a session prepared during the
  previous remark, came back `dropped_empty` in 0.6–0.8 s with no audio, no transcript and no
  error. The records then carried no per-message detail, so the cause was not readable from them.
  Since then an empty answer from a prepared session is asked again on a fresh one in the same
  round (`live.retry`, `live.retried`), and every round saves `events` (each server message's
  `messageKinds`, timed), `live.early` (anything the session received before the frame was sent),
  `live.close` and `live.usage`. Read those before touching the prewarm.
- **The second ride (16:39) showed an empty `usageMetadata`, and that was misread.** f693a03 moved the
  frame to `realtimeInput` on the theory that `clientContent` never reached the model. An
  end-to-end test the next day (4 Oct, the owner's key from Firestore, the real system prompt, a
  synthetic road JPEG, from the container) proved it wrong both ways: in `realtimeInput` the model
  never sees the frame (usage counts no IMAGE tokens, and it invents a bend); in `clientContent`
  it does. **The empty turns were the model plus `thinkingBudget: 0`:**
  `gemini-2.5-flash-native-audio-preview-09-2025` answered this prompt with an empty turn every
  time thinking was turned off, and spoke (after ~3 s of thinking) every time it was not. With a
  one-line prompt it spoke either way, which is why a quick check would not have caught it.
- **`gemini-3.1-flash-live-preview` is the default since then** (`DEFAULT_LIVE_MODEL`; configs on
  the old one move once in `normalizeConfig`). In the same test: ten of ten answered, first audio
  0.75–1.0 s after the send on a set-up session, 1.2–1.6 s including setup. `thinkingBudget: 0` is
  sent only to `flash-live` models (`wantsThinkingOff`). The model list drops transcribers,
  translators, robotics and extended-thinking models and ranks `flash-live` first.
- **One answer in about ten is words with no sound** — a whole transcript, `generationComplete`
  and `turnComplete` within a millisecond of each other, no audio chunk, and a `usageMetadata`
  with **no response tokens at all**: Google wrote the sentence and never voiced it. Seen in the
  4 Oct test and on a real ride (5 Oct 14:54, round 7 of 9; 1 of 23 Live rounds that day). It is
  not the network and not the phone — the turn arrives complete, just without audio. Until 6 Oct
  it went straight to the phone's synthesiser, which the owner heard as "sometimes it reads it
  locally". Since then any answer with no sound, words or not, is **asked again once on a fresh
  session** (`live.retryReason`: `textOnly` or `empty`, the first try kept in
  `live.firstAttempt`), which costs about a second and keeps Google's voice; only words with no
  sound twice reach the synthesiser (`live.deviceFallback`), and nothing twice is raised in the
  banner. Why Google skips the audio is not known: the one real case was a vicious line about the
  driver's child, so a silent output filter is the leading guess, not a finding. **Every Live
  round now saves `live.messages`**: each server message except plain audio chunks, whole, audio
  data replaced by its length (`elideAudio`), so whatever Google sends beside a soundless
  transcript is on the record. Read those on the next `textOnly` before guessing again. Sentry's
  `*.round` measurement carries `liveRetryReason` and `liveDeviceFallback`, so the rate is
  countable, the demo's rounds (which save nothing) included.
- **What does not make it faster (measured 4 Oct, flash-live, real prompt, from the container):**
  the server's floor is ~0.75 s from the send to the first audio chunk, and none of the knobs
  move it beyond noise. `mediaResolution` LOW (63 image tokens) / MEDIUM (266) / default (1064):
  medians 776 / 769 / 816 ms; a 256px frame instead of 512px: no change (Google tiles it the same,
  1064 tokens); a one-line prompt instead of the real one: ~100 ms faster, at the cost of every
  clause in *The prompt is the app*. MEDIUM is set for the quota, not the speed. The audio is
  already streamed (played from the first chunk) and the session already set up ahead, so what
  is left is the phone's own network and the frame capture — read `trace.frame`, `live.ready` and
  `live.sent` on a real ride before chasing anything else.
- Each Live record also carries `live.input`, `live.thinkingOff`, `live.audioChunks` and
  `live.audioSeconds`. The test harness was the app's own `live.ts` under `tsx`, with `ws` behind
  the proxy (`binaryType = 'arraybuffer'`, since `ws` hands over Buffers where a browser hands
  Blobs) and a counting stand-in for `AudioContext`.
- For comparison, the same day's two-step ride (Gemini 3.8 Flash on `minimal` + ElevenLabs Flash):
  `vision.body` 1.8–2.6 s, first sound 2.3–3.0 s (4.5 s on the first round, a cold TTS
  connection).

**Every round's `trace`** (`rideLog.ts`) is the timeline in ms from the photograph, first
occurrence of each stage: `frame`, `vision.sent/.headers/.body`, `tts.sent/.headers/.body`,
`audio.play`, `firstSound`, the `live.*` marks, `done`. Plus `network` where the browser says. The
ride screen counts the same wait live (`LatencyClock`): seconds since the photo and what it is
waiting on (`pending.stage`), frozen at the first sound.

**One step or two is the first question on the setup sheet** (`modeTitle`), at the owner's request:
the Live engine was a third entry in the voice list beside the vision model it ignores, which read
as both being used. Two steps shows the eyes and the voice; one step shows only the Live model and
voice. Switching back picks ElevenLabs if its key is there, else the device voice.

### The sentence that has to stay on the screen

This app puts a synthetic voice in a moving car saying things like "watch out for that truck" about
a photograph from several seconds ago. **The one way it could do harm is by being believed**, for
one second, by somebody whose hands are on a wheel. So the warning is stated three times and none
of them is decoration:

- **To the person, in full**, on the setup screen, before the first journey — yellow on navy, the
  site's own phosphor, because it is not an error and must not read as one.
- **To the person, short**, on the ride screen, which is where the voice is actually talking. A
  disclaimer two screens back from the thing it is about is a disclaimer nobody has read.
- **To the model**, in `systemPrompt`: never a real instruction, never a direction, never a
  manoeuvre. `remarks.test.ts` asserts that clause is present, and if that assertion is ever
  deleted as pedantry, this paragraph is why it was there.

The fourth is the layout itself, and it is in `backseat.css`: the preview is a strip and the remark
is the page. A full-screen viewfinder invites somebody to look at the phone instead of the road, and
it is also the least legible way to show text. **Do not turn the preview into a viewfinder.**

### The ride loop is a chain of timeouts, not an interval

`useBackseatRide` is the app. The obvious implementation — `setInterval` firing a vision call every
fifteen seconds — is wrong in a way that only shows up on a bad connection, which is to say in a
car. A call that takes twenty seconds means the next one starts before the last has been spoken, and
the passenger talks over itself about roads that are already behind you.

So the next round is scheduled only when the previous one has finished **speaking**, and the gap is
measured from the start of the round rather than the end, so a slow provider does not add to it.
**The interval is a gap between remarks, not a request rate.**

Five things follow from that and each of them was a failure first:

- **Two abort controllers, not one.** Hush stops the sentence and leaves the ride running, so it
  must not abort a vision call that has not answered — that ends the round without scheduling the
  next, and the passenger goes quiet for the rest of the journey after a single tap.
- **A null frame is not an error.** On iOS the camera stream is suspended when the app is
  backgrounded or the screen locks, and `videoWidth` reads 0 until it resumes. That is the normal
  state of a phone in a cradle, so it retries in two seconds. Treating it as a failure stops the
  ride every time the phone is unlocked.
- **Three consecutive failures stop the ride, one does not.** A 429 or a tunnel is an ordinary
  event on a drive; going on firing failing requests for an hour spends somebody's rate limit to
  achieve silence.
- **A rejected key (401/403) stops it at once.** `VisionError.fatal`. It will not start working on
  the next attempt, and the alternative is fifteen seconds of silence for ever with no explanation.
- **Every start takes a number** (`startIdRef`). `getUserMedia` does not resolve until somebody has
  answered the permission dialog, which can be a minute, and Stop is on the screen behind it. A
  stream that arrives for a ride already called off is handed straight back — **a camera light
  left on over an idle page is the most alarming thing a page like this can do.**

### The prompt is the app

`utils/backseat/remarks.ts`. Everything else is plumbing to get a photograph to a model and a
sentence to a speaker; this is what decides whether the result is funny for twenty minutes or
tiresome after three. Six clauses are load-bearing:

| clause | what it prevents |
|---|---|
| one sentence, at most 18 words | a paragraph that takes longer to speak than the gap to the next snapshot, so the passenger is permanently one junction behind |
| no speaker name, no quotes, no asterisks | a synthesiser reading `Passenger: *gasps* "Slow down"` out literally, asterisks and all |
| the last six remarks, to be avoided | one sentence on a loop — each call sees one frame and has no memory, so the same motorway produces the same line for ever |
| always say something | "nothing notable", which is the one answer the app cannot use. An empty road is where a real annoying passenger is at their best |
| about something really in the picture | a passenger who ignores the frame — pointed at a desk, Gemini Pro warned about the lorry ahead, because the prompt said "moving car" and nothing tied the remark to what was seen. The image also goes before the text for Google |
| an angle drawn per round, and no "watch out for the X" | one joke shape for a whole ride — the second Gemini ride said "careful, you will hit the grey square" every time. `ANGLES` is twelve comic devices (a sarcastic compliment, an old grudge, a hotel review of the journey…), `pickAngle` never repeats the last one, the warning shape is banned outright, and the malice was turned up at the owner's request: personal and petty about the driver, never about bodies, identities or people in view. Gemini runs at temperature 1.3 |

`sanitizeRemark` enforces the second in code as well as asking for it, because a model asked for
twelve words will sometimes send thirty with a stage direction on the front. Everything it strips
has actually come back from a provider. It also **drops a repeat outright** rather than speaking
it: a dropped round costs one interval of silence, and the same sentence twice is the one thing
that makes the app read as broken rather than annoying.

**The language is its own setting, not the page's.** `remarks.language` is `'en'`, `'pl'` or
`null`, and `null` means nobody has picked: the passenger then speaks the language of the locale
the page is read in, so a first visit to `/pl/` is Polish without a question. Once picked it syncs
with everything else, and the UI stays on the site's own switch — the two are different questions
(somebody reading English may want a Polish passenger). It reaches the prompt, the device
synthesiser's `lang` and the Test button's line. `pickVoice` passes over a chosen device voice
whose language does not match, because the voice picked for Polish, left selected after switching
to English, would otherwise read English in Polish phonetics.

The persona is a **closed list**, not a text box. The prompt around it is written to be hard to talk
out of its shape, and a box somebody types into is a box somebody types "ignore the above" into.

### The frame is 512px because that is what the provider reads

`utils/backseat/frame.ts`. OpenAI's `detail: 'low'` reads an image as a single 512×512 tile however
large it arrives, and Google's pricing is per tile on the same order. **Anything above that is
uploaded, paid for in mobile data, and then discarded.** A frame every fifteen seconds for an hour
is 240 uploads; at a phone camera's native 1920×1080 that is about 50 MB of somebody's allowance for
pictures no human will ever look at. Hence JPEG rather than PNG, quality 0.6, long side capped, and
**never scaled up** — a cheap front camera hands back 320×240 and enlarging it uploads four times
the bytes for the same information.

`detail: 'low'` is therefore **a cost control, not a quality setting to be raised later.** A
high-detail read of a blurry windscreen photograph buys a joke nothing.

`facingMode` is `ideal`, never `exact`. A laptop has no rear camera and `exact: 'environment'` on
one fails with `OverconstrainedError` rather than falling back — the app would refuse to start on
the machine it is developed on.

### Two voice engines (three since Gemini Live, above), and the free one is the default

A phone already has a speech synthesiser. Asking for a second API key and a second bill to hear "oh,
slow down" is a bad trade, so `device` is the default and **the whole app runs on one vision key**.
ElevenLabs is there for anybody who wants a voice to match the persona.

Four things about `speechSynthesis` are not optional and all four are iOS:

- **The voice list is empty on the first read.** It is populated asynchronously and announced with
  `voiceschanged` — but Chrome has it ready on a second load and never fires the event at all, so
  `watchVoices` both reads and subscribes. Either half alone is an empty dropdown on some browser.
- **It has to be unlocked by a gesture.** The first utterance must be spoken inside a real user
  event or iOS silently ignores it and every one after it. `primeVoices` is called from `start`,
  which is handed **straight** to the button — one `await` before that point loses the gesture and
  the app is silent for the whole ride with nothing in any log. The Test button on the setup sheet
  does the same job.
- **`onend` does not always fire.** A cancelled or interrupted utterance can leave the promise
  pending for ever, and a ride whose speaker never reports finishing stops speaking. Every
  utterance is raced against `speechTimeoutMs`.
- **A saved `voiceURI` outlives the voice it names.** Voices come and go with OS updates and
  language packs; unresolved, the synthesiser picks something in the wrong language and reads Polish
  in English phonetics. `pickVoice` falls back by language.

**ElevenLabs has two of its own, and between them they shipped as one symptom: the device voice
worked and the ElevenLabs voice was silent.**

- **The unlock is per element, and the element has to exist when the gesture happens.** iOS blesses
  the element a gesture touched, not the page — so `new Audio(url)` built after `await fetch(...)`,
  several seconds and a network round trip after the click, is a brand-new element nobody has
  tapped and every clip is refused. There is now exactly one `clipPlayer` for the life of the tab;
  `primeVoices` starts a 15ms silent WAV on it inside the Start handler, and every clip after that
  is the same element with a new `src`. It has to be a real decodable clip and it must not be
  muted: iOS counts a muted play as a muted play and grants nothing for audible playback after it.
  The consequence of one shared element is that its handlers must be cleared after every clip, and
  that the clip needs its own `speechTimeoutMs` race — anything replacing the `src` mid-clip drops
  it without firing `ended` or `error`, and a round awaiting that promise never schedules the next.
- **Their speed range is narrower than ours.** The slider is 0.5–2 because that is what a
  synthesiser takes; ElevenLabs accepts 0.7–1.2 and answers **422 before generating any audio**, so
  an out-of-range rate lost the whole remark rather than merely speaking it at the wrong speed.
  `splitSpeed` clamps their half and puts the remainder in `playbackRate`, which multiplies back to
  the rate that was asked for.

**A remark that was written but not spoken is raised in the banner, not just chipped on its log
line.** That is a deliberate reversal: the first version marked only the line, reasoning that the
next remark might speak fine — and the result was an app that went quiet with its explanation in a
chip at the bottom of a list nobody reads while driving. A passenger that has stopped talking is
exactly when somebody needs to be told why.

The screen is held awake for the whole ride (`createWakeLock`), which is what makes the suspended
stream above rarer rather than constant.

### The keys, and the trade being made

> Since Oct 2026 the keys themselves are the account's shared store — see `account-keys.md`. This
> app's documents keep its settings and an emptied `apiKeys`.

Three of them — OpenAI, Google, ElevenLabs — in `localStorage` under `backseat-config`, and, for a
signed-in account, in `users/{uid}/backseat/config` under the existing `users/{uid}/{document=**}`
rule. **No rules change was needed and none should be added.** This is deliberately the same
arrangement as sloper's, down to the shape of the two files: two apps that each hold somebody's API
keys should not differ in where they put them or in who can read them.

The reasoning is sloper's and should not be quietly reversed by somebody tidying: the keys are
already in the clear in the page's memory every time it calls OpenAI, encrypting them at rest buys
nothing that script on this origin cannot undo, and the only design that keeps them out of the
browser is one where a server of ours holds them and makes the calls — a strictly larger thing to
own, and it puts this site on the hook for somebody else's bill.

**The sync is last-write-wins, wholesale, on one `updatedAt`.** A field-by-field merge is not an
improvement waiting to happen, it is the specific bug to avoid: a key **cleared** on the laptop
would be resurrected by the phone's copy on its next load, for ever. Clearing is an ordinary edit
with a newer timestamp and it propagates. `pulledRef` gates the push, not `user`.

The ElevenLabs key field is **only shown when an ElevenLabs voice is selected**, and `requiredKeys`
only asks for it then. A key field for a service the current settings never call is a question
nobody should have to answer.

### The keys are borrowed from sloper on a first visit

> **Superseded Oct 2026.** The keys are now one shared store (`account-keys.md`); the borrow below
> is gone and its `settled`/seed lessons live on in `useAccountKeys`. Kept as the history of why.

Both apps are paid for with the same three keys off the same three accounts, so `importKeys.ts`
seeds this one from the wizard's config rather than asking for the same OpenAI key twice. Two
halves, because a first visit comes in two shapes: `storage.ts` reads `sloper-config` out of
localStorage (same browser, works signed out), and `useBackseatConfig` reads
`users/{uid}/sloper/config` when the pull finds no Backseat document (a phone signing in for the
first time, which has nothing local to copy from). DeepSeek is dropped on the way through — no
model of theirs can look at a photograph.

**It is a copy, not a shared store, and that is the part to be honest about.** Afterwards there are
two documents holding the same OpenAI key: editing one does not change the other, and revoking
means clearing it twice. The setup sheet says exactly that in a line under the key, because a key
you believe you have revoked while a copy of it still works is worse than one you have to paste
twice. The better shape is one store both apps read — `users/{uid}/keys/…` — and it was not done
here because it is a migration of a working app's live keys rather than a new file; if this is ever
revisited, that is the direction, and sloper's own "one home per account" argument is the reason.

**What makes it safe to do once is `settled`** — one boolean, stored beside `updatedAt` in both
localStorage and the account document, meaning *somebody has decided what the keys here are*. Every
edit sets it, including clearing a key and including Clear everything. Nothing is ever borrowed
into a settled config, so **a key deliberately cleared here is never resurrected from sloper's copy
on the next load** — the same rule the account sync is built on, and the one bug worth going out of
the way to avoid. `shouldBorrow` is the whole decision in one function so that both halves ask the
same question; `importKeys.test.ts` pins every direction of it.

**That flag replaced a cleverer rule that shipped broken, and the lesson is worth more than the
flag.** The marker used to be the *absence* of a `backseat-config` — no storage, same meaning, one
less field. Except that `useBackseatConfig` pushes a config up the first time anybody opens the app
signed in, keys or no keys, so within five minutes of the app going live there were accounts
holding an empty document with a recent `updatedAt`. That document then beat the borrow for ever,
because the borrow ran only in the `!remote` branch — the state was "document exists", so nothing
was ever borrowed, and the app looked exactly as it had before the import was written. **A fact
that exists as a side-effect of a sync cannot carry a meaning the sync does not know about.**

Two things fell out of that repair and both are load-bearing:

- **The account-side borrow runs after the three sync branches, not inside one.** It asks what the
  state is — keyless and unsettled? — rather than which branch the control flow happened to take.
  That is what makes it cover both a fresh phone (nothing local, wizard keys in the account) and
  the empty documents already out there.
- **Configs written before the flag have no `settled`, which reads as false.** So they borrow once
  and are then settled, which is exactly the repair those accounts need and requires no migration.

- **The browser-side borrow is stamped `updatedAt: 0`.** It means "never edited", so it loses to
  any copy the account has: a device borrowing sloper's keys this morning cannot overwrite the ones
  somebody typed here last week. It still pushes up when the account has no copy at all, which is
  the case it exists for. The account-side borrow is stamped `Date.now()` instead, because it has
  been through the account and is the copy of record from there on.
- **A borrow moves the provider to the key that came along.** Filling in only the other
  provider's key would leave Start dead with the key it needs sitting right there unasked for. A
  Google key wins when both came (Gemma is free on it; see below). `DEFAULT_GOOGLE_MODEL` or
  `DEFAULT_OPENAI_MODEL` goes with it, and the model list corrects it if that guess is wrong.

`pullSloperKeys` **never fails the caller**: a missing document, a rules refusal or a dead client
all come back as three nulls. An app that would not open because it could not read a different
app's document is a poor trade for a convenience.

### Every round is saved to the account, and nothing is saved in the browser

**Since Oct 2026, at the owner's request**, each round of a signed-in ride writes two objects to
its own bucket (`korczak-xyz-501720-backseat`, terraform/storage.tf — it was sloper's for the
first hour, and finding the passenger under the wizard's name was not where anybody would look): `users/{uid}/backseat/rides/{rideId}/{n}-{at}.jpg`,
the frame exactly as the model got it, and `.json` beside it, with the model, persona, the full
system and user prompts, the raw answer, what was spoken, the outcome (`spoken`, `unspoken`,
`dropped_repeat`, `dropped_empty`, `failed`) and the release. `rideLog.ts`. It exists for one
question — is a flat remark the model's fault, the prompt's or the frame's — which only the three
side by side answer. It shares `storage.rules` with sloper's bucket (both are
`firebase.json` entries), which gives every approved account `users/{uid}/**`; signed out, nothing is written. It is fire-and-forget: never awaited
by a round, a failure is a log line. The setup sheet says it in a line before the camera goes on,
because a camera that keeps what it sees has to say so. The keys are never in a record.

**This reverses what this section used to say** ("nothing about a ride is saved", the remarks
being funny only now). That was a product judgement about a log for the *user*; this is a record
for whoever tunes the prompt, and nothing in the app reads it back.

The browser half still holds: nothing about a ride goes in localStorage — a frame is hundreds of
kilobytes and the origin's ~5 MB is shared with the typing trainer's `typedHistory`. The in-memory
list is capped at 50 and the screen shows the last handful.

### One island, and why the camera makes that firmer than sloper's

`Backseat.tsx` holds both screens as one `screen` state with no router, and the reason is harder
than sloper's: this app holds a live `MediaStream`. A genuine navigation tears the island down
mid-ride, and while the unmount does stop the tracks, every additional path out is another way to
leave a camera running behind a page nobody is looking at. One island has no such path — the stream
is acquired and released by the hook that owns the ride.

`setup` and `ride` are **not tabs**. They are before and after: the camera is off on one and on on
the other, so going back is not navigation, it is stopping. There is no second route back and no
"settings while riding".

`beforeunload` is armed only while the ride is running, and it is about the camera rather than about
losing work — there is none to lose. A prompt that fires on every navigation is one people learn to
dismiss without reading.

### It is installable, and here the reason is the ordinary one

Unlike sloper, this app passes the test in `apps.ts` without an argument: it is used in a phone
cradle in a moving car, which is as far from a desk as the site gets. Every row of browser chrome
comes out of a screen read at arm's length, its own scope means a stray link does not kill a live
stream, and it has its own icon among the others.

It is in `PWA_APPS`, in `SCOPED`, in both `APP_TIERS` lists and on both pages' `pwa` prop. It is
**not** in `PUSH_APPS` and has nothing to notify about.

The precache tier is two documents and exists for the same reason sloper's does, with a sharper
edge: a ride needs a network, but the app is opened in a car — which is where a network is least
reliable — and what opens first is the setup sheet, backed by `localStorage` and needing nothing.
Without the tier the home screen icon leads to `/offline` in exactly the tunnel where somebody
wants to check which key is set.

### The fields, the icon, and one duplication taken knowingly

`components/Backseat/fields.tsx` is a near-twin of sloper's, deliberately copied rather than shared.
The two agree on shape and disagree on class prefix (`bks-` against `slp-`), and the prefix is the
point: each app's stylesheet is loaded on its own pages, so a shared component would pull one app's
CSS into the other's bundle to style four inputs. The cost is a hundred lines that have not changed
since they were written.

The icon is the same Win95 device as the others — navy body, raised bezel, sunken black glass — with
a yellow speech bubble over a green road running to a vanishing point. Three lines of nothing in
particular inside the bubble: it is always full and never says anything.

### The front camera is mirrored, and the ride screen goes full screen (Oct 2026)

Two small things asked for the day the roaster shipped, and one of them has a trap in it.

**The preview is mirrored when the facing camera is the front one** (`bks-video-mirror`, a
`scaleX(-1)`). A preview of your own face that moves the wrong way when you move is the one thing
every phone camera app gets right and a naive `<video>` gets wrong, and the roaster points the
front camera at somebody deliberately. **The FRAME is not mirrored**: what goes to the model is
what the lens saw, so a model reading a label, a sign or a T-shirt in the shot reads it the right
way round. Mirroring the canvas as well would be a quiet accuracy loss for a cosmetic gain.

**Full screen is `fullscreen.ts`, and it is the island that goes full screen, not the preview.** A
full-screen viewfinder is the layout this app exists not to have (*The sentence that has to stay on
the screen*, above), and what somebody wants bigger is the remark. Three disagreements between
browsers, and the third decides the UI: Safari answers only to `webkitRequestFullscreen`; the
request is granted only inside a gesture, so `toggleFullscreen` is handed the click directly with
nothing awaited first (the same rule as `primeVoices` and `primeLiveAudio`); and **the iPhone has
no element full screen at all** — only a `<video>` may take the screen there — so the button is not
drawn rather than drawn and broken. `supportsFullscreen` is a question about the browser, read once
after mount because `document` does not exist while the island renders on the server. Nothing in
that file throws at the caller: a refusal leaves a working ride screen.

The CSS trap is worth knowing: `.bks-app:fullscreen` and `.bks-app:-webkit-full-screen` are
**separate rules**, not a selector list. A list containing one pseudo-class the browser does not
know is dropped whole, so written together neither would apply anywhere.

### The demo: a few remarks on the owner's key (Oct 2026)

Both apps are otherwise entirely in the browser on the reader's own key, and that is the whole
architecture — except this. Somebody with no account and no API key can hear a few remarks, paid
for by the owner's own Google key, because the apps are the sort of thing you have to see working
before you will go and make an AI Studio key, and *paste an API key* is where every one of them
stops. It is the **one server call either app makes**: `roastDemo`
(`functions/src/demo/handler.ts`), the browser half in `utils/backseat/demo.ts`.

Everything about it follows from the fact that it is somebody else's key:

- **The prompt is built by the function, not sent to it.** A request names an app, a persona, an
  intensity, a language and at most ten recent remarks, each checked against the same closed lists
  `normalizeConfig` validates settings against, and the system prompt is assembled by the *same*
  `systemPrompt` the browser uses. A handler that accepted a prompt would be a free,
  unauthenticated Gemini proxy with the owner's name on the bill, which is a different product from
  a demo of a joke app. The angle comes **back** rather than going out, because the function draws
  it. `demo.test.ts` pins the request's shape for that reason.
- **The key is read at call time from `users/{keyUid}/keys/config`** with the site's own
  `keysFrom` — the store is `{ apiKeys: { google, … } }` and the first version of `demoKey` read
  one level too shallow, which is a demo answering `no-key` with the key sitting right there — and
  it is **not** a Secret Manager secret. That buys three things: no
  second copy to rotate, clearing the key on the account page closes the demo, and switching it on
  is a uid in a document rather than a deploy. It costs one Admin SDK read of a document no browser
  could see; the uid is the one the panel wrote, and nothing in a request names it.
- **Two caps, because they fail differently.** One person with a loop can spend a day's quota in
  ten minutes (the per-IP cap); a hundred people each inside their own limit can do it more slowly
  (the per-app one). Checked in that order, because "you have had your go" and "the site has had
  its day" are different sentences. Defaults: 15 per device, 400 per app, per Warsaw day, 12s
  between remarks (the roaster's Live demo has its own, below). The maxima a panel may set are in
  `demoLimits.ts`.
- **The model is a field in the panel, not a constant**, and the first live demo call is why: it
  came back *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please
  update your code to use models/gemini-3.5-flash-lite"* — on the same key the apps ride on, where
  that name still works. **Availability is per project**, so a key that has never called a model
  can be too late for it, and the apps only get away with `DEFAULT_GOOGLE_MODEL` because the model
  list replaces a guess that is not on offer. The demo has no list to correct it, so the dial is
  one text field and changing it needs no deploy.
- **No IP is stored.** The counter's key is `sha256(day + ':' + ip)` truncated to 32 hex, with the
  day in the **salt** as well as in the path, so two days' documents cannot be joined up and
  nothing in the database says who was here. The only durable trace of a demo call is two integers
  getting bigger. `callerIp` takes the **last** `x-forwarded-for` entry — Cloud Run's front end
  appends, and taking the first would let anybody mint a fresh bucket per request with one header.
- **The claim happens before the model call**, in a transaction, so two tabs on one phone cannot
  both pass the cap and a provider error spends a demo call. That is the strict direction; the
  alternative is a refund path a loop can fail on purpose.
- **`demoUsage` has no rule in `firestore.rules`, deliberately.** Unmatched means denied, only the
  Admin SDK writes it, and nothing in the panel reads it. `demo/config` has one, admins only.
- **A refusal is fatal to the ride.** `DemoError.fatal` is true for every reason, which is the
  opposite reading from a provider's own 429: a cap is a cap for the rest of the day, and the
  loop's three-strikes rule would otherwise spend two more rounds discovering it.
- **The passenger's demo is two-step; the roaster's is Live, on tokens** (next section).
  `demoRestrictions` moves the setup sheet's demo config off `live` and puts the function's
  interval floor under the slider, and the sheet does not draw the mode or model groups while the
  demo is on — a dropdown that cannot change anything is a question somebody tries to answer. An
  ElevenLabs voice stays available: that is the reader's own key and their own bill.
- **Nothing about a demo ride is written down.** `rideLog.ts` writes only for a signed-in account
  and a demo has none, so no frame, prompt or remark is stored. The round's record would say
  `provider: 'demo'` and name no prompt, since the one this browser would have built is not what
  the model saw.
- **`demoLimits.ts` is compiled twice**, by Astro for the admin panel and by `tsc` into the
  function (`functions/tsconfig.json`, re-exported from `src/demo/limits.ts`), for Event Watch's
  one-rule-two-runtimes reason: the panel writes the document the handler decides from, and a cap
  must not mean one number in one and another in the other. What stays in the function's own file
  is what needs node's crypto and the proxy header.

**The switch is the key, not the flag.** `enabled` ships true and `keyUid` ships empty, so the
state out of the box is *ready, nobody is paying* and every call is refused with the same sentence
the switch being off produces. The dials are on `/apps/admin/` (`AdminDemo.tsx`): the payer as
three states — nobody, mine, another account — the model, both caps, the interval floor and a
checkbox per app.

### The roaster's demo is one button, on Gemini Live (Oct 2026)

At the owner's request, the same day as the demo: *only a "Roast me" button, the one-step Live
model by default, a flag on the roast screen to switch Polish to English, a roast every three
seconds, and no settings in the demo.* So on `/apps/roaster/` the demo is not the setup sheet's
fieldset at all — it is `QuickRoast.tsx`, shown instead of the sheet to anybody with no Google key
(or with `demoMode` saved), with a link to the sheet and one back. `quickRoastConfig` is the whole
of its settings: Live, the status's Live model, `Kore`, the front camera (mirrored), the default
comic, `normal`, `QUICK_ROAST_INTERVAL` = 3 s, and the language from the flag — never saved, so
somebody who later pastes a key finds their own settings untouched. The flag
(`RideScreen`'s `language` prop) takes effect on the next remark: `promptKeyOf` includes the
language, so the session prepared in the old one is discarded.

**Live was impossible to lend, and an ephemeral token is what made it possible.** The browser
opens Live's WebSocket itself — that is the one-step latency — and the only credential it could
put in the URL was the key. Now `roastDemo` answers a `mode: 'live'` POST by minting a
**single-use ephemeral token** (`ai.authTokens.create`, `v1alpha`): `uses: 1`, a new session
within 60 s, dead after 180 s, and `liveConnectConstraints` carrying the model, the generation
config and **the system prompt, built by the function from the same closed lists** as the
two-step demo. Under constraints Google ignores whatever `setup` the browser sends, so the token
cannot be talked into a different prompt, model or voice; the socket goes to the
`BidiGenerateContentConstrained` endpoint with `?access_token=`. No frame passes through the
function — it goes straight to Google over that socket. `liveConfig.ts` is the setup both sides
use, compiled into the function like `demoLimits.ts`, so the config locked into a token is the
one the rides are tuned with.

- **A session is the unit, counted apart.** One session is one remark, and at three seconds a
  remark lands every four or five once the speaking is counted — a cap sized for two-step remarks
  every twelve would end it in under a minute. So `DemoMode` is `remark | live`, each with its own
  caps and counters (`{app}-live-{day}`): **60 sessions per device** (about five minutes of being
  roasted) and **1500 per app** per Warsaw day, `gemini-3.1-flash-live-preview`, all three in the
  panel. A stored settings document without the fields gets these defaults.
- **The next session's token is fetched while the current remark is spoken**, exactly as the
  key-based prewarm opens the next session then — so the token round trip is off the wait. The
  cost is one session claimed and unused when somebody presses Stop. A retry on an empty answer
  takes a token of its own.
- **The angle comes back with the token** and is what the round's record names.
- The thinking retry (`NO_THINKING_CONFIG`) is skipped under a token: the config is the
  function's, and a token is good for one session.

### The roaster: the same island, another prompt (Oct 2026)

At the owner's request, a generalisation of the passenger: "just roast what it sees, without the
road". It is **not a copy**. Every lesson above is about plumbing that does not care what the
camera points at — the chain of timeouts, the two abort controllers, the iOS unlocks, the 512px
frame, the Live prewarm — and a second copy of 1,500 lines of that would drift the first time one
of them was fixed. So `utils/backseat/flavour.ts` names what makes it a different app, and the
pages pass `flavour="roaster"` to the one island:

- **The prompt** (`remarks.ts`, `roasterPrompt`, `ROAST_ANGLES`, `ROAST_USER_PROMPT`). The rules
  that are not about driving are kept word for word in spirit (one sentence, no stage directions,
  something really in the picture, always say something, the recent remarks to avoid). The driving
  clause is replaced by the one this app can get wrong: **it is pointed at people.** A roast is
  aimed at what somebody chose — clothes, the shelf, the pose — never at a body, a face, an
  identity or a guess at who they are. `flavour.test.ts` asserts that clause, for the same reason
  `remarks.test.ts` asserts the driving one.
- **Its own personas** (`ROASTER_PERSONAS`: comic, critic, grandma, teenager, documentary
  narrator), still a closed list. `normalizeConfig(value, flavour)` validates against the
  flavour's list, so a passenger persona never reaches the roaster's prompt.
- **Its own settings**: `roaster-config` in localStorage and `users/{uid}/roaster/config`, so
  choosing a critic here does not change who sits in the car. The keys are the shared store as
  everywhere. `switchedToGoogle` runs for the passenger only; the roaster has no OpenAI past.
- **Its rounds** go to `users/{uid}/roaster/rides/` in the passenger's bucket — `storage.rules`
  is `users/{uid}/**`, so no rule, bucket or Terraform changed. Sentry gets `roaster.round`.
- **Its strings** (`translations.ts`, `forFlavour`): only those that mention a road, a journey or
  a passenger are overridden. The disclaimer is replaced, not dropped — no car, but "only roast
  people who are in on it" — and stays on both screens.
- **Its own PWA** (`roaster` in `PWA_APPS`, `SCOPED`, both `APP_TIERS`), a flame on the glass for
  an icon, and a card on the account page beside the passenger's.

A third flavour is a third entry in `FLAVOURS`, a prompt pack and two pages.

