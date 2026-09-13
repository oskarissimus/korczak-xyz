---
name: shopping
description: The shopping list at /apps/shopping/ - one document per line, ids minted rather than derived, the name-matching that stops a second "milk", the done field that is not a tombstone, the suggestion chips, and the one household grant it shares with the sleep log.
paths:
  - "**/utils/shopping/**"
  - "**/components/Shopping/**"
  - "**/hooks/useShoppingList.ts"
  - "**/styles/shopping.css"
  - "**/pages/**/apps/shopping.astro"
  - "**/pages/**/apps/shopping/**"
  - "firestore.rules"
---

## Shopping list

At `/apps/shopping/` — one list, both phones, and it has to work in a supermarket basement with no
signal. Two tabs: the list, and who else can write to it. `src/utils/shopping/` holds the shapes and
the pure logic, `useShoppingList` the state and sync.

It is the sleep log's machinery with the sleep log's data model deliberately *not* copied. What is
genuinely shared is imported rather than duplicated: the reconciler (`babySleep/versioned.ts`), the
share document and its key (`babySleep/shares.ts`, `shareKeys.ts`), `useDataOwner`, and `SyncState`
from `flashcards/sync.ts`. What is a near-copy with different nouns — the sync badge, the share tab —
is a copy on purpose, because the originals' `bs-*` classes live in `babySleep.css` and reusing them
would drag eight charts' worth of stylesheet onto a page that draws a list of words.

### The ids are minted, and that is the one real departure

Every derived-id collection in this repo keys on the occasion — a night, a nap's start minute — so
that two phones converge on one document instead of racing to create two. **A shopping line cannot
do that**, and the reason is the data rather than a preference: a night happens once, and *milk*
happens every week. Keyed on the name, this week's milk would meet last week's tombstone — the exact
case `versioned.ts` documents as having once made a night unloggable for good — and two lines that
genuinely say the same word would be forbidden.

So ids are `uuid()`, and what replaces the convergence is `findByName` plus the `readd` path in the
hook: adding a name the list already carries revives *that* line rather than writing a second. It
holds whenever the two devices have seen each other, which is the case worth optimising. Two phones
adding "milk" in a tunnel still make two lines — visible in the shop, tickable in one tap. Duplicate
rather than lose, as everywhere else here.

`matchName` is what "the same item" means: case-folded and accent-folded, so `Mleko`, `mleko` and a
phone that autocapitalised it are one line, and so are `maka` and `mąka` — a Polish keyboard on iOS
is exactly where that typo comes from. `ł` is folded by name because it has no Unicode
decomposition, which is the sort of thing that is only ever found by typing `masło` twice. Nothing
cleverer than that: no stemming and no plural rule, because `jabłko` and `jabłka` being one line is a
guess, and a wrong guess silently merges two things somebody wanted.

### `done` is a field, not a tombstone

The ergonomics of the whole app. What you have already picked up stays on the screen, or the mis-tap
you made by the yoghurts is unrecoverable and nobody can tell whether the bread was got or forgotten.
Tombstoning is what *Clear bought* does, once you are out of the shop — and it is the one control
here that asks first, because everything else on the screen is undone by tapping it again.

`doneAt` is cleared when a line goes back, so something put down and picked up again sorts by when it
was *last* taken. The basket reads most-recent-first and the to-buy half oldest-first: a line added
while you are already reading must not push the next thing you were about to pick up off the top.

### The chips

`suggest` counts every record this device holds — bought and cleared included — groups them by
`matchName`, and labels each group with the **most recently used spelling**, so correcting a name
sticks rather than being outvoted by a year of the old one. That is the whole point of keeping
tombstones past the shop: a household buys the same twenty things, so next week's list is a row of
chips rather than twenty pieces of typing.

Anything on *this* list is left out, the basket included and not merely the half still to buy. A chip
offering something visible two rows below it is an invitation to a duplicate, and one headed "bought
before" sitting above the same word with a tick against it is a lie about what it is showing.

### Storage evicts nothing

`babySleep/storage.ts` gives up its own oldest finished entries under quota pressure, which is a fair
trade there. Here the whole history is a few hundred short lines, so there is nothing to reclaim
worth having — and the thing it would reclaim is what the chips are built from. It reports a failed
write and moves on. Its own `shopping-owner` key and its own copy of `adoptOwner` for the same
reason the caches are per-app: the sleep log's is memoised against `baby-sleep-owner` and clears the
*sleep log's* caches, so sharing it would mean this app's account switch quietly clearing another
app's data and not its own.

`pullItems` orders by `createdAt`, which carries the usual `orderBy` trap: a document **lacking** the
field is excluded from the result entirely. Every line this app has written has it, so that is a rule
about future shapes — renaming the field would make the whole existing list invisible to the pull
rather than merely unsorted.

The hook syncs on three occasions and the third is the one this app needs: a write, a reconnect, and
the tab becoming visible. Two people in one shop diverge in seconds, so the list is re-read whenever
the phone is unlocked on it rather than only when something is tapped.

### One grant per person, not one per app

`shares/{email}` is a single top-level document, and `firestore.rules` names it from every shared
collection — the sleep log's four and this one. So inviting somebody to the shopping list gives them
the sleep log too, and revoking takes both away. That is deliberate: a household is a household, and
two lists of the same two people that can silently fall out of step is a worse thing to own than one
grant that is honest about its reach. **Both share tabs say so on the screen** (`shareScope`), because
a grant reaching further than the page it was given on must never be a surprise. Splitting it later
means a second collection and a second `hasShare()`, not a flag.

The practical consequence at launch: the list was already shared with whoever the sleep log was, with
nobody to re-invite. All it needed was its own rules block — `users/{uid}/shopping/{itemId}` — which
is not optional and is invisible to the person most likely to check, since the owner's own access
comes from the `users/{uid}/{document=**}` catch-all and works whether the block is there or not. A
forgotten one leaves only the *shared* half dead. It deploys from CI on the push that changes
`firestore.rules`; there is nothing to run by hand.

### The screen

Used one-handed, at arm's length, pushing a trolley. Every hit area is deliberately larger than it
looks like it needs to be — the row is a `<label>` around a real checkbox, so the whole line is the
target and the keyboard and the screen reader get the control for free — and the add box **keeps
focus after a submit**, because a list is written in one go at the fridge, five things in a row, and
anything costing a tap between items costs five taps.

Two fields and not one. Folding the amount into the name looks simpler and is not: "2 mleko" matches
as a different thing from "mleko", so the list grows a second line every time somebody needs a
different number of the same item, and `matchName` can never join them.

`shopping.css` spells out **every** state of the tick box, `:checked` above all, and carries an extra
`.sl-item` on each of those selectors. `@tailwindcss/forms` is in the site's global sheet and paints a
checked box its own blue with a tick as a background image, restating that colour for `:hover` and
`:focus` besides; its selectors are `[type=checkbox]:checked`, the same weight as an unqualified
`.sl-check:checked`, so equal specificity would leave the result to sheet order. The first version of
that rule had no `:checked` at all, and a stock web checkbox duly turned up in the middle of a Win95
panel — caught in a browser rather than by any test, which is the only way this class of bug is.
