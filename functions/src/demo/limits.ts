/*
 * The demo's limits as the handler sees them: the shared rules, plus the three things that can
 * only be done here.
 *
 * The settings, the caps and `checkDemo` are in `korczak-xyz/src/utils/backseat/demoLimits.ts` and
 * re-exported below, because the admin panel writes the document this handler reads and the two
 * must not disagree about what a cap means — the same one-rule-two-runtimes argument the Event
 * Watch matcher is built on. What stays here is what the browser has no business compiling: the
 * address out of a proxy header, and the hash that turns it into a counter key.
 *
 * THE DAY IS WARSAW'S, NOT UTC'S. The caps reset at local midnight because that is when the person
 * reading this would expect them to, and because a quota that resets at 2am is a quota somebody has
 * to do arithmetic about.
 *
 * AN IP IS NEVER STORED. The counter's key is a hash of the address with the day in the salt, so
 * two days' documents cannot be joined up, and nothing in the database says who was here. It is a
 * rate-limit bucket rather than a log, and it is deleted by nothing because it never needs to be
 * read for any other purpose.
 */

import { createHash } from 'node:crypto';

export {
  DEMO_APPS,
  DEMO_DEFAULTS,
  DEMO_MODES,
  capsFor,
  MAX_MIN_INTERVAL,
  MAX_PER_APP_DAILY,
  MAX_PER_IP_DAILY,
  checkDemo,
  normalizeSettings,
  remaining,
} from '../../../korczak-xyz/src/utils/backseat/demoLimits';
export type {
  DemoApp,
  DemoMode,
  DemoReason,
  DemoRefusal,
  DemoSettings,
  DemoVerdict,
} from '../../../korczak-xyz/src/utils/backseat/demoLimits';

/** Warsaw's calendar day, `YYYY-MM-DD`. See the header for why it is not UTC's. */
export function dayKey(at: number | Date = Date.now()): string {
  const date = at instanceof Date ? at : new Date(at);
  // `en-CA` is ISO order, and the time zone does the rest; no date library for one string.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(date);
}

/**
 * The counter's key for one address, which is not the address.
 *
 * The day is in the salt as well as in the document path, so the same person on two days hashes
 * to two unrelated strings and nothing in the database can follow anybody from one day to the
 * next. Truncated to 32 hex characters because a rate-limit bucket does not need 64.
 */
export function ipKey(ip: string, day: string): string {
  return createHash('sha256').update(`${day}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * The caller's address, out of a header written by proxies and by anybody who feels like it.
 *
 * `x-forwarded-for` on Cloud Run is a list the front end appends to, so the LAST entry is the one
 * Google saw and the earlier ones are whatever the client sent. Taking the first — which is the
 * usual advice, behind a proxy you control — would let anybody mint a fresh bucket per request
 * with one header. An address that is not there at all becomes `unknown`, which is a bucket of
 * its own that everybody anonymous shares; that is the strict direction.
 */
export function callerIp(forwardedFor: string | undefined, socketIp?: string): string {
  const parts = (forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || (socketIp ?? '').trim() || 'unknown';
}
