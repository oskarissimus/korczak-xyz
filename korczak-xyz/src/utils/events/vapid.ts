/*
 * The VAPID application server key, in the form PushManager wants.
 *
 * `applicationServerKey` takes raw bytes; the key is published as base64url. The conversion is
 * four lines and universally copy-pasted, which is exactly why it is worth having a test: the
 * padding case is easy to get wrong and the symptom is an opaque `InvalidAccessError` at subscribe
 * time, on a phone, with nothing in the console to say which of the two keys was malformed.
 *
 * Portable: browser and Node, no imports outside this directory. See types.ts.
 */

export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * A stable id for a subscription endpoint.
 *
 * SHA-256 via WebCrypto, which is one implementation for both runtimes — `globalThis.crypto.subtle`
 * exists in the browser and in Node 22 — so the id the page writes and the id the collector reads
 * cannot come from two different hashes.
 *
 * Keying on the endpoint rather than minting a uuid is what makes re-registering the same browser
 * an update instead of another row: iOS hands out a fresh subscription fairly often, and a uuid
 * key would accumulate a dead one per re-arm, each of which the collector would go on pushing to
 * until it earned a 410.
 */
export async function subIdFor(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
