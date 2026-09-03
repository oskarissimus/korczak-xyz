/*
 * Ids, and the digest that decides whether a communiqué has been read already.
 *
 * Portable: browser and Node. `foldText` and `slugKey` come from `../events/normalize`, which is
 * itself proven portable by that directory's own test — see the header in `types.ts` for why this
 * one import is allowed where the events app allows none.
 */

import { foldText, slugKey } from '../events/normalize';
import type { FeedKind } from './types';

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
 * `${slugKey(guid)}|${kind}|${contentHash}`.
 *
 * Three parts rather than the events app's two, and the third is the interesting one. An alert is
 * claimed against a **revision** of a communiqué, not against the communiqué — because WTP genuinely
 * does edit them, and "the closure now reaches Imielin too" is news even though the article is the
 * one you were already told about. Keyed on the guid alone, that update would be latched away by
 * the alert already claimed for the original text.
 *
 * The hash is over the source prose (see `contentHashOf`), never over the extractor's output. A
 * model that phrased its summary differently on a re-read must not be able to ring the phone.
 */
export function alertIdFor(guid: string, kind: string, contentHash: string): string {
  return `${slugKey(guid)}|${kind}|${contentHash}`;
}

/** Splits an alert id back apart. `slugKey` never emits `|`, so the two cuts are unambiguous. */
export function parseAlertId(
  id: string,
): { guid: string; kind: string; contentHash: string } | null {
  const parts = id.split('|');
  if (parts.length !== 3 || parts.some((p) => p === '')) return null;
  return { guid: parts[0], kind: parts[1], contentHash: parts[2] };
}

/**
 * What the extractor was shown, as a short digest.
 *
 * FNV-1a over the folded title and body, not a cryptographic hash — this is a change detector, and
 * making it one keeps the whole module portable. `createHash` is a Node builtin; reaching for it
 * here would push this file out of the browser bundle and take the Raw tab's "this reading is out
 * of date" badge with it, which is precisely the thing the reader needs when an extraction has gone
 * wrong.
 *
 * Folded, so a whitespace-only edit in WTP's CMS does not spend a model call or raise a second
 * alert about a communiqué that says exactly what it said before.
 */
export function contentHashOf(parts: { title: string; body?: string }): string {
  const text = foldText(`${parts.title}\n${parts.body ?? ''}`);
  // Two independently seeded passes, concatenated: one 32-bit FNV over a few thousand characters
  // collides often enough to matter when a collision means a missed alert.
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
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
