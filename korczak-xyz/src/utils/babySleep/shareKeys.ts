/*
 * Turning what someone typed into the id of a share document.
 *
 * A share is stored at `shares/{email}` rather than under a generated id, because the security rule
 * that grants access has to resolve it from the caller's token alone — `exists(/shares/$(email))` is
 * one lookup, where a `where('email','==',…)` query is not something a rule can run at all. The
 * consequence is that the id must be derived from an address the *same way* on both sides: the rule
 * lowercases `request.auth.token.email`, so this must lowercase too, or an address typed with a
 * capital letter writes a document the rule will never find.
 *
 * Pure and separate from `shares.ts` for the reason `comboKeys.ts` is separate in the typing
 * trainer: there is no jsdom in this project, so anything left inside a submit handler is not a
 * reachable state in a test.
 */

/** Firestore document ids may not exceed 1500 bytes, contain '/', or be '.' or '..'. */
const MAX_ID_BYTES = 1500;

export type ShareEmailError = 'empty' | 'malformed' | 'too-long' | 'self';

export interface ShareEmailResult {
  /** The document id and the stored `email` field — always lowercased. */
  email: string;
  error: null;
}

export interface ShareEmailFailure {
  email: null;
  error: ShareEmailError;
}

/**
 * Validate and canonicalise an address typed into the share form.
 *
 * The address check is deliberately loose — one `@`, something either side, a dot in the domain, no
 * whitespace. Anything stricter rejects addresses that are legal and in use, and the cost of letting
 * a typo through is a share document that simply never matches anyone, which the owner can see in
 * the list and delete.
 *
 * `self` is rejected because sharing a log with its own owner would write a document claiming the
 * owner is their own invitee, and `useDataOwner` would then resolve their uid through it — working
 * by luck until the day the share is revoked and the owner loses their own log.
 */
export function normalizeShareEmail(raw: string, ownerEmail?: string | null): ShareEmailResult | ShareEmailFailure {
  const email = raw.trim().toLowerCase();
  if (email === '') return { email: null, error: 'empty' };
  if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) return { email: null, error: 'malformed' };
  // Byte length, not character length: the limit is on the encoded id, and a non-ASCII address
  // spends more than one byte per character.
  if (new TextEncoder().encode(email).length > MAX_ID_BYTES) {
    return { email: null, error: 'too-long' };
  }
  if (ownerEmail && email === ownerEmail.trim().toLowerCase()) {
    return { email: null, error: 'self' };
  }
  return { email, error: null };
}

/**
 * The key for looking a share up, for the read side, where there is nothing to validate — the
 * address came from a verified token rather than from a keyboard. Returns null when the account has
 * no address at all, which is possible for some providers and means it can hold no share.
 */
export function shareKeyFor(email: string | null | undefined): string | null {
  const key = email?.trim().toLowerCase();
  return key ? key : null;
}
