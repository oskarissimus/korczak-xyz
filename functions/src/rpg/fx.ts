/*
 * The dollar in złoty, for the request log and the admin panel (owner, 10 Nov 2026: "the rate to PLN
 * from some free API, so it is in złoty too").
 *
 * The National Bank of Poland's table A mid rate (`api.nbp.pl`): free, keyless, the rate Polish
 * accounting uses. It is published once a business day, so it is asked at most every six hours per
 * instance and the last good answer is kept in `rpgFx/usd` (Admin SDK only, no rule) for an instance
 * that cannot reach NBP. A rate that cannot be had at all is null — the record says so, and the panel
 * falls back to today's — never a guess.
 */

import { db } from '../runtime';
import { reportError } from '../sentry';

export const NBP_USD = 'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json';
const FRESH_MS = 6 * 3600_000;
const TIMEOUT_MS = 2500;

export interface Fx {
  usdPln: number;
  /** The NBP table's effective date, `YYYY-MM-DD`. */
  date: string;
}

let memory: { at: number; fx: Fx } | null = null;
let inFlight: Promise<Fx | null> | null = null;

/** For tests. */
export function forgetFx(): void {
  memory = null;
  inFlight = null;
}

/** NBP's answer read: `{rates:[{effectiveDate, mid}]}`. */
export function parseNbp(body: unknown): Fx | null {
  const rate = (body as { rates?: { effectiveDate?: unknown; mid?: unknown }[] } | null)?.rates?.[0];
  const mid = rate?.mid;
  const date = rate?.effectiveDate;
  if (typeof mid !== 'number' || !(mid > 0) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { usdPln: mid, date };
}

async function ask(): Promise<Fx | null> {
  const ref = db.collection('rpgFx').doc('usd');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const r = await fetch(NBP_USD, { signal: controller.signal, headers: { accept: 'application/json' } }).finally(() => clearTimeout(timer));
    const fx = r.ok ? parseNbp(await r.json()) : null;
    if (fx) {
      await ref.set({ ...fx, at: Date.now() }).catch(() => undefined);
      return fx;
    }
  } catch (e) {
    reportError('rpgFx.nbp', e);
  }
  const kept = (await ref.get().catch(() => null))?.data();
  return kept && typeof kept.usdPln === 'number' && typeof kept.date === 'string' ? { usdPln: kept.usdPln, date: kept.date } : null;
}

/** Today's USD→PLN, or null. Never throws, never waits more than a few seconds. */
export async function usdPln(): Promise<Fx | null> {
  if (memory && Date.now() - memory.at < FRESH_MS) return memory.fx;
  inFlight ??= ask().finally(() => {
    inFlight = null;
  });
  const fx = await inFlight;
  if (fx) memory = { at: Date.now(), fx };
  return fx;
}
