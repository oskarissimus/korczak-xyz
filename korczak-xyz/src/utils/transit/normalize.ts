/*
 * Ids, and the digest that decides whether a communiqué has been read already.
 *
 * Portable: browser and Node. `foldText` and `slugKey` come from `../events/normalize`, which is
 * itself proven portable by that directory's own test — see the header in `types.ts` for why this
 * one import is allowed where the events app allows none.
 */

import { foldText, slugKey } from '../events/normalize';
import type { FeedKind, TransitItem } from './types';

/**
 * The document id for a communiqué.
 *
 * Derived from the feed and the feed's own guid, and from nothing else. WTP edits a live
 * communiqué — a closure is extended, a reason is added — and every one of those edits must land on
 * the same document, or the corpus fills with near-duplicates and each edit announces itself as a
 * brand new disruption. The events app states the same rule about prices and ticket links; here the
 * churn is faster and the consequence louder.
 */
export function transitIdFor(feed: FeedKind, guid: string): string {
  return `${slugKey(feed)}_${slugKey(guid)}`;
}

/**
 * How much later than our own first sight of an item its `pubDate` may be and still be the same
 * publication.
 *
 * WTP's clock and this collector's are not the same clock, and the feed is read within ten minutes
 * of anything appearing on it, so a few minutes of skew either way is ordinary. A genuine
 * re-publication is hours or days later — the one in the corpus when this was written is a day —
 * so the margin costs nothing and stops a server running fast from reading as news.
 */
export const REPUBLISH_MARGIN_MS = 5 * 60_000;

/**
 * When WTP re-published this post, or undefined for the ordinary case.
 *
 * A communiqué normally reaches us minutes *after* it is published, so `publishedAt` sits before
 * `firstSeenAt` and this is undefined. `publishedAt` well after `firstSeenAt` means the opposite:
 * WTP took a post we already have and published it again.
 *
 * **Undefined for almost everything, which is the point.** Both callers fold this into a string
 * they compare against one already stored — the article latch and the alert id — so anything that
 * changed their shape unconditionally would invalidate every stored value at once, and the deploy
 * would re-fetch the corpus and re-announce a fortnight of metro history. Appended only where it is
 * true, every row that was never re-published keeps the exact strings it has.
 */
export function republishedAt(
  item: Pick<TransitItem, 'publishedAt' | 'firstSeenAt'>,
): number | undefined {
  return item.publishedAt - item.firstSeenAt > REPUBLISH_MARGIN_MS ? item.publishedAt : undefined;
}

/**
 * The revision of a communiqué an alert is claimed against.
 *
 * `contentHash` was this on its own, and for an *edit* it is exactly right: WTP rewrites a live
 * communiqué as a closure grows, and "the closure now reaches Imielin too" is news about an article
 * you were already told about. What it cannot see is the other way WTP files a second incident
 * under the first one's post.
 *
 * **17 Sep 2026 is what this is for.** A new M1 disruption was published at 21:14 under
 * `?post_type=impediment&p=177253` — the post id of the previous evening's incident, permalink
 * moved to the new day, the RSS row the same headline it always is (`Utrudnienia w komunikacji: M1`
 * over one sentence restating it), and the article text word for word the template of the night
 * before. Same guid, same title, same body, same article, therefore the same `contentHash`, the
 * same alert id and a `create()` that failed on the alert sent 24 hours earlier. The app had the
 * closure on screen, read to the station, and said nothing — while a competing app, which
 * deduplicates on nothing, rang.
 *
 * So the revision is what it says **and when it was published**. The date is the one field that
 * actually moved, and neither digest reads it: `contentHashOf` is deliberately over the prose alone
 * so a re-read cannot ring the phone, and `feedHashOf` over the feed's text alone so an article can
 * be told from the row it was fetched against. Neither is wrong; both are answering a different
 * question from this one.
 */
export function revisionOf(
  item: Pick<TransitItem, 'contentHash' | 'publishedAt' | 'firstSeenAt'>,
): string {
  const again = republishedAt(item);
  return again === undefined ? item.contentHash : `${item.contentHash}@${again}`;
}

/**
 * `${slugKey(guid)}|${kind}|${revision}`.
 *
 * Three parts rather than the events app's two, and the third is the interesting one: an alert is
 * claimed against a **revision** of a communiqué rather than against the communiqué. See
 * `revisionOf` for what a revision is and for the evening that added the second half of it.
 *
 * The revision is built from the source prose (see `contentHashOf`) and the feed's own publication
 * date, never from the extractor's output. A model that phrased its summary differently on a
 * re-read must not be able to ring the phone.
 */
export function alertIdFor(guid: string, kind: string, revision: string): string {
  return `${slugKey(guid)}|${kind}|${revision}`;
}

/** Splits an alert id back apart. `slugKey` never emits `|`, so the two cuts are unambiguous. */
export function parseAlertId(
  id: string,
): { guid: string; kind: string; revision: string } | null {
  const parts = id.split('|');
  if (parts.length !== 3 || parts.some((p) => p === '')) return null;
  return { guid: parts[0], kind: parts[1], revision: parts[2] };
}

/** What the extractor is shown: the article page's prose where there is one, the feed's otherwise. */
export type Prose = Pick<TransitItem, 'body' | 'article'>;

/**
 * The prose this item is read from.
 *
 * Two sources, one accessor, because everything downstream has to agree on which text is *the*
 * text: the hash that decides whether to spend a model call, the predicate that decides whether
 * there is anything to spend it on, and the prompt itself. Three places deriving that separately is
 * how an item gets re-read every ten minutes, or read from a sentence the hash never covered.
 *
 * The article wins where it exists. `body` is WTP's RSS `description`, and for a metro communiqué
 * that is the article's headline and nothing else — see `hasProse`.
 */
export function proseOf(parts: Prose): string {
  return (parts.article ?? parts.body ?? '').trim();
}

/**
 * How much text it takes before this app will call something a communiqué rather than a headline.
 *
 * Measured against the live corpus rather than chosen. **Every item in both WTP feeds carries a
 * `description` (and a `content:encoded`) that is one sentence — the article's own H1 restated** —
 * and the whole of the prose naming stations is on the web page. The longest such body in the
 * corpus is 75 characters (`Utrudnienia w kursowaniu linii 112,114,132,…`); the M1 closure of
 * 12 Sep 2026 states which stretch is shut within the first 164 characters of its article. 140 sits
 * in that gap.
 */
export const MIN_PROSE_CHARS = 140;

/**
 * Whether there is anything here a model could read a closure out of.
 *
 * This is the fourth state, and it exists because the three the app already had could not tell the
 * truth about 12 Sep 2026. The RSS item for that morning's M1 suspension read, in full,
 * `ZAKOŃCZONO: Utrudnienia w kursowaniu pociągów metra na linii M1.` — the extractor was handed one
 * sentence naming no station, correctly answered "this notice closes none", and the card said
 * **No station closed** about a closure that had shut four stations and split the line into two
 * loops.
 *
 * Nothing in that chain was wrong except what it was asked. So a body this short is never read at
 * all: no `extractHash` is written, `closedStops` stays absent, and `impactOf` escalates the item to
 * route level as *uncertain* — which is the direction this app's whole arrangement resolves the
 * unknown in. "Nobody has looked", "there is nothing to look at" and "we looked and nothing is
 * closed" are three different answers, and only the last one may ever read as an all-clear.
 *
 * The cost, and it is the accepted one: a genuinely terse notice — `Nie kursują pociągi metra M1 na
 * odcinku Centrum – Wilanowska.` is 61 characters and says everything — is escalated rather than
 * read. That is a loud alert about something real, on a line the reader rides. The failure it
 * replaces was a silent all-clear.
 */
export function hasProse(parts: Prose): boolean {
  return proseOf(parts).length >= MIN_PROSE_CHARS;
}

/**
 * What the extractor was shown, as a short digest.
 *
 * FNV-1a over the folded title and prose, not a cryptographic hash — this is a change detector, and
 * making it one keeps the whole module portable. `createHash` is a Node builtin; reaching for it
 * here would push this file out of the browser bundle and take the Raw tab's "this reading is out
 * of date" badge with it, which is precisely the thing the reader needs when an extraction has gone
 * wrong.
 *
 * Folded, so a whitespace-only edit in WTP's CMS does not spend a model call or raise a second
 * alert about a communiqué that says exactly what it said before.
 *
 * **It hashes `proseOf`, so an article arriving moves it and an article being edited moves it
 * again.** That is the whole mechanism by which a developing closure gets re-read: WTP edits the
 * article as the shutdown grows while the RSS row stays the one sentence it always was, so a hash
 * over the feed's own text alone would freeze the first reading in place. Called with no article —
 * every row written before this existed — it produces exactly the digest it produced before.
 */
export function contentHashOf(parts: { title: string } & Prose): string {
  const text = foldText(`${parts.title}\n${proseOf(parts)}`);
  // Two independently seeded passes, concatenated: one 32-bit FNV over a few thousand characters
  // collides often enough to matter when a collision means a missed alert.
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

/**
 * The digest of the **feed's own** text for an item, article ignored.
 *
 * A second hash, and the reason it exists is `mergeItem`: the question there is not "has what we
 * read changed" but "is the article we are holding still about the row that just arrived". WTP
 * rewriting the RSS text — the `ZAKOŃCZONO:` prefix that arrives when a closure ends is exactly
 * that — means the page behind it has moved on too, so the stored article is dropped and fetched
 * again. It is also what `articleFetchedFor` records, which makes "already tried at this revision"
 * a fact about the feed rather than about our own derived state.
 */
export function feedHashOf(parts: { title: string; body?: string }): string {
  return contentHashOf({ title: parts.title, body: parts.body });
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, by shift-and-add: `hash * 16777619` overflows the float mantissa and starts
    // losing low bits, which is exactly where the entropy is.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The content half of a stored `extractHash`.
 *
 * `extractHashOf` in the Cloud Function stores `${EXTRACTOR_VERSION}:${contentHash}`, because
 * bumping the version has to invalidate every reading at once. But the *reader* is asking a
 * different question — "has WTP edited this since it was read?" — and a prompt change is not an
 * edit by WTP. So the two comparisons are deliberately different: the collector compares the whole
 * string, the UI compares only this half.
 *
 * Written to survive a stored value with no prefix at all, which is what an older build wrote and
 * what a hand-set value in a console looks like.
 */
export function hashOfExtract(extractHash: string): string {
  const at = extractHash.lastIndexOf(':');
  return at < 0 ? extractHash : extractHash.slice(at + 1);
}
