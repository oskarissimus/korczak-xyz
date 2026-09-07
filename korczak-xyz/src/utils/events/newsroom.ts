/*
 * What a newsroom item turned out to be about — which is one question, asked of one page.
 *
 * The scrapes produce two different kinds of row and the app had a vocabulary for only one of
 * them. A season page yields a *production* — a title, a genre, a premiere — and every field is
 * stated plainly enough that a regex reads it. The theatre's news list yields an *article*, where
 * the only thing stated plainly is the headline, and the thing worth knowing ("tickets from
 * 1 September at 11.00") is in a sentence of Polish prose.
 *
 * So a newsroom item is read by a language model, in `functions/src/readNewsroom.ts`, and what
 * crosses back into this directory is the *result*: a verdict, a tag derived from it, and — the
 * point of the whole exercise — an `onSaleAt` the `presale` notice can count down to. The matcher
 * gains nothing new, and `portable.test.ts` has nothing new to police, which is the same bargain
 * the geography classifier struck.
 *
 * ### It used to be five things, and is now one
 *
 * The reader once answered a five-way taxonomy — `ticket-sale`, `programme`, `practical`,
 * `institutional`, `other` — plus the date the article was about and an English summary of it.
 * Four of those five verdicts were only ever *read*: nothing counted down to them, no seeded
 * interest asked for them, and their whole effect was a chip on a card and a row of filter buttons
 * over one theatre's news list. The taxonomy was answering a question nobody was asking.
 *
 * What is left is the question that costs money to get wrong: **do tickets go on sale on a stated
 * date, and when.** A season's sale opens on one morning at one hour and the house is half sold by
 * lunchtime, so this is the one fact on that page with a deadline attached — and a boolean plus a
 * date is a far easier thing for a model to get right than a five-way cut, which is the second
 * reason to ask only for it.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

/**
 * The tag a sale announcement carries, and the whole of the seeded "Ticket sales opening" interest.
 *
 * Bare rather than prefixed, because it joins one namespace with `opera`, `running` and `theatre`:
 * an interest asks for tags, and a second spelling convention inside that field would be a fact
 * only this file knows. It is the same string `teatrWielki.ts` stamps where its own regex read a
 * sale sentence off the news list — one tag, two writers, deliberately.
 */
export const TICKET_SALE_TAG = 'ticket-sale';

/**
 * The tag a source stamps on a row it knows is an article rather than an event.
 *
 * This is the reader's whole queue, and it is a fact about the *page*: every row of
 * `/teatr/aktualnosci/` is an article, which is exactly the kind of thing a page is allowed to
 * stamp feed-wide. No seeded interest asks for it — it is a marker for the collector, not a
 * subject — so widening it to another source's article feed costs nothing but the model calls.
 */
export const NEWSROOM_TAG = 'newsroom';

/** Whether this record is an article for the reader to read. */
export function isNewsroomItem(event: { tags?: string[] }): boolean {
  return (event.tags ?? []).includes(NEWSROOM_TAG);
}

/**
 * The reader's verdict as a value a facet can be keyed on, or undefined where it never read.
 *
 * Two values rather than a raw boolean because the Pipeline tab draws them as buttons beside
 * `kind` and `reach`, and `true`/`false` as button faces would be the only place in that tab where
 * the corpus's own vocabulary is not what is written on the control.
 */
export type TicketSaleVerdict = 'ticket-sale' | 'no-sale';

export const TICKET_SALE_VERDICTS: readonly TicketSaleVerdict[] = ['ticket-sale', 'no-sale'];

export function ticketSaleVerdictOf(event: {
  newsroomTicketSale?: boolean;
}): TicketSaleVerdict | undefined {
  if (event.newsroomTicketSale === undefined) return undefined;
  return event.newsroomTicketSale ? 'ticket-sale' : 'no-sale';
}

/**
 * An event's tags with the reader's verdict folded in, exactly once.
 *
 * Derived rather than stored-and-appended, and that is load-bearing: `upsertEvents` rewrites the
 * whole document from what the source said on every run, and the source has never heard of the
 * reader. Recomputing the union from the stored verdict at merge time means the reader never has
 * to race the upsert, and re-running it can never accumulate a second copy of the same tag.
 *
 * **The tag follows the date, not the boolean.** A model that says "yes, a sale" and gives no
 * usable date has told us nothing anybody can act on, and the tag is the entire content of a
 * keyword-less seeded interest — so stamping it there would put a card with no deadline in front
 * of a reader who asked to be told about deadlines. `readingUpdate` passes what survived its
 * guards, which is the same rule the adapter's own regex path already follows.
 */
export function tagsWithTicketSale(tags: string[], hasSaleDate: boolean): string[] {
  if (!hasSaleDate || tags.includes(TICKET_SALE_TAG)) return tags;
  return [...tags, TICKET_SALE_TAG];
}
