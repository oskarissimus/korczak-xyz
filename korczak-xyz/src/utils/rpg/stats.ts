/*
 * Today's numbers for this browser (owner, Oct 2026: "how many launches today and how much went
 * on generating today, on the first screen"): quests started or continued, what the models and
 * the voice cost, how long the story took to write, and how long was played. localStorage
 * `rpg-stats`, one day at a time; a new day starts from zero.
 *
 * This browser only, deliberately: the reader's own keys are spent from here and nowhere else
 * knows about them. What the demo spends across everybody is `demoUsage/rpg-{day}` on the server.
 */

const KEY = 'rpg-stats';

export interface DayStats {
  day: string;
  launches: number;
  /** Dollars, models and voice together, at the list prices in `cost.ts`. */
  usd: number;
  /** Some request today had no price, so `usd` is a floor. */
  unpriced: boolean;
  generationMs: number;
  playMs: number;
}

/** The local calendar day, as YYYY-MM-DD. */
export function today(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function empty(day: string): DayStats {
  return { day, launches: 0, usd: 0, unpriced: false, generationMs: 0, playMs: 0 };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function loadToday(day = today()): DayStats {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DayStats> | null;
    if (!raw || raw.day !== day) return empty(day);
    return {
      day,
      launches: num(raw.launches),
      usd: num(raw.usd),
      unpriced: raw.unpriced === true,
      generationMs: num(raw.generationMs),
      playMs: num(raw.playMs),
    };
  } catch {
    return empty(day);
  }
}

/** Adds to today's counters; a stored day other than today is replaced, not added to. */
export function addToday(patch: Partial<Omit<DayStats, 'day'>>): DayStats {
  const current = loadToday();
  const next: DayStats = {
    day: current.day,
    launches: current.launches + num(patch.launches),
    usd: current.usd + num(patch.usd),
    unpriced: current.unpriced || patch.unpriced === true,
    generationMs: current.generationMs + num(patch.generationMs),
    playMs: current.playMs + num(patch.playMs),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Full or blocked storage: the numbers are a convenience, the game goes on.
  }
  return next;
}
