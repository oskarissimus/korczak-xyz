/*
 * Keeping a long-lived page able to reach Firestore.
 *
 * Two things go wrong when a device is offline for a while, and neither one heals on its own.
 *
 * The first is that the Firestore client can die permanently. See the comment on `recycleDb` in
 * firebase.ts for the mechanism; the symptom is an `INTERNAL ASSERTION FAILED` in the console,
 * usually as an unhandled rejection because it is thrown from a stream callback nobody awaits.
 *
 * The second is what that does to callers. A promise waiting on the client's queue when it dies
 * is never settled - not resolved, not rejected - so `await` on it hangs for the lifetime of the
 * page. Every state machine in the app that guards work with an "in flight" flag cleared in a
 * `finally` therefore wedges: the flag stays set, later work coalesces into a write that will
 * never happen, and the UI reports a sync that is permanently in progress.
 *
 * So: nothing awaits Firestore without a deadline, and blowing that deadline is itself treated
 * as evidence the client needs replacing. A deadline that fires on a merely slow network costs
 * one wasted attempt, because every caller here is a retry loop and the writes are checked
 * against the document's revision rather than blind.
 */

import { getDb, recycleDb } from './firebase';
import { log } from './logger';

/** How long any single Firestore call may take before we assume it will never come back. */
const DEADLINE_MS = 25_000;
/** Floor between client replacements, so a genuinely unreachable backend cannot spin. */
const RECYCLE_COOLDOWN_MS = 30_000;

let lastRecycleAt = 0;
let installed = false;

export class FirestoreStalledError extends Error {
  constructor(public readonly label: string) {
    super(`Firestore call '${label}' exceeded ${DEADLINE_MS}ms`);
    this.name = 'FirestoreStalledError';
  }
}

/** The SDK's internal assertions all carry this text, thrown and logged. */
function isClientPanic(e: unknown): boolean {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return message.includes('INTERNAL ASSERTION FAILED');
}

/**
 * Whether an error means the client was replaced rather than the request refused. Callers use
 * it to retry promptly instead of serving out a backoff earned by a client that no longer
 * exists.
 */
export function isRecoverableClientError(e: unknown): boolean {
  return e instanceof FirestoreStalledError || isClientPanic(e);
}

/** Replace the Firestore client, at most once per cooldown. */
export function recoverFirestore(reason: string): void {
  const now = Date.now();
  if (now - lastRecycleAt < RECYCLE_COOLDOWN_MS) {
    log.debug('firestore.recycle.skipped', { reason, sinceLastMs: now - lastRecycleAt });
    return;
  }
  lastRecycleAt = now;
  const replaced = recycleDb();
  log.error('firestore.recycle', { reason, replaced });
}

/**
 * Run a Firestore call under a deadline. On expiry the underlying promise is abandoned - there
 * is no way to cancel it - and the client is replaced, so the caller's next attempt runs
 * against a live one.
 */
export async function runCloud<T>(label: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FirestoreStalledError(label)), DEADLINE_MS);
      }),
    ]);
  } catch (e) {
    if (e instanceof FirestoreStalledError) {
      log.error('firestore.stalled', { label, ms: DEADLINE_MS });
      recoverFirestore(`stalled:${label}`);
    } else if (isClientPanic(e)) {
      recoverFirestore(`panic:${label}`);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Watch for the assertion arriving as an unhandled rejection - the usual way, since it is
 * thrown from a stream callback rather than from anything the app awaited. Replacing the client
 * here rather than waiting for the next call to time out is what turns "dead until reload" into
 * a pause of a few seconds.
 */
export function installFirestoreWatchdog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (!getDb()) return;

  window.addEventListener('unhandledrejection', (event) => {
    if (isClientPanic(event.reason)) {
      log.error('firestore.panic', { message: String(event.reason?.message ?? event.reason) });
      // The rejection is the SDK's own bookkeeping, not a failure of anything we asked for;
      // leaving it unhandled only fills the console.
      event.preventDefault();
      recoverFirestore('panic:unhandledrejection');
    }
  });
}
