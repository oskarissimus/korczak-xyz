// Per-key typing statistics derived from session event logs.
//
// Every metric here is reconstructed at read time from the stored `events[]`
// (the same source the over-time stats use). A keystroke's "latency" is the gap
// to the previous char event in the same session — attributed to the character
// just typed — following the same char-only, idle-capped convention as
// `activeTypingMs` in metrics.ts.
import { charEvents } from './metrics';
import type { TypingSession } from './types';

// Inter-keystroke gaps longer than this are pauses (thinking, glancing away),
// not slow typing, and are excluded from a key's latency samples. Mirrors
// IDLE_GAP_CAP_MS in metrics.ts (there it caps; here we drop the outlier so it
// can't skew a key's timing).
const IDLE_GAP_CAP_MS = 3000;

// Ranking lists (slowest/fastest/bottleneck) require at least this many latency
// samples for a key, so a one-off fluke can't top the chart. Keys below the
// threshold still appear in the full table with their count shown.
export const MIN_KEY_SAMPLES = 8;

export interface KeyStat {
  key: string; // exact char: 'a', 'A', 'ą', ' ', '\n'
  count: number; // times typed (correct + mistakes)
  correct: number; // correct presses
  accuracy: number; // 0–100, correct / count
  medianLatencyMs: number; // measured from correct presses only
  meanLatencyMs: number;
  bottleneckMs: number; // medianLatencyMs * count — cumulative time cost
  samples: number; // correct-press latency samples (excludes session-first + idle gaps)
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface KeyAccumulator {
  count: number;
  correct: number;
  latencies: number[];
}

// Walk one session's char events in order, banking each key's occurrence count,
// correctness, and (where a valid predecessor exists) its inter-keystroke gap.
function accumulateSession(session: TypingSession, byKey: Map<string, KeyAccumulator>): void {
  const chars = charEvents(session.events);
  for (let i = 0; i < chars.length; i++) {
    const ev = chars[i];
    const key = ev.data ?? '';
    let acc = byKey.get(key);
    if (!acc) {
      acc = { count: 0, correct: 0, latencies: [] };
      byKey.set(key, acc);
    }
    acc.count += 1;
    if (ev.correct) acc.correct += 1;
    // Speed is measured from correct keystrokes only — a fumbled key press
    // (wrong key at that spot) doesn't reflect how fast you type that key. The
    // first char of a session also has no predecessor to measure against.
    if (i > 0 && ev.correct) {
      const gap = ev.t - chars[i - 1].t;
      if (gap > 0 && gap <= IDLE_GAP_CAP_MS) acc.latencies.push(gap);
    }
  }
}

// Per-key aggregates across all sessions/books. Sorted slowest-first (highest
// median latency) as a sensible default; the UI re-sorts as needed.
export function computeKeyStats(sessions: TypingSession[]): KeyStat[] {
  const byKey = new Map<string, KeyAccumulator>();
  for (const s of sessions) accumulateSession(s, byKey);

  const stats: KeyStat[] = [];
  for (const [key, acc] of byKey) {
    // Keys never typed correctly are accidental presses (stray Option-key combos
    // and the like), not keys the user practices — leave them out entirely.
    if (acc.correct === 0) continue;
    const sorted = [...acc.latencies].sort((a, b) => a - b);
    const med = median(sorted);
    const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : 0;
    stats.push({
      key,
      count: acc.count,
      correct: acc.correct,
      accuracy: acc.count ? (acc.correct / acc.count) * 100 : 100,
      medianLatencyMs: med,
      meanLatencyMs: mean,
      bottleneckMs: med * acc.count,
      samples: sorted.length,
    });
  }
  return stats.sort((a, b) => b.medianLatencyMs - a.medianLatencyMs);
}

// One point per local day (median latency that day) for a single key, so the
// detail panel can chart whether that key is getting faster over time. Buckets
// by wall-clock time (session.startedAt + event.t), matching the over-time page.
export function keyLatencyOverTime(
  sessions: TypingSession[],
  key: string,
): { t: number; value: number }[] {
  const byDay = new Map<number, number[]>();
  for (const s of sessions) {
    const chars = charEvents(s.events);
    for (let i = 1; i < chars.length; i++) {
      const ev = chars[i];
      if ((ev.data ?? '') !== key || !ev.correct) continue;
      const gap = ev.t - chars[i - 1].t;
      if (gap <= 0 || gap > IDLE_GAP_CAP_MS) continue;
      const wall = s.startedAt + ev.t;
      const d = new Date(wall);
      const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const bucket = byDay.get(dayKey);
      if (bucket) bucket.push(gap);
      else byDay.set(dayKey, [gap]);
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, gaps]) => ({ t, value: median(gaps.sort((x, y) => x - y)) }));
}
