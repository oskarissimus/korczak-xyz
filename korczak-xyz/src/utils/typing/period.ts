// Time-window scoping for the stats views.
//
// Every metric is recomputed from raw session events at read time, so narrowing
// a view to "the last week" is just a matter of handing the aggregators a
// trimmed copy of the session list.
import type { TypingSession } from './types';

export type StatsPeriod = 'all' | 'week' | 'day';

export const PERIOD_MS: Record<Exclude<StatsPeriod, 'all'>, number> = {
  week: 7 * 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

// Sessions trimmed to the events at or after `since` (wall clock =
// session.startedAt + event.t). A session only rotates after a 15-minute gap,
// so one can span hours — trimming at event level rather than dropping whole
// sessions keeps a 24-hour window honest.
//
// Neither `startedAt` nor the event offsets are rebased: keyStats measures
// inter-keystroke gaps as differences of `t` within a session, and the per-day
// buckets need `startedAt + t`. Trimming costs a session at most one latency
// sample (the first surviving char event has no predecessor left to measure
// against) — which is correct, since that gap straddles the window edge.
export function filterSessionsSince(sessions: TypingSession[], since: number): TypingSession[] {
  const out: TypingSession[] = [];
  for (const s of sessions) {
    if (s.startedAt >= since) {
      out.push(s);
      continue;
    }
    const cutoff = since - s.startedAt;
    const events = s.events.filter((e) => e.t >= cutoff);
    if (events.length > 0) out.push({ ...s, events });
  }
  return out;
}
