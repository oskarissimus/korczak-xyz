/*
 * Time spent in the game, per account (owner, 24 Nov 2026: "in the admin, a tab where I see how many
 * accounts there are, the list of e-mails and how much time was spent in the game over different
 * ranges").
 *
 * The page counts the seconds it is on screen with somebody at it (`usePlaytime.ts`: the tab visible
 * and an input in the last `IDLE_MS`) and hands them to the gateway every `BEAT_MS`; the gateway
 * (`functions/src/rpg/playtime.ts`) adds them to `rpgPlaytime/{uid}` — a total and one counter per
 * Warsaw day — and never more than the time since that account's last beat, so a page cannot count
 * a minute twice. Signed in only: a guest has no account to show it on. Admin SDK only, no rule.
 *
 * Kept apart from the replay recordings (`rpgReplays`, another thread of the same day): those expire
 * after 30 days, and the total here must not.
 *
 * Shared by both runtimes: the shapes, the arithmetic and the summary the admin tab draws. Tested.
 */

import { warsawDay } from './requestLog';

export const PLAYTIME_PATH = '/playtime';
export const ADMIN_ACCOUNTS_PATH = '/admin/accounts';
export const PLAYTIME_COLLECTION = 'rpgPlaytime';

/** How often the page reports. */
export const BEAT_MS = 60_000;
/** No input for this long and the page stops counting (a tab left open is not play). */
export const IDLE_MS = 5 * 60_000;
/** The most one report may add, whatever it asks. */
export const MAX_BEAT_S = 2 * 60;

/**
 * What one report is credited with: what it asks, cut to `MAX_BEAT_S` and to the time since the
 * account's last credited report (plus a little slack for the network), so two tabs open side by side
 * count wall time once and a forged report gains nothing.
 */
export function creditSeconds(asked: unknown, lastAt: number | null, now: number): number {
  const n = typeof asked === 'number' && Number.isFinite(asked) ? Math.floor(asked) : 0;
  let s = Math.max(0, Math.min(MAX_BEAT_S, n));
  if (lastAt !== null && lastAt <= now) s = Math.min(s, Math.floor((now - lastAt) / 1000) + 5);
  return Math.max(0, s);
}

/** `rpgPlaytime/{uid}` as read back; anything unreadable counts as nothing. */
export interface PlaytimeDoc {
  total: number;
  days: Record<string, number>;
  lastAt: number | null;
}

export function playtimeOf(data: Record<string, unknown> | undefined): PlaytimeDoc {
  const total = typeof data?.total === 'number' && data.total > 0 ? data.total : 0;
  const days: Record<string, number> = {};
  const raw = data?.days;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'number' && v > 0) days[k] = v;
    }
  }
  const lastAt = typeof data?.lastAt === 'number' ? data.lastAt : null;
  return { total, days, lastAt };
}

/** The `n` Warsaw days ending with `today` (`YYYY-MM-DD`), today first. */
export function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

export const WINDOWS = ['today', 'd7', 'd30', 'all'] as const;
export type PlayWindow = (typeof WINDOWS)[number];
const WINDOW_DAYS: Record<Exclude<PlayWindow, 'all'>, number> = {
  today: 1,
  d7: 7,
  d30: 30,
};

/** Seconds played in each window, by Warsaw day; `all` is the running total. */
export function windowsOf(p: PlaytimeDoc, now: number): Record<PlayWindow, number> {
  const days = lastDays(warsawDay(now), 30);
  const sum = (n: number) => days.slice(0, n).reduce((s, d) => s + (p.days[d] ?? 0), 0);
  return {
    today: sum(WINDOW_DAYS.today),
    d7: sum(WINDOW_DAYS.d7),
    d30: sum(WINDOW_DAYS.d30),
    all: p.total,
  };
}

/** One account as the admin tab lists it. */
export interface AdminAccount {
  uid: string;
  email: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  admin: boolean;
  disabled: boolean;
  /** The diesel tank, in dollars; null when the account never had one. */
  balanceUsd: number | null;
  play: Record<PlayWindow, number>;
  lastPlayedAt: number | null;
}

export interface AccountsTotals {
  accounts: number;
  /** Accounts made in each window (`all` = every account). */
  created: Record<PlayWindow, number>;
  /** Accounts with any time in each window. */
  active: Record<PlayWindow, number>;
  /** Seconds played by everybody in each window. */
  seconds: Record<PlayWindow, number>;
}

export interface AccountsPage {
  at: number;
  accounts: AdminAccount[];
  totals: AccountsTotals;
  /** More accounts than one answer lists. */
  truncated: boolean;
}

const zero = (): Record<PlayWindow, number> => ({
  today: 0,
  d7: 0,
  d30: 0,
  all: 0,
});

export function summarize(accounts: AdminAccount[], now: number): AccountsTotals {
  const days = lastDays(warsawDay(now), 30);
  const created = zero();
  const active = zero();
  const seconds = zero();
  for (const a of accounts) {
    created.all++;
    if (a.createdAt !== null) {
      const d = warsawDay(a.createdAt);
      const i = days.indexOf(d);
      if (i === 0) created.today++;
      if (i >= 0 && i < 7) created.d7++;
      if (i >= 0) created.d30++;
    }
    for (const w of WINDOWS) {
      seconds[w] += a.play[w];
      if (a.play[w] > 0) active[w]++;
    }
  }
  return { accounts: accounts.length, created, active, seconds };
}

/** Last played first, then the newest accounts; nobody's time is hidden by the order. */
export function sortAccounts(accounts: AdminAccount[]): AdminAccount[] {
  return [...accounts].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** "2 h 05 min", "4 min", "40 s", "—" for nothing. */
export function formatPlay(seconds: number): string {
  if (!(seconds > 0)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}
