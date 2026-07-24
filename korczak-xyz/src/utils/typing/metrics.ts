// Typing metrics derived from an event log.
import type { TypingEvent } from './types';

// Standard "word" = 5 characters.
const CHARS_PER_WORD = 5;

// Inter-keystroke gaps longer than this are treated as idle time (thinking,
// glancing at the text, walking away) and capped, so pauses don't inflate the
// elapsed time used for WPM. Natural short pauses under the cap count in full.
const IDLE_GAP_CAP_MS = 3000;

export function charEvents(events: TypingEvent[]): TypingEvent[] {
  return events.filter((e) => e.kind === 'char');
}

// Active typing time in ms: the sum of consecutive char-event gaps, each capped
// at IDLE_GAP_CAP_MS so idle stretches contribute at most the cap.
export function activeTypingMs(events: TypingEvent[]): number {
  const chars = charEvents(events);
  let active = 0;
  for (let i = 1; i < chars.length; i++) {
    active += Math.min(chars[i].t - chars[i - 1].t, IDLE_GAP_CAP_MS);
  }
  return active;
}

// Accuracy over all typed characters, as a percentage (0-100).
export function computeAccuracy(events: TypingEvent[]): number {
  const chars = charEvents(events);
  if (chars.length === 0) return 100;
  const correct = chars.filter((e) => e.correct).length;
  return (correct / chars.length) * 100;
}

// Net words-per-minute: correct characters / 5 over the active typing time.
// Active time excludes idle gaps (see activeTypingMs) so pausing doesn't tank WPM.
export function computeWpm(events: TypingEvent[]): number {
  const chars = charEvents(events);
  if (chars.length < 2) return 0;
  const span = activeTypingMs(events);
  if (span <= 0) return 0;
  const minutes = span / 60000;
  const correct = chars.filter((e) => e.correct).length;
  return correct / CHARS_PER_WORD / minutes;
}

// Live stopwatch clock from a millisecond value: "0:07" / "3:05" / "1:02:30".
// Always shows seconds so a ticking timer visibly advances every second.
export function formatClock(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = s.toString().padStart(2, '0');
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

// Human-readable duration from a minutes value: "45s" / "12m" / "1h 05m".
export function formatDuration(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60); // rounding here avoids "1h 60m"
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`;
}
