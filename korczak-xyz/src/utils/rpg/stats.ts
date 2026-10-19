/*
 * Today's numbers for the whole site (owner, Oct 2026: "the stats are to be general, from the whole
 * site: how much money went today, how long was played and how many times"). The browser reports;
 * `rpgDemo` adds it up in `rpgStats/{day}` (Warsaw day) and its GET answers with the totals, the
 * demo's own spend added on the server, where it is already counted.
 *
 * What is reported: a launch (Start or Continue), time played, and what a reader's own keys cost as
 * each priced request ends. Not the demo's requests (`countSpend(false)`), which the function
 * charged itself. Launches go at once; the rest is gathered and sent every 30 s and, by
 * `sendBeacon`, when the page is hidden or closed. Lost if the network is: a statistic, not money.
 */

import { rpgDemoUrl } from './demo';

export interface SiteToday {
  launches: number;
  playMs: number;
  /** Dollars, models and voice, the readers' own keys and the demo together. */
  usd: number;
}

const FLUSH_MS = 30_000;

let pending = { launches: 0, playMs: 0, usd: 0 };
let spendCounts = true;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Off while a quest plays on the demo: the function already counted what it spent. */
export function countSpend(on: boolean): void {
  spendCounts = on;
}

export function reportLaunch(): void {
  pending.launches += 1;
  flushStats();
}

export function reportPlay(ms: number): void {
  if (ms > 0) pending.playMs += ms;
  schedule();
}

export function reportSpend(usd: number): void {
  if (!spendCounts || !(usd > 0)) return;
  pending.usd += usd;
  schedule();
}

function schedule(): void {
  if (timer !== null || typeof window === 'undefined') return;
  timer = setTimeout(() => flushStats(), FLUSH_MS);
}

/** Sends what is gathered. `beacon` for a page going away, where a fetch would be cut. */
export function flushStats(beacon = false): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const url = rpgDemoUrl();
  const { launches, playMs, usd } = pending;
  if (!url || (!launches && playMs < 1000 && !usd)) return;
  pending = { launches: 0, playMs: 0, usd: 0 };
  // One launch per report, which is what the function accepts; a second waits for the next.
  if (launches > 1) pending.launches = launches - 1;
  const body = JSON.stringify({ kind: 'stats', launches: launches > 0 ? 1 : 0, playMs: Math.round(playMs), usd });
  try {
    // text/plain: no CORS preflight, so a beacon can carry it.
    if (beacon && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return;
    void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(() => {});
  } catch {
    // A statistic; never the game's problem.
  }
  if (pending.launches > 0) flushStats(beacon);
}
