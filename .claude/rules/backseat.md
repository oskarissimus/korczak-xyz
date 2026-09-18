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
  - "**/assets/icons/backseat.svg"
---

## Annoying Passenger Simulator

At `/apps/backseat/` — the phone looks out of the windscreen every few seconds and says the sort of
thing a passenger says when they are not the one driving. "Oh, slow down." "Mind that lorry."
"Are we there yet?" Paid for with the reader's own API keys, on the same terms as sloper.

It is **entirely in the browser**. There is no function, no bucket, no collector — a frame goes
from a canvas to OpenAI or Google and a sentence comes back to a speaker. The only thing the
account does is hold the keys. That is the whole architecture, and it is worth saying plainly
because every other app here that talks to a provider has a server half and this one has none to
find.

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
tiresome after three. Four clauses are load-bearing:

| clause | what it prevents |
|---|---|
| one sentence, at most 18 words | a paragraph that takes longer to speak than the gap to the next snapshot, so the passenger is permanently one junction behind |
| no speaker name, no quotes, no asterisks | a synthesiser reading `Passenger: *gasps* "Slow down"` out literally, asterisks and all |
| the last six remarks, to be avoided | one sentence on a loop — each call sees one frame and has no memory, so the same motorway produces the same line for ever |
| always say something | "nothing notable", which is the one answer the app cannot use. An empty road is where a real annoying passenger is at their best |

`sanitizeRemark` enforces the second in code as well as asking for it, because a model asked for
twelve words will sometimes send thirty with a stage direction on the front. Everything it strips
has actually come back from a provider. It also **drops a repeat outright** rather than speaking
it: a dropped round costs one interval of silence, and the same sentence twice is the one thing
that makes the app read as broken rather than annoying.

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

### Two voice engines, and the free one is the default

A phone already has a speech synthesiser. Asking for a second API key and a second bill to hear "oh,
slow down" is a bad trade, so `device` is the default and **the whole app runs on one vision key**.
ElevenLabs is there for anybody who wants a voice to match the persona.

Four things about `speechSynthesis` are not optional and all four are iOS:

- **The voice list is empty on the first read.** It is populated asynchronously and announced with
  `voiceschanged` — but Chrome has it ready on a second load and never fires the event at all, so
  `watchVoices` both reads and subscribes. Either half alone is an empty dropdown on some browser.
- **It has to be unlocked by a gesture.** The first utterance must be spoken inside a real user
  event or iOS silently ignores it and every one after it. `primeSpeech` is called from `start`,
  which is handed **straight** to the button — one `await` before that point loses the gesture and
  the app is silent for the whole ride with nothing in any log. The Test button on the setup sheet
  does the same job incidentally.
- **`onend` does not always fire.** A cancelled or interrupted utterance can leave the promise
  pending for ever, and a ride whose speaker never reports finishing stops speaking. Every
  utterance is raced against `speechTimeoutMs`.
- **A saved `voiceURI` outlives the voice it names.** Voices come and go with OS updates and
  language packs; unresolved, the synthesiser picks something in the wrong language and reads Polish
  in English phonetics. `pickVoice` falls back by language.

The screen is held awake for the whole ride (`createWakeLock`), which is what makes the suspended
stream above rarer rather than constant.

### The keys, and the trade being made

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
- **A Google-only borrow moves the provider too.** The default provider is OpenAI, so filling in a
  Google key alone would leave Start dead with the key it needs sitting right there unasked for.
  `DEFAULT_GOOGLE_MODEL` goes with it, and the model list corrects it if that guess is wrong.

`pullSloperKeys` **never fails the caller**: a missing document, a rules refusal or a dead client
all come back as three nulls. An app that would not open because it could not read a different
app's document is a poor trade for a convenience.

### Nothing about a ride is saved

Not in localStorage and not in Firestore. The localStorage half is the budget argument the other
apps already made — a frame is hundreds of kilobytes and the origin's ~5 MB is shared with the
typing trainer's `typedHistory`. The remarks alone would fit and are still not kept, for a different
reason: **what makes the needling funny is that it is happening now.** A log of it read back cold is
a list of complaints about a road you are no longer on.

So there is no project, no history tab, and no resume. The in-memory list is capped at 50 and the
screen shows the last handful. If this is ever revisited, note that the thing somebody would
actually want is a *shareable* transcript of one drive, which is a different feature from a log.

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
