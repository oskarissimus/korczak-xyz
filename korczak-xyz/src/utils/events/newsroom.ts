/*
 * What a newsroom item turned out to be about.
 *
 * The scrapes produce two different kinds of row and the app had a vocabulary for only one of
 * them. A season page yields a *production* — a title, a genre, a premiere — and every field is
 * stated plainly enough that a regex reads it. The theatre's news list yields an *article*, where
 * the only thing stated plainly is the headline, and everything worth knowing ("tickets from
 * 1 September at 11.00", "this is a job advert, not a concert") is in a sentence of Polish prose.
 *
 * So a newsroom item is read by a language model, in `functions/src/readNewsroom.ts`, and what crosses
 * back into this directory is the *result*: a kind, a tag derived from it, and — the point of the
 * whole exercise — an `onSaleAt` the `presale` notice can count down to. The matcher gains nothing
 * new, and `portable.test.ts` has nothing new to police, which is the same bargain the geography
 * classifier struck.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

/**
 * The five things a theatre's news item turns out to be.
 *
 * A closed set rather than free text, because it is going to be matched against `Interest.tags`,
 * and a taxonomy the model invents per article is a taxonomy nobody can write an interest against.
 * They are cut by **what you would do about it**, which is the only cut worth having: one of them
 * has a deadline, one tells you what is being staged, one matters on the night, one is the
 * institution talking about itself.
 */
export type NewsroomKind =
  /** Tickets go on sale on a stated date. The one kind carrying a deadline. */
  | 'ticket-sale'
  /** What is being staged: a season, a premiere, a cast, a guest artist, a tour. */
  | 'programme'
  /** Visiting: parking, access, a closure, a change of hours, ticket exchanges. */
  | 'practical'
  /** The institution about itself: jobs, tenders, competitions, volunteering, sponsors. */
  | 'institutional'
  /** None of the above, or too little to tell. Deliberately gains no tag. */
  | 'other';

export const NEWSROOM_KINDS: readonly NewsroomKind[] = [
  'ticket-sale',
  'programme',
  'practical',
  'institutional',
  'other',
];

/**
 * The tag that stands for a kind, or null where a kind should not become a handle at all.
 *
 * `other` gets none on purpose. It is the model saying it could not tell, and a tag reading
 * "unclassifiable" is one an interest could match — which is how a keyword-less interest ends up
 * collecting everything the reader failed on. `tagsFor` in the theatre adapter drops through the
 * same way, and for the same reason.
 *
 * The tags are bare rather than prefixed (`ticket-sale`, not `kind:ticket-sale`) because they join
 * one namespace with `opera`, `running` and `theatre`: an interest asks for tags, and a second
 * spelling convention inside that field would be a fact only this file knows.
 */
export function newsroomTag(kind: NewsroomKind | undefined): string | null {
  if (!kind || kind === 'other') return null;
  return kind;
}

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
 * An event's tags with the reader's verdict folded in, exactly once.
 *
 * Derived rather than stored-and-appended, and that is load-bearing: `upsertEvents` rewrites the
 * whole document from what the source said on every run, and the source has never heard of a
 * `programme` tag. Recomputing the union from the stored kind at merge time means the reader never
 * has to race the upsert, and re-running it can never accumulate a second copy of the same tag.
 */
export function tagsWithNewsroomKind(
  tags: string[],
  kind: NewsroomKind | undefined,
): string[] {
  const tag = newsroomTag(kind);
  if (!tag || tags.includes(tag)) return tags;
  return [...tags, tag];
}
